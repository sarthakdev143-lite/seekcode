'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { TaskPlanner } = require('../planner/TaskPlanner');
const { GatewayClient } = require('../gateway-client');
const { RefactorEngine } = require('../smart-tools');
const { TestRunner } = require('../testing');
const { GitManager } = require('../git');
const { SessionMemory } = require('../session');
const { ValidationEngine } = require('./ValidationEngine');
const { TaskManager } = require('./TaskManager');
const { MetricsCollector } = require('./MetricsCollector');
const { ExecutionJournal } = require('./ExecutionJournal');
const { CheckpointManager } = require('./CheckpointManager');
const { ErrorFingerprint } = require('../recovery/ErrorFingerprint');
const logger = require('../logger');

let TraceLogger = null;
try { TraceLogger = require('../trace-logger').TraceLogger; } catch {}

class EnhancedOrchestrator {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.gateway = new GatewayClient();
    this.session = new SessionMemory();
    this.executionLog = [];
    this.repairFingerprints = new Map();
    this.traceLogger = null;

    if (process.env.SEEKCODE_TRACE === '1' && TraceLogger) {
      const sessionId = `orchestrator_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      this.traceLogger = new TraceLogger(sessionId);
      this.traceLogger.logEvent('orchestrator_init', { projectPath });
    }
  }

  async init() {
    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    this.session.storeProjectMap(this.analyzer.getSummary());

    this.planner = new TaskPlanner(this.analyzer, this.gateway);
    this.refactorEngine = new RefactorEngine(this.analyzer);
    this.testRunner = new TestRunner(this.projectPath);
    this.gitManager = new GitManager(this.projectPath);
    this.validator = new ValidationEngine(this.projectPath);
    this.metrics = new MetricsCollector(this.projectPath);

    logger.success('Enhanced orchestrator initialized');
  }

  async run(task) {
    this.executionLog = [];
    const explicitTaskId = process.env.SEEKCODE_TASK_ID || null;
    const pendingTaskId = TaskManager.findPendingTask(this.projectPath, explicitTaskId);
    const baseContext = this._baseContext();
    let plan;

    if (this.traceLogger) this.traceLogger.logEvent('run_start', { task });
    this._createGitCheckpoint(task, 'pre-task');

    if (pendingTaskId) {
      logger.info(`Resuming task: ${pendingTaskId}`);
      this.taskManager = new TaskManager(this.projectPath, pendingTaskId);
      plan = { steps: this.taskManager.state.steps.map(s => s.description) };
    } else {
      plan = await this.planner.plan(task);
      if (plan.quickAnswer) return this._quickAnswer();

      this.taskManager = new TaskManager(this.projectPath);
      this.taskManager.setPlan(plan.steps);
    }

    this.journal = new ExecutionJournal(this.projectPath, this.taskManager.taskId);
    this.checkpoints = new CheckpointManager(this.projectPath, this.taskManager.taskId);
    this.journal.record('task-start', { task, plan: plan.steps });
    this.journal.record('confidence-evidence', this._confidenceEvidence(plan));

    logger.header(pendingTaskId ? 'Resuming Execution Plan' : 'Execution Plan');
    plan.steps.forEach((s, i) => {
      const status = this.taskManager.state.steps[i]?.status || 'pending';
      console.log(`  ${i + 1}. [${status}] ${s}`);
    });

    await this.gateway.createSession();
    let finalResult = '';
    const startTime = Date.now();

    try {
      for (let i = this.taskManager.state.currentStepIndex; i < plan.steps.length; i++) {
        const stepResult = await this._executeStep(i, plan.steps[i], plan.steps.length, task, baseContext);
        finalResult += stepResult;
      }

      logger.header('Final Validation');
      const finalValidation = await this.validator.validate();
      this.metrics.recordValidation(finalValidation);
      this.journal.record('final-validation', { success: finalValidation.success, phase: finalValidation.phase, error: finalValidation.error });

      if (finalValidation.success) {
        this.checkpoints.create('validation-passed', {
          completedTasks: this.taskManager.state.steps.filter(s => s.status === 'completed').map(s => s.description),
          validationStatus: { success: true }
        });
        finalResult += '\nFinal Validation: PASSED\n';
      } else {
        finalResult += `\nFinal Validation: FAILED (${finalValidation.phase})\n${finalValidation.error}\n`;
      }

      this._createGitCheckpoint(task, 'post-task');
      this.session.rememberTask(task, finalResult.substring(0, 500));
      this.metrics.recordTask(this.taskManager.state.status === 'completed' && finalValidation.success, Date.now() - startTime);
      return finalResult;
    } finally {
      try { await this.gateway.closeSession(); } catch {}
      if (this.traceLogger) this.traceLogger.close();
    }
  }

  async _executeStep(index, step, totalSteps, task, baseContext) {
    const stepStart = Date.now();
    const before = this._snapshotWorkspace();
    const stepId = `step_${index + 1}`;

    this.taskManager.updateStepStatus(index, 'in-progress');
    logger.header(`Step ${index + 1}/${totalSteps}: ${step.substring(0, 80)}`);
    this.journal.record('step-start', { index: index + 1, step });

    const prompt = [
      'You are SeekCode, executing one step of a larger multi-step task.',
      'Read the prior steps carefully. Do not repeat work already done.',
      '',
      'PROJECT CONTEXT:',
      baseContext,
      '',
      'OVERALL TASK:',
      task,
      '',
      this._priorWork(),
      `CURRENT STEP (${index + 1}/${totalSteps}):`,
      step,
      '',
      'Execute this step using tools. When done, output ONLY a plain-text summary of what you did.'
    ].join('\n');

    try {
      const result = await this.gateway.chat(prompt);
      const changedFiles = this._diffSnapshot(before, this._snapshotWorkspace());
      const durationMs = Date.now() - stepStart;

      this.executionLog.push({ index: index + 1, step, summary: result.substring(0, 400), durationMs });
      this.executionLog = this.executionLog.slice(-8);
      this.metrics.recordStep(true);
      this.journal.record('step-complete', { index: index + 1, durationMs, changedFiles, result: result.substring(0, 1000) });

      if (changedFiles.length > 0 || this._resultMentionsToolMutation(result)) {
        const validation = await this.validator.validate();
        this.metrics.recordValidation(validation);
        this.journal.record('validation', { index: index + 1, changedFiles, success: validation.success, phase: validation.phase, error: validation.error });

        if (!validation.success) {
          const repaired = await this._repairLoop(validation, step, baseContext);
          this.metrics.recordRepair(repaired);
          if (!repaired) this.executionLog[this.executionLog.length - 1].validationFailed = true;
        } else {
          this.checkpoints.create('milestone-complete', {
            filesChanged: changedFiles,
            completedTasks: this.taskManager.state.steps.filter((s, i) => i <= index && s.status === 'completed').map(s => s.description),
            validationStatus: { success: true }
          });
        }
      }

      this.taskManager.completeStep(index, result);
      if (this.traceLogger) this.traceLogger.logStep(stepId, step, 'complete', durationMs, { changedFiles });
      return `Step ${index + 1}: ${step}\n${result}\n\n`;
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      this.metrics.recordStep(false);
      this.taskManager.failStep(index, err.message);
      this.journal.record('step-failed', { index: index + 1, durationMs, error: err.message });
      if (this.traceLogger) this.traceLogger.logStep(stepId, step, 'error', durationMs, { error: err.message });
      return `Step ${index + 1}: ${step}\nERROR: ${err.message}\n\n`;
    }
  }

  async _repairLoop(validation, step, baseContext, maxRetries = 3) {
    let currentValidation = validation;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const fingerprint = ErrorFingerprint.hash(currentValidation.error || currentValidation.output || '');
      const attempts = (this.repairFingerprints.get(fingerprint) || 0) + 1;
      this.repairFingerprints.set(fingerprint, attempts);

      this.journal.record('repair-attempt', {
        fingerprint,
        attempts,
        phase: currentValidation.phase,
        error: currentValidation.error
      });

      if (attempts > 1) {
        logger.warn(`Stopping repair: identical failure repeated (${fingerprint})`);
        return false;
      }

      logger.info(`Repair attempt ${attempt}/${maxRetries} for ${currentValidation.phase} failure...`);
      const repairPrompt = [
        'A validation check failed after a step.',
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
        'Diagnose and fix the error using tools. Output ONLY a repair summary.'
      ].join('\n');

      try {
        await this.gateway.chat(repairPrompt);
        currentValidation = await this.validator.validate();
        this.metrics.recordValidation(currentValidation);
        if (currentValidation.success) {
          this.journal.record('repair-success', { fingerprint });
          this.checkpoints.create('repair-success', { validationStatus: { success: true } });
          return true;
        }
      } catch (err) {
        this.journal.record('repair-error', { fingerprint, error: err.message });
      }
    }

    return false;
  }

  _baseContext() {
    return JSON.stringify({
      project: this.analyzer.getSummary(),
      dependencyGraph: this.analyzer.getDependencyGraph().toJSON(),
      recentTasks: this.session.getRecentTasks()
    }, null, 2);
  }

  _quickAnswer() {
    const summary = this.analyzer.getSummary();
    const files = this.analyzer.getDependencyGraph().getAllFiles();
    return [
      `Project: ${summary.project}`,
      `Framework: ${summary.meta.framework || 'none'}`,
      `Language: ${summary.meta.language}`,
      `Files: ${files.length} source files`,
      `Top-level modules: ${files.filter(f => !f.includes('/')).join(', ')}`
    ].join('\n');
  }

  _priorWork() {
    if (this.executionLog.length === 0) return '';
    return [
      'PRIOR STEPS COMPLETED:',
      ...this.executionLog.slice(-4).map(e => `  Step ${e.index}: ${e.step}\n  Result: ${e.summary}`),
      ''
    ].join('\n');
  }

  _snapshotWorkspace() {
    const files = [];
    const skip = new Set(['.git', 'node_modules', '.seekcode']);
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else {
          const stat = fs.statSync(abs);
          files.push({
            file: path.relative(this.projectPath, abs).replace(/\\/g, '/'),
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
        }
      }
    };
    walk(this.projectPath);
    return new Map(files.map(f => [f.file, crypto.createHash('sha1').update(`${f.size}:${f.mtimeMs}`).digest('hex')]));
  }

  _diffSnapshot(before, after) {
    const changed = [];
    for (const [file, sig] of after) {
      if (before.get(file) !== sig) changed.push(file);
    }
    for (const file of before.keys()) {
      if (!after.has(file)) changed.push(file);
    }
    return changed.sort();
  }

  _resultMentionsToolMutation(result) {
    const text = String(result).toLowerCase();
    return ['write_file', 'replace_in_file', 'delete_file', 'move_file', 'npm install', 'package.json'].some(token => text.includes(token));
  }

  _confidenceEvidence(plan) {
    const pkg = path.join(this.projectPath, 'package.json');
    const summary = this.analyzer.getSummary();
    return {
      frameworkRecognized: Boolean(summary.meta?.framework),
      languageRecognized: Boolean(summary.meta?.language),
      packageJsonFound: fs.existsSync(pkg),
      buildCommandDetected: Boolean(this.validator.buildCommand),
      testCommandDetected: Boolean(this.validator.testCommand),
      planSteps: plan.steps?.length || 0
    };
  }

  _createGitCheckpoint(task, label) {
    if (!this.gitManager?.isRepo()) return;
    try {
      const status = this.gitManager._run('git status --porcelain');
      if (status) {
        this.gitManager.stageAll();
        this.gitManager.commit(`seekcode: ${label} ${task.substring(0, 60)}`);
      }
    } catch (err) {
      logger.warn(`${label} git checkpoint failed (non-fatal): ${err.message}`);
    }
  }
}

module.exports = { EnhancedOrchestrator };
