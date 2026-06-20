const path = require('path');
const { findSourceFiles } = require('./fileWalker');
const { parseFile } = require('./parser');
const { DependencyGraph } = require('./dependencyGraph');
const { detectProjectMeta } = require('./projectMeta');
const config = require('../config');
const logger = require('../logger');

class ProjectAnalyzer {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.graph = new DependencyGraph();
    this.fileDetails = new Map();
    this.meta = {};
    this.parsed = false;
  }

  async analyze() {
    this.graph = new DependencyGraph();
    this.fileDetails = new Map();
    logger.info('Finding source files...');
    const files = await findSourceFiles(this.rootDir);
    logger.success('Found ' + files.length + ' source files');
    
    logger.info('Parsing files and building dependency graph...');
    let count = 0;
    for (const file of files) {
      try {
        const rel = path.relative(this.rootDir, file);
        const result = parseFile(file);
        this.fileDetails.set(rel, result);
        this.graph.addFile(rel);
        for (const imp of result.imports) {
          const resolved = this._resolveImport(imp.module, file);
          if (resolved) this.graph.addImport(rel, resolved);
        }
        count++;
      } catch (err) { logger.warn('Skipping ' + file + ': ' + err.message); }
    }
    this.meta = detectProjectMeta(this.rootDir);
    this.parsed = true;
    logger.success('Parsed ' + count + ' files and built dependency graph');
  }

  getDependencyGraph() { return this.graph; }
  
  getSummary() {
    return {
      project: path.basename(this.rootDir),
      path: this.rootDir,
      meta: this.meta,
      totalFiles: this.fileDetails.size,
      dependencies: this.graph.getAllFiles().length
    };
  }

  _resolveImport(importPath, fromFile) {
    if (importPath.startsWith('.')) {
      const fromDir = path.dirname(fromFile);
      const resolved = path.normalize(path.join(fromDir, importPath));
      for (const ext of config.SUPPORTED_EXTENSIONS) {
        const candidate = path.relative(this.rootDir, resolved + ext);
        if (this.fileDetails.has(candidate)) return candidate;
      }
      const idxCandidate = path.relative(this.rootDir, path.join(resolved, 'index'));
      for (const ext of config.SUPPORTED_EXTENSIONS) {
        const c = idxCandidate + ext;
        if (this.fileDetails.has(c)) return c;
      }
    }
    return null;
  }
}

module.exports = { ProjectAnalyzer };
