'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');
const { ErrorFingerprint } = require('./ErrorFingerprint');

class ErrorMemory {
  constructor(projectDir, validator) {
    this.projectDir = projectDir;
    this.validator = validator;
    this.file = path.join(projectDir, '.seekcode', 'error-memory.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    return { version: 1, failures: {}, fixes: {} };
  }

  save() {
    atomicWriteJson(this.file, this.data);
  }

  record(validation, fixed = false, fix = null) {
    const text = validation?.error || validation?.output || '';
    const fingerprint = ErrorFingerprint.hash(text);
    const entry = this.data.failures[fingerprint] || { count: 0, firstSeen: new Date().toISOString(), examples: [] };
    entry.count += 1;
    entry.lastSeen = new Date().toISOString();
    entry.phase = validation?.phase;
    if (text && entry.examples.length < 3) entry.examples.push(String(text).slice(0, 1000));
    this.data.failures[fingerprint] = entry;
    if (fixed && fix) this.data.fixes[fingerprint] = { ...fix, updatedAt: new Date().toISOString() };
    this.save();
    return fingerprint;
  }

  async applyKnownFix(validation) {
    const text = `${validation?.error || ''}\n${validation?.output || ''}`;
    const missing = text.match(/Cannot find module ['"]([^'"]+)['"]|Module not found:.*Can't resolve ['"]([^'"]+)['"]/i);
    const pkg = missing && this._packageName(missing[1] || missing[2]);
    if (!pkg || pkg.startsWith('.') || pkg.startsWith('/')) return { applied: false };
    if (this._hasDependency(pkg)) return { applied: false };
    const result = await this.validator.runCommand(`npm install ${pkg}`, { timeoutMs: 120000 });
    if (!result.success) return { applied: false, error: result.error || result.output };
    return { applied: true, kind: 'missing-package', package: pkg };
  }

  _packageName(specifier) {
    if (!specifier) return null;
    if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
    return specifier.split('/')[0];
  }

  _hasDependency(pkg) {
    try {
      const pkgPath = path.join(this.projectDir, 'package.json');
      const data = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return Boolean(data.dependencies?.[pkg] || data.devDependencies?.[pkg] || data.peerDependencies?.[pkg]);
    } catch {
      return false;
    }
  }
}

module.exports = { ErrorMemory };
