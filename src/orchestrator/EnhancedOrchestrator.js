// src/orchestrator/EnhancedOrchestrator.js
'use strict';

// NOTE: process.on('unhandledRejection') handlers intentionally removed from here.
// They belong only in the process entry point (seekcode.js / index.js).
// Having them in every required module causes duplicate handlers and MaxListeners warnings.

const path = require('path');
const fs   = require('fs');

const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { TaskPlanner }     = require('../planner/TaskPlanner');
const { GatewayClient }   = require('../gateway-client');
const { RefactorEngine }  = require('../smart-tools');
const { TestRunner }      = require('../testing');
const { GitManager }     = require('../git');
const { SessionMemory }   = require('../session');
const { ValidationEngine } = require('./ValidationEngine');
const { TaskManager }      = require('./TaskManager');
const { MetricsCollector } = require('./MetricsCollector');
const logger              = require('../logger');

let TraceLogger = null;
try { TraceLogger = require('../trace-logger').TraceLogger; } catch {}

class EnhancedOrchestrator {
  constructor(projectPath) {
    this.projectPath    = path.resolve(projectPath);
    this.analyzer       = null;
    this.planner        = null;
    this.gateway        = new GatewayClient();
    this.session        = new SessionMemory();
    this.refactorEngine = null;
    this.testRunner     = null;
    this.gitManager     = null;
    this.validator      = null;
    this.taskManager    = null;
    this.metrics        = null;
    this.traceLogger    = null;

    // Rolling execution log — threads context across all steps
    this.executionLog = [];

    if (process.env.SEEKCODE_TRACE === '1' && TraceLogger) {
      const sessionId = `orchestrator_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.traceLogger = new TraceLogger(sessionId);
      this.traceLogger.logEvent('orchestrator_init', { projectPath });
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async init() {
    const cached = this.session.getProjectMap();
    if (cached) logger.info('Using cached project map from session');

    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    this.session.storeProjectMap(this.analyzer.getSummary());

    this.planner        = new TaskPlanner(this.analyzer, this.gateway);
    this.refactorEngine = new RefactorEngine(this.analyzer);
    this.testRunner     = new TestRunner(this.projectPath);
    this.gitManager     = new GitManager(this.projectPath);
    this.validator      = new ValidationEngine(this.projectPath);
    this.metrics        = new MetricsCollector(this.projectPath);

    logger.success('Enhanced orchestrator initialized');

    if (this.traceLogger) {
      this.traceLogger.logEvent('init_complete', { projectSummary: this.analyzer.getSummary() });
    }
  }


  // ── Run ────────────────────────────────────────────────────────────────────
  async run(task) {
    this.executionLog = []; // reset for each new top-level task

    if (this.traceLogger) this.traceLogger.logEvent('run_start', { task });

    // ── Pre-task git snapshot ──────────────────────────────────────────────
    // Creates a restore point before any destructive changes.
    // Users can always `git diff HEAD~1` to see exactly what SeekCode changed.
    if (this.gitManager.isRepo()) {
      try {
        const status = this.gitManager._run('git status --porcelain');
        if (status) {
          this.gitManager.stageAll();
          this.gitManager.commit(`seekcode: pre-task checkpoint — ${task.substring(0, 60)}`);
          logger.info('Pre-task git checkpoint created (restore with: git reset --hard HEAD~1)');
        }
      } catch (err) {
        logger.warn(`Pre-task git snapshot failed (non-fatal): ${err.message}`);
      }
    }

    // ── Plan ───────────────────────────────────────────────────────────────
    let plan;
    const pendingTaskId = TaskManager.findPendingTask(this.projectPath);
    
    if (pendingTaskId) {
      logger.info(`Resuming task: ${pendingTaskId}`);
      this.taskManager = new TaskManager(this.projectPath, pendingTaskId);
      plan = { steps: this.taskManager.state.steps.map(s => s.description) };
    } else {
      const planStart = Date.now();
      plan = await this.planner.plan(task);
      const planMs = Date.now() - planStart;

      if (this.traceLogger) {
        this.traceLogger.logStep('planning', 'Generate task plan', 'complete', planMs, {
          stepsCount: plan.steps?.length || 0,
          hasQuickAnswer: !!plan.quickAnswer,
        });
      }

      // ── Quick answer (question, no code changes) ───────────────────────────
      if (plan.quickAnswer) {
        const summary = this.analyzer.getSummary();
        const files = this.analyzer.getDependencyGraph().getAllFiles();
        const answer = [
          `Project: ${summary.project}`,
          `Framework: ${summary.meta.framework || 'none'}`,
          `Language: ${summary.meta.language}`,
          `Files: ${files.length} source files`,
          `Top-level modules: ${files.filter(f => !f.includes('/')).join(', ')}`,
        ].join('\n');

        try { await this.gateway.closeSession(); } catch {}
        if (this.traceLogger) {
          this.traceLogger.logEvent('quick_answer', { answer: answer.substring(0, 200) });
          this.traceLogger.close();
        }
        return answer;
      }

      this.taskManager = new TaskManager(this.projectPath);
      this.taskManager.setPlan(plan.steps);

      // ── Confidence Gate ────────────────────────────────────────────────
      const confidence = await this._evaluateConfidence(task, plan, baseContext);
      logger.info(`Confidence Score: ${confidence}%`);
      if (confidence < 70) {
        logger.warn('Confidence score is low. SeekCode will spend more time researching.');
        // In a real implementation, we might adjust the plan here or ask for more info
        // For now, we just log it and proceed, as requested by the framework
      }
    }

    // ── Execute steps ──────────────────────────────────────────────────────
    logger.header(pendingTaskId ? 'Resuming Execution Plan' : 'Execution Plan');
    plan.steps.forEach((s, i) => {
      const stepState = this.taskManager.state.steps[i];
      const statusIcon = stepState.status === 'completed' ? '✓' : (stepState.status === 'failed' ? '✗' : ' ');
      console.log(`  ${i + 1}. [${statusIcon}] ${s}`);
    });

    await this.gateway.createSession();
    let finalResult = '';

    // Base context — passed to every step
    const baseContext = JSON.stringify({
      project: this.analyzer.getSummary(),
      dependencyGraph: this.analyzer.getDependencyGraph().toJSON(),
      recentTasks: this.session.getRecentTasks(),
    }, null, 2);

    const startTime = Date.now();
    for (let i = this.taskManager.state.currentStepIndex; i < plan.steps.length; i++) {
      const step      = plan.steps[i];
      const stepStart = Date.now();
      const stepId    = `step_${i + 1}`;

      this.taskManager.updateStepStatus(i, 'in-progress');

      if (this.traceLogger) {
        this.traceLogger.logStep(stepId, step, 'start', null, {
          stepIndex: i + 1,
          totalSteps: plan.steps.length,
        });
      }

      logger.header(`Step ${i + 1}/${plan.steps.length}: ${step.substring(0, 80)}`);

      const priorWork = this.executionLog.length > 0
        ? [
            'PRIOR STEPS COMPLETED:',
            ...this.executionLog.slice(-4).map(
              e => `  Step ${e.index}: ${e.step}\n  Result: ${e.summary}`
            ),
            '',
          ].join('\n')
        : '';

      const prompt = [
        'You are SeekCode, executing one step of a larger multi-step task.',
        'Read the prior steps carefully — do not repeat work already done.',
        '',
        'PROJECT CONTEXT:',
        baseContext,
        '',
        'OVERALL TASK:',
        task,
        '',
        priorWork,
        `CURRENT STEP (${i + 1}/${plan.steps.length}):`,
        step,
        '',
        'Execute this step using tools. When done, output ONLY a plain-text summary of what you did.',
      ].join('\n');

      try {
        const result  = await this.gateway.chat(prompt);
        const stepMs  = Date.now() - stepStart;

        this.executionLog.push({
          index: i + 1,
          step,
          summary: result.substring(0, 400),
          durationMs: stepMs,
        });
        if (this.executionLog.length > 8) {
          this.executionLog = this.executionLog.slice(-8);
        }

        if (this.traceLogger) {
          this.traceLogger.logStep(stepId, step, 'complete', stepMs, {
            resultLength: result.length,
            stepIndex: i + 1,
          });
        }

        logger.success(`Step ${i + 1} done (${(stepMs / 1000).toFixed(1)}s)`);
        this.metrics.recordStep(true);
        
        // ── Validation Loop ────────────────────────────────────────────────
        // Run validation after each step that might have changed code
        if (this._isCodeChangingStep(step, result)) {
          const validation = await this.validator.validate();
          
          if (validation.phase === 'build') this.metrics.recordBuild(validation.success);
          if (validation.phase === 'test') this.metrics.recordTest(validation.success);

          if (!validation.success) {
            logger.warn(`Validation failed after Step ${i + 1}: ${validation.phase} error`);
            const repaired = await this._repairLoop(validation, step, baseContext);
            this.metrics.recordRepair(repaired);
            if (!repaired) {
              logger.error(`Repair loop failed after Step ${i + 1}`);
              this.executionLog[this.executionLog.length - 1].validationFailed = true;
            } else {
              logger.success(`Repair successful after Step ${i + 1}`);
            }
          } else {
            logger.success(`Validation passed after Step ${i + 1}`);
          }
        }

        this.taskManager.completeStep(i, result);
        finalResult += `Step ${i + 1}: ${step}\n${result}\n\n`;
      } catch (err) {
        const stepMs = Date.now() - stepStart;

        if (this.traceLogger) {
          this.traceLogger.logStep(stepId, step, 'error', stepMs, {
            error: err.message,
            stepIndex: i + 1,
          });
        }

        logger.error(`Step ${i + 1} failed: ${err.message}`);
        this.metrics.recordStep(false);
        this.taskManager.failStep(i, err.message);
        finalResult += `Step ${i + 1}: ${step}\nERROR: ${err.message}\n\n`;

        this.executionLog.push({
          index: i + 1,
          step,
          summary: `FAILED: ${err.message}`,
          durationMs: stepMs,
          failed: true,
        });
      }
    }

    // ── Final Validation (Definition of Done) ──────────────────────────────
    logger.header('Final Validation');
    const finalValidation = await this.validator.validate();
    if (finalValidation.success) {
      logger.success('Project satisfies Definition of Done: Build and Tests pass.');
      finalResult += `\nFinal Validation: PASSED ✓\n`;
    } else {
      logger.warn(`Project does NOT satisfy Definition of Done: ${finalValidation.phase} failed.`);
      finalResult += `\nFinal Validation: FAILED ✗ (${finalValidation.phase})\n${finalValidation.error}\n`;
    }

    // ── Post-task git commit ───────────────────────────────────────────────
    if (this.gitManager.isRepo()) {
      try {
        const status = this.gitManager._run('git status --porcelain');
        if (status) {
          this.gitManager.stageAll();
          this.gitManager.commit(`SeekCode: ${task.substring(0, 72)}`);
          logger.success('Changes committed to git');
        } else {
          logger.info('No file changes to commit');
        }
      } catch (err) {
        logger.warn(`Post-task git commit failed: ${err.message}`);
      }

      if (this.traceLogger) {
        this.traceLogger.logEvent('git_commit', { task: task.substring(0, 72) });
      }
    }

    this.session.rememberTask(task, finalResult.substring(0, 500));
    this.metrics.recordTask(this.taskManager.state.status === 'completed', Date.now() - startTime);
    try { await this.gateway.closeSession(); } catch {}

    if (this.traceLogger) {
      this.traceLogger.logEvent('run_complete', {
        resultLength: finalResult.length,
        stepsCompleted: plan.steps.length,
      });
      this.traceLogger.close();
    }

    return finalResult;
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    _isCodeChangingStep(step, result) {
    const codeKeywords = ['write', 'edit', 'modify', 'change', 'create', 'update', 'fix', 'refactor', 'implement', 'add', 'remove', 'delete'];
    const toolKeywords = ['write_file', 'replace_in_file', 'run_command'];

    const lowerStep = step.toLowerCase();
    const lowerResult = result.toLowerCase();

    return codeKeywords.some(kw => lowerStep.includes(kw)) || toolKeywords.some(kw => lowerResult.includes(kw));
    }

    async _evaluateConfidence(task, plan, baseContext) {
    const prompt = [
      'You are SeekCode, an expert AI software engineer.',
      'Evaluate your confidence in successfully completing the following task based on the plan and project context.',
      '',
      'TASK: ' + task,
      'PLAN:',
      JSON.stringify(plan.steps, null, 2),
      '',
      'PROJECT CONTEXT:',
      baseContext,
      '',
      'Rate your confidence from 0 to 100.',
      'Output ONLY a JSON object: {"confidence": 85, "reason": "..."}. No other text.'
    ].join('\n');

    try {
      const response = await this.gateway.chat(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return result.confidence || 50;
      }
    } catch (err) {
      logger.warn(`Confidence evaluation failed: ${err.message}`);
    }
    return 50; // default to 50 if evaluation fails
  }

  async _repairLoop(validation, step, baseContext, maxRetries = 3) {
    let currentValidation = validation;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(`Repair attempt ${attempt}/${maxRetries} for ${currentValidation.phase} failure...`);

      const repairPrompt = [
        'You are SeekCode, an expert AI software engineer. A validation check failed after you executed a step.',
        '',
        'PHASE FAILED: ' + currentValidation.phase,
        'ERROR OUTPUT:',
        currentValidation.error,
        '',
        'LAST STEP EXECUTED:',
        step,
        '',
        'PROJECT CONTEXT:',
        baseContext,
        '',
        'TASK: Diagnose the error and fix it using tools. When done, output ONLY a summary of your repair.',
      ].join('\n');

      try {
        const repairResult = await this.gateway.chat(repairPrompt);
        logger.info(`Repair attempt ${attempt} completed. Re-validating...`);

        currentValidation = await this.validator.validate();
        if (currentValidation.success) {
          return true;
        }
      } catch (err) {
        logger.error(`Repair attempt ${attempt} failed with error: ${err.message}`);
      }
    }

    return false;
    }
    }

    module.exports = { EnhancedOrchestrator };