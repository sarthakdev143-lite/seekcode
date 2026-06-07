const path = require('path');
const logger = require('../logger');

class TaskPlanner {
  constructor(analyzer, gateway = null) {
    this.analyzer = analyzer;
    this.graph = analyzer.getDependencyGraph();
    this.meta = analyzer.meta;
    this.fileDetails = analyzer.fileDetails;
    this.gateway = gateway;  // optional GatewayClient
  }

  async plan(taskDescription) {
    if (this.gateway) {
      try {
        return await this._llmPlan(taskDescription);
      } catch (e) {
        logger.warn('LLM planning failed, falling back to rule-based: ' + e.message);
      }
    }
    return this._ruleBasedPlan(taskDescription);
  }

  async _llmPlan(task) {
    const context = JSON.stringify({
      project: this.analyzer.getSummary(),
      files: this.graph.getAllFiles().slice(0, 50),
      dependencies: this.graph.toJSON(),
      meta: this.meta
    }, null, 2);

    const prompt = [
      'You are a task planner for a coding assistant. Given the project context and user task,',
      'generate a list of atomic steps (as a JSON array of strings) to accomplish the task.',
      'Each step should be something a code agent can do: "Read file X", "Modify Y", etc.',
      'Output ONLY a JSON object: {"steps": ["step1", "step2", ...]}. No other text.',
      '',
      'PROJECT CONTEXT:',
      context,
      '',
      'USER TASK: ' + task
    ].join('\n');

    const response = await this.gateway.chat(prompt);
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      return { task, steps: plan.steps };
    }
    throw new Error('Invalid LLM plan response');
  }

  _ruleBasedPlan(task) {
    logger.info('Planning task: ' + task.substring(0, 80));
    const patterns = [
      { match: /add\s+typescript/i, handler: () => this._planAddTypeScript() },
      { match: /add\s+tests?/i, handler: () => this._planAddTests() },
      { match: /refactor\s+(.+)/i, handler: (m) => this._planRefactor(m[1]) },
      { match: /fix\s+bug\s*(.+)?/i, handler: (m) => this._planBugFix(m[1] || '') },
      { match: /create\s+(.+)/i, handler: (m) => this._planCreateFeature(m[1]) },
    ];
    for (const p of patterns) {
      const m = task.match(p.match);
      if (m) return { task, steps: p.handler(m) };
    }
    return { task, steps: this._genericPlan(task) };
  }

  _planAddTypeScript() {
    const steps = [];
    if (this.meta.language !== 'typescript') {
      steps.push('Install typescript and @types/node');
      steps.push('Create tsconfig.json with strict settings');
      const jsFiles = this.graph.getAllFiles().filter(f => f.endsWith('.js'));
      jsFiles.forEach(f => steps.push('Rename ' + f + ' to ' + f.replace('.js', '.ts')));
      steps.push('Update imports in all files');
    } else {
      steps.push('Project already uses TypeScript.');
    }
    return steps;
  }

  _planAddTests() {
    const steps = [];
    if (!this.meta.testing) steps.push('Install jest and configure');
    const srcFiles = this.graph.getAllFiles().filter(f => !f.includes('.test.') && !f.includes('.spec.'));
    srcFiles.forEach(f => steps.push('Write tests for ' + f));
    return steps;
  }

  _planRefactor(target) {
    const related = this.graph.getAllFiles().filter(f => f.toLowerCase().includes(target.toLowerCase()));
    const steps = [];
    if (related.length === 0) {
      steps.push('Search for "' + target + '" usage across codebase');
    } else {
      steps.push('Refactor files: ' + related.join(', '));
    }
    steps.push('Run tests to verify no regressions');
    return steps;
  }

  _planBugFix(desc) {
    const steps = ['Identify related files using error message/logs'];
    if (desc) steps.push('Search for "' + desc + '" in codebase');
    steps.push('Implement fix, add regression test');
    return steps;
  }

  _planCreateFeature(name) {
    return [
      'Define the feature specification',
      'Create new module: src/' + name.toLowerCase().replace(/\s+/g, '-') + '.js',
      'Integrate with existing codebase',
      'Write tests for the new module'
    ];
  }

  _genericPlan(task) {
    return [
      'Read the project README and package.json to understand the project',
      'Explore the directory structure',
      'Identify relevant modules',
      'Determine changes needed for: ' + task,
      'Execute changes step by step',
      'Run tests and verify'
    ];
  }
}

module.exports = { TaskPlanner };
