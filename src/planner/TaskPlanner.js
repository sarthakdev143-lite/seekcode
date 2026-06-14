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

  // -- LLM planning --
  async _llmPlan(task) {
    const context = JSON.stringify({
      project: this.analyzer.getSummary(),
      files: this.graph.getAllFiles().slice(0, 50),
      dependencies: this.graph.toJSON(),
      meta: this.meta
    }, null, 2);

    const planningPrompt = [
      'You are a senior technical architect and task planner for an AI coding agent.',
      'Given the project context and user task, generate a detailed execution plan.',
      '',
      'STRATEGY: Use an Incremental Development Strategy.',
      '- Split complex tasks into logical milestones (e.g., Setup, Database, Logic, Integration, Testing).',
      '- Each milestone should have atomic steps.',
      '- Include validation steps (run tests, build) after each major milestone.',
      '',
      'Output ONLY a JSON object: {"steps": ["step1", "step2", ...]}.',
      '',
      'PROJECT CONTEXT:',
      context,
      '',
      'USER TASK: ' + task
    ].join('\n');

    const response = await this.gateway.chat(planningPrompt, 'planner', 'R1');
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid LLM plan response');

    const rawPlan = JSON.parse(jsonMatch[0]);
    const steps = rawPlan.steps;

    // ── OPTION B: Dry-Run Annotation Pass ────────────────────────────────────
    // After generating the step list, do a second LLM round-trip that asks the
    // model to annotate each step with the files it EXPECTS to read and write.
    // This gives the DAG builder real file-level data rather than heuristic
    // keyword matching, making dependency inference dramatically more accurate.
    let annotatedSteps;
    try {
      annotatedSteps = await this._annotatePlanWithFiles(steps, context, task);
      logger.info(`[Planner] Annotation pass complete. ${annotatedSteps.length} steps enriched with file estimates.`);
    } catch (e) {
      logger.warn(`[Planner] Annotation pass failed (${e.message}). Falling back to raw step list.`);
      // Fallback: wrap raw strings in the expected shape
      annotatedSteps = steps.map(s => ({ description: s, reads: [], writes: [] }));
    }

    return { task, steps: annotatedSteps };
  }

  /**
   * Dry-Run Annotation Pass (Option B).
   *
   * Sends a second prompt asking the LLM to enrich each step with:
   *   - `description`: the original step text (unchanged)
   *   - `reads`:  list of relative file paths this step will read
   *   - `writes`: list of relative file paths this step will create or modify
   *
   * The result is used by ParallelStepExecutor to build an accurate DAG
   * without relying on keyword heuristics.
   *
   * @param {string[]} steps      Raw step descriptions from the first LLM pass
   * @param {string}   context    JSON project context (same as planning pass)
   * @param {string}   task       Original user task description
   * @returns {Promise<Array<{description:string, reads:string[], writes:string[]}>>}
   */
  async _annotatePlanWithFiles(steps, context, task) {
    const stepsJson = JSON.stringify(steps, null, 2);
    const existingFiles = this.graph.getAllFiles().slice(0, 80).join('\n');

    const annotationPrompt = [
      'You are a planning assistant for an AI coding agent.',
      'Below is an execution plan (list of steps) for a coding task.',
      'Your job is to annotate each step with the files it will READ and WRITE.',
      '',
      'Rules:',
      '- Use RELATIVE paths from the project root (e.g. src/api/auth.js).',
      '- "reads" = files this step reads as input (must exist before the step runs).',
      '- "writes" = files this step creates or modifies (will exist after the step runs).',
      '- If a step only runs a command (e.g. npm install, git commit), use empty arrays.',
      '- Estimate new file paths that do not yet exist based on the project structure.',
      '- Output ONLY a JSON array (no markdown fences) matching this shape:',
      '  [',
      '    { "description": "<original step text>", "reads": ["path/a"], "writes": ["path/b"] },',
      '    ...',
      '  ]',
      '',
      'EXISTING PROJECT FILES (for reference):',
      existingFiles,
      '',
      'USER TASK: ' + task,
      '',
      'STEPS TO ANNOTATE:',
      stepsJson
    ].join('\n');

    const response = await this.gateway.chat(annotationPrompt, 'planner-annotator', 'V3');

    // Extract the JSON array from the response (strip any accidental markdown fences)
    const cleaned = response
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();

    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrMatch) throw new Error('Annotation response did not contain a JSON array');

    const annotated = JSON.parse(arrMatch[0]);

    // Validate shape — must be array of objects with description/reads/writes
    if (!Array.isArray(annotated) || annotated.length !== steps.length) {
      throw new Error(
        `Annotation array length mismatch: expected ${steps.length}, got ${annotated.length}`
      );
    }

    return annotated.map((item, i) => ({
      description: item.description || steps[i],
      reads:  Array.isArray(item.reads)  ? item.reads  : [],
      writes: Array.isArray(item.writes) ? item.writes : [],
    }));
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
