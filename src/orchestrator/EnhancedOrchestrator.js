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
const { GitManager }      = require('../git');
const { SessionMemory }   = require('../session');
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
    const planStart = Date.now();
    const plan      = await this.planner.plan(task);
    const planMs    = Date.now() - planStart;

    if (this.traceLogger) {
      this.traceLogger.logStep('planning', 'Generate task plan', 'complete', planMs, {
        stepsCount: plan.steps?.length || 0,
        hasQuickAnswer: !!plan.quickAnswer,
      });
    }

    // ── Quick answer (question, no code changes) ───────────────────────────
    if (plan.quickAnswer) {
      const summary  = this.analyzer.getSummary();
      const files    = this.analyzer.getDependencyGraph().getAllFiles();
      const answer   = [
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

    // ── Execute steps ──────────────────────────────────────────────────────
    logger.header('Execution Plan');
    plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

    await this.gateway.createSession();
    let finalResult = '';

    // Base context — passed to every step
    const baseContext = JSON.stringify({
      project: this.analyzer.getSummary(),
      dependencyGraph: this.analyzer.getDependencyGraph().toJSON(),
      recentTasks: this.session.getRecentTasks(),
    }, null, 2);

    for (let i = 0; i < plan.steps.length; i++) {
      const step      = plan.steps[i];
      const stepStart = Date.now();
      const stepId    = `step_${i + 1}`;

      if (this.traceLogger) {
        this.traceLogger.logStep(stepId, step, 'start', null, {
          stepIndex: i + 1,
          totalSteps: plan.steps.length,
        });
      }

      logger.header(`Step ${i + 1}/${plan.steps.length}: ${step.substring(0, 80)}`);

      // ── FIXED: thread prior step results into each prompt ────────────────
      // Without this, the LLM loses all context from previous steps and
      // can't reference files it already read or changes it already made.
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

        // Record in rolling execution log (capped at last 8 steps to stay lean)
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
        finalResult += `Step ${i + 1}: ${step}\nERROR: ${err.message}\n\n`;

        // Record failure in log so subsequent steps know this step didn't complete
        this.executionLog.push({
          index: i + 1,
          step,
          summary: `FAILED: ${err.message}`,
          durationMs: stepMs,
          failed: true,
        });
      }
    }

    // ── Test suite ─────────────────────────────────────────────────────────
    if (this.testRunner) {
      const testStart = Date.now();
      logger.info('Running test suite...');
      const testResult = await this.testRunner.run();
      const testMs     = Date.now() - testStart;

      if (this.traceLogger) {
        this.traceLogger.logStep(
          'testing', 'Run test suite',
          testResult.success ? 'complete' : 'error',
          testMs,
          { success: testResult.success }
        );
      }

      if (testResult.success) logger.success('All tests passed');
      else logger.warn('Tests failed — see output below');

      finalResult += `\nTests: ${testResult.success ? 'PASSED ✓' : 'FAILED ✗'}\n${testResult.output}`;
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
}

module.exports = { EnhancedOrchestrator };