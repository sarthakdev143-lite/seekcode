'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class DeterministicToolbox {
  constructor(projectDir, analyzer, validator) {
    this.projectDir = projectDir;
    this.analyzer = analyzer;
    this.validator = validator;
  }

  collectPlanEvidence(task) {
    const pkg = this._readJson('package.json') || {};
    const graph = this.analyzer?.getDependencyGraph?.();
    const allFiles = graph?.getAllFiles?.() || [];
    const symbols = {};
    for (const [file, detail] of this.analyzer?.fileDetails || []) {
      symbols[file.replace(/\\/g, '/')] = [
        ...(detail.exports || []),
        ...(detail.declarations || []),
      ].map(s => ({
        name: s.name,
        kind: s.kind,
        line: s.line,
        signature: s.signature,
      })).slice(0, 20);
    }

    return {
      task,
      preferredTools: [
        'rg for text search',
        'tree-sitter AST index for symbols',
        'replace_in_file/write_files for structured edits',
        'dependency graph for impact lookup',
        'package.json scripts for command discovery',
      ],
      scripts: pkg.scripts || {},
      detectedCommands: {
        build: this.validator?.buildCommand || null,
        test: this.validator?.testCommand || null,
        start: this.validator?.startCommand || null,
      },
      dependencyGraph: graph?.toJSON?.() || {},
      files: allFiles,
      symbols,
      rgAvailable: this._commandExists('rg'),
    };
  }

  validatePlan(plan) {
    const errors = [];
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push('Plan must include at least one executable step.');
    }

    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    steps.forEach((step, index) => {
      const description = typeof step === 'string' ? step : step?.description;
      if (!description || typeof description !== 'string') {
        errors.push(`Step ${index + 1} is missing a description.`);
      }
      if (step && typeof step === 'object') {
        for (const key of ['inspect', 'change', 'reads', 'writes']) {
          if (step[key] && !Array.isArray(step[key])) errors.push(`Step ${index + 1}.${key} must be an array.`);
        }
      }
    });

    const validationCommand = plan.validationCommand || this.validator?.testCommand || this.validator?.buildCommand || 'changed-file checks';

    return {
      success: errors.length === 0,
      errors,
      validationCommand,
    };
  }

  _readJson(relPath) {
    try {
      const file = path.join(this.projectDir, relPath);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  _commandExists(command) {
    const probe = process.platform === 'win32' ? 'where' : 'command';
    const args = process.platform === 'win32' ? [command] : ['-v', command];
    const result = spawnSync(probe, args, { shell: process.platform !== 'win32', windowsHide: true, stdio: 'ignore' });
    return result.status === 0;
  }
}

module.exports = { DeterministicToolbox };
