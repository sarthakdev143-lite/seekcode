'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');
const { tokenize } = require('./tokenize');

class RepositoryMap {
  constructor(projectDir, analyzer) {
    this.projectDir = projectDir;
    this.analyzer = analyzer;
    this.file = path.join(projectDir, '.seekcode', 'index.json');
    this.map = { version: 1, updatedAt: null, files: {} };
  }

  load() {
    try {
      if (fs.existsSync(this.file)) this.map = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    return this.map;
  }

  build() {
    const files = {};
    for (const file of this.analyzer.getDependencyGraph().getAllFiles()) {
      const abs = path.join(this.projectDir, file);
      if (!fs.existsSync(abs)) continue;
      const content = fs.readFileSync(abs, 'utf8');
      const details = this.analyzer.fileDetails.get(file) || { imports: [], exports: [], declarations: [] };
      const stat = fs.statSync(abs);
      const symbols = [
        ...details.declarations.map(d => ({ name: d.name, kind: d.kind, line: d.line })),
        ...details.exports.map(e => ({ name: e.name, kind: e.kind, line: e.line, exported: true }))
      ];

      files[file] = {
        path: file,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        imports: details.imports.map(i => i.module),
        exports: details.exports.map(e => e.name),
        classes: symbols.filter(s => String(s.kind).includes('class')).map(s => s.name),
        functions: symbols.filter(s => String(s.kind).includes('function')).map(s => s.name),
        symbols,
        tokens: this._fileTokens(file, content, symbols)
      };
    }

    this.map = { version: 1, updatedAt: new Date().toISOString(), files };
    atomicWriteJson(this.file, this.map);
    return this.map;
  }

  updateChangedFiles(changedFiles = []) {
    if (!changedFiles.length) return this.map;
    this.load();
    for (const file of changedFiles) {
      if (!this.analyzer.getDependencyGraph().getAllFiles().includes(file)) {
        delete this.map.files[file];
        continue;
      }
      const abs = path.join(this.projectDir, file);
      if (!fs.existsSync(abs)) {
        delete this.map.files[file];
        continue;
      }
      const content = fs.readFileSync(abs, 'utf8');
      const details = this.analyzer.fileDetails.get(file) || { imports: [], exports: [], declarations: [] };
      const stat = fs.statSync(abs);
      const symbols = [
        ...details.declarations.map(d => ({ name: d.name, kind: d.kind, line: d.line })),
        ...details.exports.map(e => ({ name: e.name, kind: e.kind, line: e.line, exported: true }))
      ];
      this.map.files[file] = {
        path: file,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        imports: details.imports.map(i => i.module),
        exports: details.exports.map(e => e.name),
        classes: symbols.filter(s => String(s.kind).includes('class')).map(s => s.name),
        functions: symbols.filter(s => String(s.kind).includes('function')).map(s => s.name),
        symbols,
        tokens: this._fileTokens(file, content, symbols)
      };
    }
    this.map.updatedAt = new Date().toISOString();
    atomicWriteJson(this.file, this.map);
    return this.map;
  }

  _fileTokens(file, content, symbols) {
    const symbolText = symbols.map(s => `${s.name} ${s.kind}`).join(' ');
    return tokenize(`${file} ${symbolText} ${content}`).slice(0, 5000);
  }
}

module.exports = { RepositoryMap };
