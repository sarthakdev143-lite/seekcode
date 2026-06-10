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
const { RepositoryMap } = require('../semantic/RepositoryMap');
const { SemanticSearch } = require('../semantic/SemanticSearch');
const { PlannerAgent } = require('../agent/PlannerAgent');
const { ExecutorAgent } = require('../agent/ExecutorAgent');
const { ValidatorAgent } = require('../agent/ValidatorAgent');
const { RepairAgent } = require('../agent/RepairAgent');
const { ReviewerAgent } = require('../agent/ReviewerAgent');
const logger = require('../logger');
const { ErrorMemory } = require('../recovery/ErrorMemory');

let TraceLogger = null;
try { TraceLogger = require('../trace-logger').TraceLogger; } catch {}

class EnhancedOrchestrator {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.gateway = new GatewayClient();
    this.session = new SessionMemory();
    this.executionLog = [];
    this.traceLogger = null;

    if (process.env.SEEKCODE_TRACE === '1' && TraceLogger) {
      const sessionId = `orchestrator_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      this.traceLogger = new TraceLogger(sessionId, this.projectPath);
      this.traceLogger.logEvent('orchestrator_init', { projectPath: this.projectPath });
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
    this.errorMemory = new ErrorMemory(this.projectPath, this.validator);
    this.metrics = new MetricsCollector(this.projectPath);
    this.repositoryMap = new RepositoryMap(this.projectPath, this.analyzer);
    this.repositoryMap.build();
    this.semanticSearch = new SemanticSearch(this.repositoryMap);
    this.plannerAgent = new PlannerAgent(this.planner, this.semanticSearch);
    this.executorAgent = new ExecutorAgent(this.gateway);

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
      plan = await this.plannerAgent.plan(task);
      if (plan.quickAnswer) return this._quickAnswer();

      this.taskManager = new TaskManager(this.projectPath);
      this.taskManager.setPlan(plan.steps);
    }

    this.journal = new ExecutionJournal(this.projectPath, this.taskManager.taskId);
    this.checkpoints = new CheckpointManager(this.projectPath, this.taskManager.taskId);
    this.validatorAgent = new ValidatorAgent(this.validator, this.metrics, this.journal, this.traceLogger);
    this.repairAgent = new RepairAgent(this.gateway, this.validatorAgent, { journal: this.journal, checkpoints: this.checkpoints, errorMemory: this.errorMemory });
    this.reviewerAgent = new ReviewerAgent(this.gateway, this.semanticSearch);
    this.journal.record('task-start', { task, plan: plan.steps });
    this.journal.record('confidence-evidence', this._confidenceEvidence(plan));
    if (plan.relatedFiles) this.journal.record('semantic-context', { relatedFiles: plan.relatedFiles });

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
      const finalValidation = await this.validatorAgent.validate({ source: 'final' });
      const allChangedFiles = this.executionLog.flatMap(entry => entry.changedFiles || []);
      let review = finalValidation.success
        ? await this.reviewerAgent.review(task, baseContext, Array.from(new Set(allChangedFiles)))
        : { passed: false, findings: ['Skipped review because validation failed'] };
      this.journal.record('review', review);
      let reviewRepairSucceeded = false;

      if (finalValidation.success && !review.passed) {
        reviewRepairSucceeded = await this.repairAgent.repairReview(task, review, baseContext);
        this.metrics.recordRepair(reviewRepairSucceeded);
        if (reviewRepairSucceeded) {
          review = await this.reviewerAgent.review(task, baseContext, Array.from(new Set(allChangedFiles)));
          this.journal.record('review-after-repair', review);
        }
      }

      if (finalValidation.success && review.passed) {
        this.checkpoints.create('validation-passed', {
          completedTasks: this.taskManager.state.steps.filter(s => s.status === 'completed').map(s => s.description),
          validationStatus: { success: true },
          reviewStatus: review
        });
        finalResult += '\nFinal Validation: PASSED\nReview: PASSED\n';
      } else if (!finalValidation.success) {
        finalResult += `\nFinal Validation: FAILED (${finalValidation.phase})\n${finalValidation.error}\n`;
        if (!review.passed) finalResult += `Review: FAILED\n${(review.findings || []).join('\n')}\n`;
      } else {
        finalResult += `\nFinal Validation: PASSED\nReview: FAILED\n${(review.findings || []).join('\n')}\n`;
      }

      this._createGitCheckpoint(task, 'post-task');
      this.session.rememberTask(task, finalResult.substring(0, 500));
      this.metrics.recordTask(this.taskManager.state.status === 'completed' && finalValidation.success && review.passed, Date.now() - startTime);
      return finalResult;
    } catch (err) {
      this.metrics?.recordTask(false, Date.now() - startTime);
      throw err;
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

    // ENHANCEMENT: Cognitive Loop (Research -> Strategy -> Execution)
    const prompt = [
      'You are SeekCode, a senior agentic software engineer. Follow this disciplined cycle:',
      '',
      '1. RESEARCH: You must understand the relevant code before changing it. Use tools like `read_file` and `find_files`.',
      '2. STRATEGY: Explain your planned changes concisely before executing.',
      '3. EXECUTION: Use surgical tools (replace_in_file) whenever possible. Avoid full-file rewrites.',
      '4. VALIDATION: After every change, run tests or build to verify.',
      '',
      'PROJECT CONTEXT:',
      baseContext,
      '',
      'SEMANTICALLY RELATED FILES:',
      JSON.stringify(this.semanticSearch.search(`${task} ${step}`, 8).map(r => ({
        path: r.path,
        score: Number(r.score.toFixed(3)),
        symbols: r.symbols.slice(0, 8)
      })), null, 2),
      '',
      'OVERALL TASK:',
      task,
      '',
      this._priorWork(),
      `CURRENT STEP (${index + 1}/${totalSteps}):`,
      step,
      '',
      'If you identify a bug during research, fix it immediately even if not explicitly in the step.',
      'Be thorough. If you fail to fix an issue in 3 attempts, backtrack and re-evaluate your strategy.'
    ].join('\n');

    try {
      const result = await this.executorAgent.execute(prompt);
      const changedFiles = this._diffSnapshot(before, this._snapshotWorkspace());
      const durationMs = Date.now() - stepStart;
      if (changedFiles.length) {
        await this.analyzer.analyze();
        this.repositoryMap.updateChangedFiles(changedFiles);
        this.semanticSearch.refresh();
      }

      this.executionLog.push({ index: index + 1, step, summary: result.substring(0, 400), durationMs, changedFiles });
      this.executionLog = this.executionLog.slice(-8);
      this.metrics.recordStep(true);
      this.journal.record('step-complete', { index: index + 1, durationMs, changedFiles, result: result.substring(0, 1000) });

      if (changedFiles.length > 0 || this._resultMentionsToolMutation(result)) {
        const validation = await this.validatorAgent.validate({ source: 'step', index: index + 1, changedFiles });

        if (!validation.success) {
          const repaired = await this.repairAgent.repair(validation, step, baseContext);
          this.metrics.recordRepair(repaired);
          if (!repaired) {
            this.executionLog[this.executionLog.length - 1].validationFailed = true;
            this.taskManager.failStep(index, validation.error || 'Validation failed');
            throw new Error(`Validation failed after step ${index + 1}: ${validation.error || validation.phase}`);
          }
          await this.analyzer.analyze();
          this.repositoryMap.updateChangedFiles(changedFiles);
          this.semanticSearch.refresh();
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
      throw err;
    }
  }

  _baseContext() {
    return JSON.stringify({
      project: this.analyzer.getSummary(),
      dependencyGraph: this.analyzer.getDependencyGraph().toJSON(),
      recentTasks: this.session.getRecentTasks(),
      repositoryMap: {
        updatedAt: this.repositoryMap?.map?.updatedAt,
        files: Object.keys(this.repositoryMap?.map?.files || {}).length
      }
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
      planSteps: plan.steps?.length || 0,
      semanticIndexFiles: Object.keys(this.repositoryMap?.map?.files || {}).length,
      relatedFilesFound: plan.relatedFiles?.length || 0
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
