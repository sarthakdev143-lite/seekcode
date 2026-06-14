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
const { ResearchAgent } = require('../agent/ResearchAgent');
const { ExecutorAgent } = require('../agent/ExecutorAgent');
const { ValidatorAgent } = require('../agent/ValidatorAgent');
const { RepairAgent } = require('../agent/RepairAgent');
const { ReviewerAgent } = require('../agent/ReviewerAgent');
const logger = require('../logger');
const { ErrorMemory } = require('../recovery/ErrorMemory');
const { SelfHealingOrchestrator } = require('../self-healing');
// Cross-session persistent memory
const { ProjectMemory } = require('../session/ProjectMemory');
const { WorkLog } = require('../session/WorkLog');
const { SituationReport } = require('../session/SituationReport');
const { ContextManager } = require('../context/ContextManager');
const { ParallelStepExecutor } = require('./ParallelStepExecutor');
const config = require('../config');

let TraceLogger = null;
try { TraceLogger = require('../trace-logger').TraceLogger; } catch {}

class EnhancedOrchestrator {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.gateway = new GatewayClient(this.projectPath);
    this.session = new SessionMemory();
    this.executionLog = [];
    this.traceLogger = null;
    this.situationReport = null;
    this._sessionId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    this.contextManager = new ContextManager({
      maxContextTokens: config.MAX_CONTEXT_TOKENS || 1000000,
      projectPath: this.projectPath
    });

    // Persistent cross-session memory — initialized immediately
    this.projectMemory = new ProjectMemory(this.projectPath);
    this.workLog = new WorkLog(this.projectPath);
    this._situationReporter = new SituationReport(this.projectPath);

    // Always enable tracing — no env var gate.
    if (TraceLogger) {
      this.traceLogger = new TraceLogger(this._sessionId, this.projectPath);
      this.traceLogger.logEvent('orchestrator_init', { projectPath: this.projectPath });
      const logPath = this.traceLogger.projectLogPath;
      if (logPath) {
        logger.info(`📝 Trace log: ${logPath}`);
        logger.info(`📝 Global log: ${this.traceLogger.globalLogPath}`);
      }
    }
  }

  /** Convenience — log an event without guards everywhere */
  _log(event, data = {}) {
    if (this.traceLogger) this.traceLogger.logEvent(event, data);
  }

  /**
   * Render a single-line ASCII progress bar to the console.
   * e.g.  [█████░░░░░] 50%  Step 3/6: Write server routes
   */
  _renderProgressBar(current, total, label = '') {
    const width  = Math.min(40, (process.stdout.columns || 80) - 30);
    const pct    = total > 0 ? Math.round((current / total) * 100) : 0;
    const filled = Math.round((pct / 100) * width);
    const empty  = width - filled;
    const bar    = '\x1b[32m' + '█'.repeat(filled) + '\x1b[90m' + '░'.repeat(empty) + '\x1b[0m';
    const info   = `\x1b[1m${pct}%\x1b[0m  \x1b[36mStep ${current}/${total}\x1b[0m ${label.slice(0, 60)}`;
    process.stdout.write(`\r\x1b[K  [${bar}] ${info}`);
    if (current >= total) process.stdout.write('\n');
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
    this.selfHealing = new SelfHealingOrchestrator(this.projectPath);
    this.errorMemory = new ErrorMemory(this.projectPath, this.validator);
    this.metrics = new MetricsCollector(this.projectPath);
    this.repositoryMap = new RepositoryMap(this.projectPath, this.analyzer);
    this.repositoryMap.build();
    this.semanticSearch = new SemanticSearch(this.repositoryMap);
    this.plannerAgent = new PlannerAgent(this.planner, this.semanticSearch);
    this.researchAgent = new ResearchAgent(this.gateway);
    this.executorAgent = new ExecutorAgent(this.gateway);

    // Generate situation report from all prior sessions
    this.situationReport = this._situationReporter.generate();
    if (this.situationReport) {
      logger.warn('📋 Prior session history found — injecting situation report into all prompts.');
      this._log('situation_report_loaded', { hasReport: true });
    }

    logger.success('Enhanced orchestrator initialized');
  }

  async run(task, options = {}) {
    this.options = options;
    if (options.port) {
      this.projectMemory.setKnownPort(options.port);
    }
    this.executionLog = [];

    this.contextManager.reset();
    this.contextManager.setTask(task);
    this.contextManager.addMessage('user', `Overall Task: ${task}`);

    // Score all project files
    if (this.contextManager.fileTracker) {
      const filePaths = this.analyzer.getDependencyGraph().getAllFiles().map(f => path.resolve(this.projectPath, f));
      this.contextManager.fileTracker.scoreRelevance(task, filePaths);
    }

    const explicitTaskId = process.env.SEEKCODE_TASK_ID || null;
    const pendingTaskId = TaskManager.findPendingTask(this.projectPath, explicitTaskId);
    const baseContext = this._baseContext();
    let plan;
    const runStart = Date.now();

    this._log('run_start', { task, options, pendingTaskId });
    this._createGitCheckpoint(task, 'pre-task');
    this._updateTopic('Initializing', `Starting task: ${task}`);
    // Record session start in persistent memory
    this.projectMemory.startSession(this._sessionId, task);

    await this.gateway.createSession();
    const startTime = Date.now();

    // Apply read-only mode on gateway client (propagates to all chat calls)
    if (options.readOnly) {
      this.gateway.setReadOnly(true);
      logger.warn('⛔ Read-only mode — no filesystem writes or commands will be executed.');
    } else {
      this.gateway.setReadOnly(false);
    }

    try {
      if (pendingTaskId) {
        this._updateTopic('Resuming', `Continuing previously interrupted task: ${pendingTaskId}`);
        logger.info(`Resuming task: ${pendingTaskId}`);
        this.taskManager = new TaskManager(this.projectPath, pendingTaskId);
        plan = { steps: this.taskManager.state.steps.map(s => s.description) };
        this._log('plan_resumed', { taskId: pendingTaskId, steps: plan.steps });
      } else {
        this._updateTopic('Planning', 'Generating strategic execution plan and semantic mapping');
        this._log('plan_start', { task });
        plan = await this.plannerAgent.plan(task);
        this._log('plan_created', { steps: plan.steps, relatedFiles: plan.relatedFiles, quickAnswer: !!plan.quickAnswer });

        if (plan.quickAnswer) {
          const answer = this._quickAnswer();
          await this.gateway.closeSession();
          return answer;
        }

        this.taskManager = new TaskManager(this.projectPath);
        this.taskManager.setPlan(plan.steps);
      }

      // FEATURE 5: Plan Mode (Speculative Design)
      if (options.planOnly || options.speculate) {
        this._updateTopic('Speculating', 'Drafting architectural proposal before execution');
        const proposal = await this._generateProposal(task, plan);
        const proposalPath = path.join(this.projectPath, 'PROPOSAL.md');
        fs.writeFileSync(proposalPath, proposal);
        logger.success(`Proposal written to ${proposalPath}`);
        return proposal;
      }

      this.journal = new ExecutionJournal(this.projectPath, this.taskManager.taskId);
      this.checkpoints = new CheckpointManager(this.projectPath, this.taskManager.taskId);
      this.validatorAgent = new ValidatorAgent(this.validator, this.metrics, this.journal, this.traceLogger);
      this.repairAgent = new RepairAgent(this.gateway, this.validatorAgent, {
        journal: this.journal,
        checkpoints: this.checkpoints,
        errorMemory: this.errorMemory,
        projectMemory: this.projectMemory,  // NEW: cross-session memory
      });
      this.reviewerAgent = new ReviewerAgent(this.gateway, this.semanticSearch);
      this.journal.record('task-start', { task, plan: plan.steps });
      this.journal.record('confidence-evidence', this._confidenceEvidence(plan));
      if (plan.relatedFiles) this.journal.record('semantic-context', { relatedFiles: plan.relatedFiles });

      logger.header(pendingTaskId ? 'Resuming Execution Plan' : 'Execution Plan');
      plan.steps.forEach((s, i) => {
        const status = this.taskManager.state.steps[i]?.status || 'pending';
        console.log(`  ${i + 1}. [${status}] ${s}`);
      });

      let finalResult = '';
      try {
        finalResult = await ParallelStepExecutor.run(this, plan, task);
      } catch (err) {
        logger.warn(`Parallel execution failed: ${err.message}. Attempting sequential recovery/replanning...`);
        this._log('parallel_execution_failed', { error: err.message });
        const remainingTask = `The previous parallel execution failed. Error: ${err.message}. Please provide a recovery plan to complete the task: ${task}`;
        const newPlan = await this.plannerAgent.plan(remainingTask);
        this.taskManager.setPlan(newPlan.steps);
        for (let i = 0; i < newPlan.steps.length; i++) {
          this._updateTopic(`Recovery Step ${i+1}/${newPlan.steps.length}`, newPlan.steps[i]);
          this._renderProgressBar(i + 1, newPlan.steps.length, newPlan.steps[i]);
          const stepResult = await this._executeStep(i, newPlan.steps[i], newPlan.steps.length, task, this._baseContext(newPlan.steps[i]));
          finalResult += stepResult;
        }
      }

      logger.header('Final Validation');
      let finalValidation = await this.validatorAgent.validate(this._getValidationOptions({ source: 'final' }));
      this._log('validation_final', { success: finalValidation.success, phase: finalValidation.phase, error: finalValidation.error });
      // Persist validation result for future sessions
      this.projectMemory.recordValidation(finalValidation.success, finalValidation.phase, finalValidation.error);

      if (!finalValidation.success) {
        logger.warn('Final validation failed. Attempting autonomous repair...');
        this._log('repair_start', { trigger: 'final_validation', error: finalValidation.error });
        
        const combinedContext = baseContext + '\n\nRECENT CONVERSATION:\n' + this.contextManager.buildContextForLLM();
        const repairSucceeded = await this.repairAgent.repair(finalValidation, 'Final completion', combinedContext);
        this._log('repair_end', { trigger: 'final_validation', success: repairSucceeded });
        if (repairSucceeded) {
          finalValidation = await this.validatorAgent.validate(this._getValidationOptions({ source: 'final-after-repair' }));
          this._log('validation_after_repair', { success: finalValidation.success });
          this.projectMemory.recordValidation(finalValidation.success, finalValidation.phase, finalValidation.error);
        } else {
          // FIX: Previously these new steps were appended to plan.steps AFTER the for-loop
          // had already exited, so they were NEVER executed. We now execute them inline.
          logger.warn('Autonomous repair failed. Triggering re-planning and executing fix steps...');
          const rePlanTask = `The implementation is almost complete but final validation failed: ${finalValidation.error}. Please fix the remaining issues for the task: ${task}`;
          const finalFixPlan = await this.plannerAgent.plan(rePlanTask);
          this._log('replan_after_repair', { steps: finalFixPlan.steps });
          if (finalFixPlan.steps && finalFixPlan.steps.length > 0) {
            // Execute the re-planned steps immediately (was dead code before)
            for (let fi = 0; fi < finalFixPlan.steps.length; fi++) {
              try {
                const fixResult = await this._executeStep(
                  plan.steps.length + fi,
                  finalFixPlan.steps[fi],
                  plan.steps.length + finalFixPlan.steps.length,
                  task,
                  baseContext
                );
                finalResult += fixResult;
              } catch (fixErr) {
                logger.warn(`Fix step ${fi + 1} failed: ${fixErr.message}`);
                this._log('fix_step_error', { step: finalFixPlan.steps[fi], error: fixErr.message });
              }
            }
            // Re-validate after executing fix steps
            finalValidation = await this.validatorAgent.validate(this._getValidationOptions({ source: 'final-after-replan' }));
            this.projectMemory.recordValidation(finalValidation.success, finalValidation.phase, finalValidation.error);
          }
        }
      }

      const allChangedFiles = this.executionLog.flatMap(entry => entry.changedFiles || []);
      const combinedContextForReview = baseContext + '\n\nRECENT CONVERSATION:\n' + this.contextManager.buildContextForLLM();
      let review = finalValidation.success
        ? await this.reviewerAgent.review(task, combinedContextForReview, Array.from(new Set(allChangedFiles)))
        : { passed: false, findings: ['Skipped review because validation failed'] };
      this._log('review_complete', { passed: review.passed, findings: review.findings?.slice(0, 5) });
      this.journal.record('review', review);
      let reviewRepairSucceeded = false;

      if (finalValidation.success && !review.passed) {
        this._log('repair_review_start', { findings: review.findings?.slice(0, 5) });
        const combinedContextForReviewRepair = baseContext + '\n\nRECENT CONVERSATION:\n' + this.contextManager.buildContextForLLM();
        reviewRepairSucceeded = await this.repairAgent.repairReview(task, review, combinedContextForReviewRepair);
        this._log('repair_review_end', { success: reviewRepairSucceeded });
        this.metrics.recordRepair(reviewRepairSucceeded);
        if (reviewRepairSucceeded) {
          const combinedContextForReviewFinal = baseContext + '\n\nRECENT CONVERSATION:\n' + this.contextManager.buildContextForLLM();
          review = await this.reviewerAgent.review(task, combinedContextForReviewFinal, Array.from(new Set(allChangedFiles)));
          this._log('review_after_repair', { passed: review.passed });
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
      const totalDurationMs = Date.now() - runStart;
      const taskOutcome = this.taskManager.state.status === 'completed' && finalValidation.success && review.passed;

      // Persist outcomes to cross-session memory
      const changedFilesAll = this.executionLog.flatMap(e => e.changedFiles || []);
      this.projectMemory.recordFileChanges(changedFilesAll);
      this.projectMemory.endSession(this._sessionId, taskOutcome ? 'success' : finalValidation.success ? 'partial' : 'failed');
      this.workLog.record({
        type: 'session_end',
        task,
        result: finalResult.substring(0, 400),
        success: taskOutcome,
        filesChanged: [...new Set(changedFilesAll)],
        durationMs: totalDurationMs,
      });

      this._log('run_complete', {
        totalDurationMs,
        validationPassed: finalValidation.success,
        reviewPassed: review.passed,
        stepsCompleted: this.taskManager.state.steps.filter(s => s.status === 'completed').length,
        totalSteps: plan.steps.length,
      });
      this.metrics.recordTask(taskOutcome, Date.now() - startTime);
      return finalResult;
    } catch (err) {
      this._log('run_error', { error: err.message, stack: err.stack?.slice(0, 500) });
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
    let changedFiles = [];

    this.taskManager.updateStepStatus(index, 'in-progress');
    logger.header(`Step ${index + 1}/${totalSteps}: ${step.substring(0, 80)}`);
    this.journal.record('step-start', { index: index + 1, step });

    const backup = await this.selfHealing.createBackup(Array.from(before.keys()));

    // Refresh scores and cache contents of top relevant files
    if (this.contextManager.fileTracker) {
      const filePaths = this.analyzer.getDependencyGraph().getAllFiles().map(f => path.resolve(this.projectPath, f));
      this.contextManager.fileTracker.scoreRelevance(`${task} ${step}`, filePaths);
      
      const topFiles = this.contextManager.fileTracker.getTopRelevantFiles(5);
      for (const fp of topFiles) {
        try {
          if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, 'utf8');
            this.contextManager.fileTracker.cacheFileContent(fp, content);
          }
        } catch (e) {
          logger.warn(`Failed to cache content of relevant file ${fp}: ${e.message}`);
        }
      }
    }

    // ENHANCEMENT: Cognitive Loop (Research -> Strategy -> Execution)
    const semanticFiles = this.semanticSearch.search(`${task} ${step}`, 8).map(r => ({
      path: r.path,
      score: Number(r.score.toFixed(3)),
      symbols: r.symbols.slice(0, 8)
    }));

    let researchFindings = '';
    try {
      logger.info(`Starting codebase research for step ${index + 1}...`);
      this._log('research_start', { stepIndex: index + 1, step, semanticFiles: semanticFiles.length });
      researchFindings = await this.researchAgent.research(task, step, baseContext, semanticFiles);
      this._log('research_end', { stepIndex: index + 1, findingsLen: researchFindings.length });
      logger.success(`Research phase complete.`);
    } catch (researchErr) {
      logger.warn(`Research phase failed or timed out: ${researchErr.message}. Falling back to default step execution.`);
      this._log('research_error', { stepIndex: index + 1, error: researchErr.message });
      researchFindings = `Research failed: ${researchErr.message}`;
    }

    // Record step user prompt context
    const stepPrompt = `Current Step (${index + 1}/${totalSteps}): ${step}\nResearch Findings:\n${researchFindings}`;
    this.contextManager.addMessage('user', stepPrompt);
    const dynamicConversationContext = this.contextManager.buildContextForLLM();

    const prompt = [
      'You are SeekCode, a senior agentic software engineer. Follow this disciplined cycle:',
      '',
      '1. STRATEGY: Explain your planned changes concisely before executing.',
      '2. EXECUTION: Use surgical tools (replace_in_file) whenever possible. Avoid full-file rewrites.',
      '3. VALIDATION: After every change, run tests or build to verify.',
      '',
      'PROJECT CONTEXT:',
      baseContext,
      '',
      'CONVERSATION AND RESEARCH CONTEXT:',
      dynamicConversationContext,
      '',
      'If you identify a bug during implementation, fix it immediately.',
      'Be thorough. If you fail to fix an issue in 3 attempts, backtrack and re-evaluate your strategy.'
    ].join('\n');

    try {
      const result = await this.selfHealing.executeWithRetry(async () => {
        return await this.executorAgent.execute(prompt);
      }, step);

      // Record assistant executor completion
      this.contextManager.addMessage('assistant', result);

      changedFiles = this._diffSnapshot(before, this._snapshotWorkspace());
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
        const validation = await this.validatorAgent.validate(this._getValidationOptions({ source: 'step', index: index + 1, changedFiles }));

        // Record validation outcome
        this.contextManager.addMessage('tool', `Validation [${validation.success ? 'SUCCESS' : 'FAILED'}]: ${validation.error || 'Passed checks.'}`);

        if (!validation.success) {
          const combinedRepairContext = baseContext + '\n\nRECENT CONVERSATION:\n' + this.contextManager.buildContextForLLM();
          const repaired = await this.repairAgent.repair(validation, step, combinedRepairContext);
          this._log('repair_step', { stepIndex: index + 1, success: repaired, error: validation.error });
          this.metrics.recordRepair(repaired);
          if (!repaired) {
            this.executionLog[this.executionLog.length - 1].validationFailed = true;
            this.taskManager.failStep(index, validation.error || 'Validation failed');
            throw new Error(`Validation failed after step ${index + 1}: ${validation.error || validation.phase}`);
          }
          // Record successful repair
          this.contextManager.addMessage('assistant', `Step ${index + 1} repaired successfully.`);
          await this.analyzer.analyze();
          this.repositoryMap.updateChangedFiles(changedFiles);
          this.semanticSearch.refresh();
        } else {
          this.checkpoints.create('milestone-complete', {
            filesChanged: changedFiles,
            completedTasks: this.taskManager.state.steps.filter((s, i) => i <= index && s.status === 'completed').map(s => s.description),
            validationStatus: { success: true }
          });
          this._createGitCheckpoint(task, `Step ${index + 1} complete: ${step}`);
        }
      }

      this.taskManager.completeStep(index, result);
      if (this.traceLogger) this.traceLogger.logStep(stepId, step, 'complete', durationMs, { changedFiles });
      return `Step ${index + 1}: ${step}\n${result}\n\n`;
    } catch (err) {
      if (this.selfHealing.rollbackStep) {
        const currentChanged = this._diffSnapshot(before, this._snapshotWorkspace());
        await this.selfHealing.rollbackStep(backup, currentChanged);
      } else {
        await this.selfHealing.rollbackOnFailure(backup);
      }
      const durationMs = Date.now() - stepStart;
      this.metrics.recordStep(false);
      this.taskManager.failStep(index, err.message);
      this.journal.record('step-failed', { index: index + 1, durationMs, error: err.message });
      if (this.traceLogger) this.traceLogger.logStep(stepId, step, 'error', durationMs, { error: err.message });
      throw err;
    }
  }

  _baseContext(currentStep = null) {
    const summary = this.analyzer.getSummary();
    let relevantFilesText = '';
    
    if (currentStep && this.contextManager.fileTracker) {
      const filePaths = this.analyzer.getDependencyGraph().getAllFiles().map(f => path.resolve(this.projectPath, f));
      this.contextManager.fileTracker.scoreRelevance(currentStep, filePaths);
      const topFiles = this.contextManager.fileTracker.getTopRelevantFiles(10);
      if (topFiles.length > 0) {
        relevantFilesText = '\nTop Relevant Files for this step:\n' + topFiles.map(fp => {
          const rel = path.relative(this.projectPath, fp).replace(/\\/g, '/');
          let sigs = '';
          const entry = this.repositoryMap?.map?.files[rel];
          if (entry && entry.exports) {
            sigs = ` (exports: ${entry.exports.join(', ')})`;
          }
          return `- ${rel}${sigs}`;
        }).join('\n');
      }
    }

    const rawContextObj = {
      project: summary,
      recentTasks: this.session.getRecentTasks(),
      repositoryMap: {
        updatedAt: this.repositoryMap?.map?.updatedAt,
        files: Object.keys(this.repositoryMap?.map?.files || {}).length
      }
    };
    
    let ctx = JSON.stringify(rawContextObj, null, 2);
    if (relevantFilesText) {
      ctx += '\n' + relevantFilesText;
    }

    if (this.situationReport) {
      return this.situationReport + '\n\nPROJECT CONTEXT:\n' + ctx;
    }
    return ctx;
  }

  _getValidationOptions(extra = {}) {
    const valOpts = { ...extra };
    const port = this.options?.port || this.projectMemory.getLastKnownPort();
    if (port) valOpts.port = port;
    const startCmd = this.options?.startCommand || this.validator.startCommand;
    if (startCmd) valOpts.startCommand = startCmd;
    return valOpts;
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

  _updateTopic(title, intent) {
    this.currentTopic = { title, intent, timestamp: new Date().toISOString() };
    if (this.traceLogger) this.traceLogger.logEvent('topic_update', this.currentTopic);
    logger.topic(title, intent);
  }

  async _generateProposal(task, plan) {
    const prompt = [
      'You are SeekCode in SPECULATION MODE.',
      'Draft a detailed PROPOSAL.md for the following task.',
      '',
      'TASK:',
      task,
      '',
      'PLAN:',
      plan.steps.join('\n'),
      '',
      'Your proposal should include:',
      '1. Impact Analysis: Which files will be changed?',
      '2. Implementation Detail: How will each step be implemented? (provide pseudo-code)',
      '3. Risks: What could go wrong?',
      '4. Verification: How will we know it works?',
      '',
      'Output ONLY the markdown content for PROPOSAL.md.'
    ].join('\n');
    await this.gateway.createSession();
    const proposal = await this.gateway.chat(prompt, 'planner', 'R1');
    await this.gateway.closeSession();
    return proposal;
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
