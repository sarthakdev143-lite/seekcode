const path = require('path');
const logger = require('../logger');

class TaskPlanner {
  constructor(analyzer, gateway = null) {
    this.analyzer = analyzer;
    this.graph = analyzer.getDependencyGraph();
    this.meta = analyzer.meta;
    this.fileDetails = analyzer.fileDetails;
    this.gateway = gateway;
  }

  // Decide if it's a pure question
  _isQuestion(task) {
    const q = /\b(what|who|where|when|why|how|list|show|tell|describe|explain|are there|is there|do you|can you see|see|find|search)\b/i;
    const act = /\b(create|make|build|write|add|remove|delete|update|change|refactor|fix|implement|run|execute)\b/i;
    return q.test(task) && !act.test(task);
  }

  async plan(taskDescription) {
    // ---- Quick question ----
    if (this._isQuestion(taskDescription)) {
      logger.info('Quick answer – no code changes.');
      return { task: taskDescription, steps: [], quickAnswer: true };
    }

    // ---- Special common tasks ----
    const lower = taskDescription.toLowerCase();

    // README creation
    if (/\b(readme|read me|read_me)\b/i.test(lower)) {
      const steps = [
        'Check if README.md already exists',
        'If not, create a README.md with project name, description, installation, and usage',
        'Add the README to git and commit'
      ];
      return { task: taskDescription, steps };
    }

    // Git / GitHub tasks
    if (/\b(git|github|commit|push|upload|remote)\b/i.test(lower)) {
      const steps = [
        'Check if the project is a git repository; if not, run git init',
        'Stage all files with git add -A',
        'Commit changes with a descriptive message',
        'If a remote URL is provided, add it; otherwise ask the user for the GitHub repo URL',
        'Push to the remote repository'
      ];
      return { task: taskDescription, steps };
    }

    // Package / dependency tasks
    if (/\b(install|package|dependency|npm|node_modules)\b/i.test(lower)) {
      const steps = [
        'Read package.json to see current dependencies',
        'Run npm install or add new packages as specified',
        'Verify installation by importing a package'
      ];
      return { task: taskDescription, steps };
    }

    // ---- Fallback: LLM or rule-based ----
    if (this.gateway) {
      try { return await this._llmPlan(taskDescription); }
      catch (e) { logger.warn('LLM planning failed, falling back to rule-based: ' + e.message); }
    }
    return this._ruleBasedPlan(taskDescription);
  }

  // -- LLM planning (unchanged) --
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
      'Each step should be something a code agent can do.',
      'Output ONLY a JSON object: {"steps": ["step1", "step2", ...]}. No other text.',
      '',
      'PROJECT CONTEXT:',
      context,
      '',
      'USER TASK: ' + task
    ].join('\n');

    const response = await this.gateway.chat(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const plan = JSON.parse(jsonMatch[0]);
      return { task, steps: plan.steps };
    }
    throw new Error('Invalid LLM plan response');
  }

  // -- Rule-based (original) --
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
    } else { steps.push('Project already uses TypeScript.'); }
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
    return related.length
      ? ['Refactor files: ' + related.join(', '), 'Run tests']
      : ['Search for "' + target + '" usage', 'Refactor identified code'];
  }

  _planBugFix(desc) {
    const s = ['Identify related files using error logs'];
    if (desc) s.push('Search for "' + desc + '" in codebase');
    s.push('Implement fix, add regression test');
    return s;
  }

  _planCreateFeature(name) {
    return [
      'Define the feature specification',
      'Create new module: src/' + name.toLowerCase().replace(/\s+/g,'-') + '.js',
      'Integrate with existing codebase',
      'Write tests'
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
