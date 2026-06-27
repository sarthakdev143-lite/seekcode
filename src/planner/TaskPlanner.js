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
      return this._finalizePlan(taskDescription, steps);
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
      return this._finalizePlan(taskDescription, steps);
    }

    // Package / dependency tasks
    if (/\b(install|package|dependency|npm|node_modules)\b/i.test(lower)) {
      const steps = [
        'Read package.json to see current dependencies',
        'Run npm install or add new packages as specified',
        'Verify installation by importing a package'
      ];
      return this._finalizePlan(taskDescription, steps);
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
      'Output ONLY a JSON object with this shape:',
      '{"steps":[{"description":"...","inspect":["file"],"change":["file"],"reads":["file"],"writes":["file"],"dependsOn":[0]}],"validationCommand":"npm test","rollbackRisk":"low|medium|high"}.',
      'Every step must include files to inspect, likely files to change, validation needs, rollback risk, and dependency ordering where applicable.',
      '',
      'PROJECT CONTEXT:',
      context,
      '',
      'USER TASK: ' + task
    ].join('\n');

    const response = await this.gateway.chat(planningPrompt, 'planner', 'R1');
    const rawPlan = this._parseJsonFromResponse(response, 'object');
    const steps = rawPlan.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('LLM plan response did not contain non-empty steps');
    }

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
      annotatedSteps = steps.map(s => typeof s === 'string' ? { description: s, reads: [], writes: [] } : s);
    }

    return this._finalizePlan(task, annotatedSteps, rawPlan);
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

    const annotated = this._parseJsonFromResponse(cleaned, 'array');

    // Validate shape — must be array of objects with description/reads/writes
    if (!Array.isArray(annotated) || annotated.length !== steps.length) {
      throw new Error(
        `Annotation array length mismatch: expected ${steps.length}, got ${annotated.length}`
      );
    }

    return annotated.map((item, i) => {
      const original = typeof steps[i] === 'string' ? { description: steps[i] } : steps[i];
      return {
        ...original,
        description: item.description || original.description,
        inspect: Array.isArray(original.inspect) ? original.inspect : [],
        change: Array.isArray(original.change) ? original.change : [],
        reads:  Array.isArray(item.reads)  ? item.reads  : (Array.isArray(original.reads) ? original.reads : []),
        writes: Array.isArray(item.writes) ? item.writes : (Array.isArray(original.writes) ? original.writes : []),
      };
    });
  }

  _parseJsonFromResponse(response, expectedType) {
    const cleaned = String(response || '')
      .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();

    const extracted = expectedType === 'array'
      ? this._extractBalanced(cleaned, '[', ']')
      : this._extractBalanced(cleaned, '{', '}');
    if (!extracted) {
      throw new Error(`Invalid LLM response: expected JSON ${expectedType}`);
    }

    try {
      const parsed = this._safeJsonParse(extracted);
      if (expectedType === 'array' && !Array.isArray(parsed)) {
        throw new Error('Expected JSON array');
      }
      if (expectedType === 'object' && (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')) {
        throw new Error('Expected JSON object');
      }
      return parsed;
    } catch (err) {
      throw new Error(`Invalid JSON from planner: ${err.message}`);
    }
  }

  _safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch {}
    const withoutTrailingCommas = raw.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(withoutTrailingCommas); } catch {}
    const withoutComments = withoutTrailingCommas
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(withoutComments);
  }

  _extractBalanced(text, open, close) {
    const start = text.indexOf(open);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let quote = null;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (inString) {
        if (ch === quote) {
          inString = false;
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }
      if (ch === open) depth++;
      if (ch === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
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
      if (m) return this._finalizePlan(task, p.handler(m));
    }
    return this._finalizePlan(task, this._genericPlan(task));
  }

  _finalizePlan(task, steps, raw = {}) {
    const normalized = (steps || []).map((step, index) => {
      const obj = typeof step === 'string' ? { description: step } : { ...step };
      return {
        description: obj.description || String(step),
        inspect: Array.isArray(obj.inspect) ? obj.inspect : (Array.isArray(obj.reads) ? obj.reads : []),
        change: Array.isArray(obj.change) ? obj.change : (Array.isArray(obj.writes) ? obj.writes : []),
        reads: Array.isArray(obj.reads) ? obj.reads : [],
        writes: Array.isArray(obj.writes) ? obj.writes : [],
        dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn : [],
        order: index,
      };
    });
    return {
      task,
      steps: normalized,
      filesToInspect: [...new Set(normalized.flatMap(s => [...s.inspect, ...s.reads]))],
      filesLikelyToChange: [...new Set(normalized.flatMap(s => [...s.change, ...s.writes]))],
      validationCommand: raw.validationCommand || this._detectValidationCommand(),
      rollbackRisk: raw.rollbackRisk || this._estimateRollbackRisk(normalized),
      dependencyOrdering: normalized.map(s => ({ step: s.order, dependsOn: s.dependsOn })),
      quickAnswer: raw.quickAnswer,
      relatedFiles: raw.relatedFiles,
    };
  }

  _detectValidationCommand() {
    if (this.meta?.scripts?.test) return 'npm test';
    if (this.meta?.scripts?.build) return 'npm run build';
    if (this.meta?.scripts?.analyze) return 'npm run analyze';
    if (this.graph.getAllFiles().some(f => f.endsWith('.js'))) return 'node -c <changed-js-file>';
    return null;
  }

  _estimateRollbackRisk(steps) {
    const writes = steps.flatMap(s => [...(s.writes || []), ...(s.change || [])]);
    if (writes.some(f => /package-lock|schema|migration|database|auth/i.test(f))) return 'high';
    if (writes.length > 5) return 'medium';
    return 'low';
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
