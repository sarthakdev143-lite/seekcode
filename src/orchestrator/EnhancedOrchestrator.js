const path = require('path');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { TaskPlanner } = require('../planner/TaskPlanner');
const { GatewayClient } = require('../gateway-client');
const { RefactorEngine } = require('../smart-tools');
const { TestRunner } = require('../testing');
const { GitManager } = require('../git');
const { SessionMemory } = require('../session');
const logger = require('../logger');

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
  }

  async init() {
    const cached = this.session.getProjectMap();
    if (cached) logger.info('Using cached project map from session');

    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    this.session.storeProjectMap(this.analyzer.getSummary());

    this.planner = new TaskPlanner(this.analyzer);
    this.refactorEngine = new RefactorEngine(this.analyzer);
    this.testRunner = new TestRunner(this.projectPath);
    this.gitManager = new GitManager(this.projectPath);
    logger.success('Enhanced orchestrator initialized');
  }

  async run(task) {
    const plan = await this.planner.plan(task);
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
        logger.success('Step ' + (i+1) + ' done');
        finalResult += 'Step ' + (i+1) + ': ' + step + '\n' + result + '\n\n';
      } catch (err) {
        logger.error('Step ' + (i+1) + ' failed: ' + err.message);
        finalResult += 'Step ' + (i+1) + ': ' + step + ' ERROR: ' + err.message + '\n\n';
      }
    }

    if (this.testRunner) {
      logger.info('Running test suite...');
      const testResult = await this.testRunner.run();
      if (testResult.success) logger.success('All tests passed');
      else logger.warn('Tests failed Ã¢â‚¬â€ see output');
      finalResult += '\nTests: ' + (testResult.success ? 'PASSED' : 'FAILED') + '\n' + testResult.output;
    }

    if (this.gitManager && this.gitManager.isRepo()) {
      logger.info('Staging changes...');
      this.gitManager.stageAll();
      this.gitManager.commit('SeekCode: ' + task.substring(0, 72));
    }

    this.session.rememberTask(task, finalResult.substring(0, 500));
    try { try { await this.gateway.closeSession(); } catch (e) { /* ignore */ }; } catch (e) { /* ignore */ };
    return finalResult;
  }
}

module.exports = { EnhancedOrchestrator };
