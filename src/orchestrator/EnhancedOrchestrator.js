// Global error boundary for EnhancedOrchestrator.js
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Auto-recovery
  if (reason.message?.includes('browser')) {
    console.log('🔄 Auto-recovering browser context...');
    setTimeout(() => process.exit(1), 1000);
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Graceful degradation
  if (error.code === 'ECONNRESET') {
    console.log('🔄 Connection reset - retrying...');
  } else {
    process.exit(1);
  }
});
const path = require('path');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { TaskPlanner } = require('../planner/TaskPlanner');
const { GatewayClient } = require('../gateway-client');
const { RefactorEngine } = require('../smart-tools');
const { TestRunner } = require('../testing');
const { GitManager } = require('../git');
const { SessionMemory } = require('../session');
const logger = require('../logger');
let TraceLogger = null;
try {
  TraceLogger = require('../trace-logger').TraceLogger;
} catch (e) {}

class EnhancedOrchestrator {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.analyzer = null;
    this.planner = null;
    this.gateway = new GatewayClient();
    this.session = new SessionMemory();
    this.refactorEngine = null;
    this.testRunner = null;
    this.gitManager = null;
    this.traceLogger = null;
    
    // Initialize trace logger if SEEKCODE_TRACE is enabled
    if (process.env.SEEKCODE_TRACE === '1' && TraceLogger) {
      const sessionId = `orchestrator_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.traceLogger = new TraceLogger(sessionId);
      this.traceLogger.logEvent('orchestrator_init', { projectPath });
    }
  }

  async init() {
    const cached = this.session.getProjectMap();
    if (cached) logger.info('Using cached project map from session');

    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    this.session.storeProjectMap(this.analyzer.getSummary());

    this.planner = new TaskPlanner(this.analyzer, this.gateway);
    this.refactorEngine = new RefactorEngine(this.analyzer);
    this.testRunner = new TestRunner(this.projectPath);
    this.gitManager = new GitManager(this.projectPath);
    logger.success('Enhanced orchestrator initialized');
    
    if (this.traceLogger) {
      this.traceLogger.logEvent('init_complete', { 
        projectSummary: this.analyzer.getSummary() 
      });
    }
  }

  async run(task) {
    if (this.traceLogger) {
      this.traceLogger.logEvent('run_start', { task });
    }
    
    const planStartTime = Date.now();
    const plan = await this.planner.plan(task);
    const planDuration = Date.now() - planStartTime;

    if (this.traceLogger) {
      this.traceLogger.logStep('planning', 'Generate task plan', 'complete', planDuration, {
        stepsCount: plan.steps?.length || 0,
        hasQuickAnswer: !!plan.quickAnswer
      });
    }

    // ---- Quick answer (question, no action needed) ----
    if (plan.quickAnswer) {
      const summary = this.analyzer.getSummary();
      const files = this.analyzer.getDependencyGraph().getAllFiles();
      const answer =
        'Project: ' + summary.project +
        '\nFramework: ' + (summary.meta.framework || 'none') +
        '\nLanguage: ' + summary.meta.language +
        '\nFiles: ' + files.length + ' source files' +
        '\nTop-level modules: ' + files.filter(f => !f.includes('/')).join(', ');
      try { await this.gateway.closeSession(); } catch {}
      
      if (this.traceLogger) {
        this.traceLogger.logEvent('quick_answer', { answer: answer.substring(0, 200) });
        this.traceLogger.close();
      }
      return answer;
    }

    logger.header('Execution Plan');
    plan.steps.forEach((s, i) => console.log('  ' + (i+1) + '. ' + s));

    await this.gateway.createSession();
    let finalResult = '';
    const context = JSON.stringify({
      project: this.analyzer.getSummary(),
      dependencyGraph: this.analyzer.getDependencyGraph().toJSON(),
      recentTasks: this.session.getRecentTasks()
    }, null, 2);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepStartTime = Date.now();
      const stepId = `step_${i+1}`;
      
      if (this.traceLogger) {
        this.traceLogger.logStep(stepId, step, 'start', null, { stepIndex: i+1, totalSteps: plan.steps.length });
      }
      
      logger.header('Step ' + (i+1) + '/' + plan.steps.length + ': ' + step.substring(0, 80));

      const prompt = [
        'You are SeekCode, executing a step in a larger task.',
        'PROJECT CONTEXT: ' + context,
        'OVERALL TASK: ' + task,
        'CURRENT STEP: ' + step,
        'Execute this step using tools. After completion, output ONLY a plain text summary.'
      ].join('\n');

      try {
        const result = await this.gateway.chat(prompt);
        const stepDuration = Date.now() - stepStartTime;
        
        if (this.traceLogger) {
          this.traceLogger.logStep(stepId, step, 'complete', stepDuration, {
            resultLength: result.length,
            stepIndex: i+1
          });
        }
        
        logger.success('Step ' + (i+1) + ' done');
        finalResult += 'Step ' + (i+1) + ': ' + step + '\n' + result + '\n\n';
      } catch (err) {
        const stepDuration = Date.now() - stepStartTime;
        
        if (this.traceLogger) {
          this.traceLogger.logStep(stepId, step, 'error', stepDuration, {
            error: err.message,
            stepIndex: i+1
          });
        }
        
        logger.error('Step ' + (i+1) + ' failed: ' + err.message);
        finalResult += 'Step ' + (i+1) + ': ' + step + ' ERROR: ' + err.message + '\n\n';
      }
    }

    if (this.testRunner) {
      const testStartTime = Date.now();
      logger.info('Running test suite...');
      const testResult = await this.testRunner.run();
      const testDuration = Date.now() - testStartTime;
      
      if (this.traceLogger) {
        this.traceLogger.logStep('testing', 'Run test suite', testResult.success ? 'complete' : 'error', testDuration, {
          success: testResult.success,
          outputLength: testResult.output?.length || 0
        });
      }
      
      if (testResult.success) logger.success('All tests passed');
      else logger.warn('Tests failed — see output');
      finalResult += '\nTests: ' + (testResult.success ? 'PASSED' : 'FAILED') + '\n' + testResult.output;
    }

    if (this.gitManager && this.gitManager.isRepo()) {
      logger.info('Staging changes...');
      this.gitManager.stageAll();
      this.gitManager.commit('SeekCode: ' + task.substring(0, 72));
      
      if (this.traceLogger) {
        this.traceLogger.logEvent('git_commit', { task: task.substring(0, 72) });
      }
    }

    this.session.rememberTask(task, finalResult.substring(0, 500));
    try { await this.gateway.closeSession(); } catch {}
    
    if (this.traceLogger) {
      this.traceLogger.logEvent('run_complete', { 
        resultLength: finalResult.length,
        stepsCompleted: plan.steps.length
      });
      this.traceLogger.close();
    }
    
    return finalResult;
  }
}

module.exports = { EnhancedOrchestrator };
