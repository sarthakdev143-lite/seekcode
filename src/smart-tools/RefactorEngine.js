const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const { parseFile } = require('../analyzer/parser');

class RefactorEngine {
  constructor(analyzer) {
    this.analyzer = analyzer;
    this.graph = analyzer.getDependencyGraph();
  }

  // Safe rename (existing)
  async renameSymbol(oldName, newName, filePath) {
    const steps = [];
    const absFile = path.resolve(this.analyzer.rootDir, filePath);
    if (!fs.existsSync(absFile)) throw new Error('File not found: ' + filePath);
    const details = this.analyzer.fileDetails.get(filePath);
    if (!details) throw new Error('No analysis for ' + filePath);
    const sym = details.declarations.find(d => d.name === oldName);
    if (!sym) throw new Error('Symbol ' + oldName + ' not found in ' + filePath);
    const dependents = this.graph.getDependents(filePath);
    const affectedFiles = [filePath, ...dependents];
    for (const f of affectedFiles) {
      const abs = path.resolve(this.analyzer.rootDir, f);
      let content = fs.readFileSync(abs, 'utf8');
      const before = content;
      const regex = new RegExp('\\b' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      content = content.replace(regex, newName);
      if (content !== before) {
        fs.writeFileSync(abs, content, 'utf8');
        steps.push('Renamed in ' + f);
      }
    }
    logger.success('Renamed ' + oldName + ' -> ' + newName);
    return steps;
  }

  // Find usages (existing)
  findUsages(symbolName, filePath = null) {
    const usages = [];
    const files = filePath ? [filePath] : this.graph.getAllFiles();
    for (const f of files) {
      const abs = path.resolve(this.analyzer.rootDir, f);
      if (!fs.existsSync(abs)) continue;
      const content = fs.readFileSync(abs, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes(symbolName)) {
          usages.push({ file: f, line: idx + 1, content: line.trim() });
        }
      });
    }
    return usages;
  }

  // Extract a block of code into a separate function
  async extractFunction(filePath, startLine, endLine, newFunctionName, targetFilePath = null) {
    const absFile = path.resolve(this.analyzer.rootDir, filePath);
    const content = fs.readFileSync(absFile, 'utf8');
    const lines = content.split('\n');
    const codeBlock = lines.slice(startLine - 1, endLine).join('\n');
    const newFunc = 'function ' + newFunctionName + '() {\n' + codeBlock + '\n}\n';
    // Replace the original block with a call
    const call = newFunctionName + '();';
    const beforeLines = lines.slice(0, startLine - 1);
    const afterLines = lines.slice(endLine);
    const newContent = [...beforeLines, call, ...afterLines].join('\n');
    fs.writeFileSync(absFile, newContent, 'utf8');
    if (targetFilePath) {
      const targetAbs = path.resolve(this.analyzer.rootDir, targetFilePath);
      fs.appendFileSync(targetAbs, '\n' + newFunc, 'utf8');
      // Add import if needed (simplistic)
    } else {
      fs.appendFileSync(absFile, '\n' + newFunc, 'utf8');
    }
    logger.success('Extracted ' + newFunctionName);
    return ['Extracted function ' + newFunctionName];
  }

  // Move a symbol (function/class) to a new file
  async moveSymbolToFile(symbolName, sourceFile, targetFile) {
    const absSource = path.resolve(this.analyzer.rootDir, sourceFile);
    const absTarget = path.resolve(this.analyzer.rootDir, targetFile);
    let sourceContent = fs.readFileSync(absSource, 'utf8');
    const symbolDef = this._findDefinition(sourceContent, symbolName);
    if (!symbolDef) throw new Error('Symbol definition not found in ' + sourceFile);
    // Remove from source
    sourceContent = sourceContent.replace(symbolDef, '');
    fs.writeFileSync(absSource, sourceContent, 'utf8');
    // Add to target
    let targetContent = '';
    if (fs.existsSync(absTarget)) targetContent = fs.readFileSync(absTarget, 'utf8');
    targetContent += '\n' + symbolDef;
    fs.writeFileSync(absTarget, targetContent, 'utf8');
    // Update imports in all files that imported from source
    const sourceRel = path.relative(this.analyzer.rootDir, absSource).replace(/\\/g, '/');
    const targetRel = path.relative(this.analyzer.rootDir, absTarget).replace(/\\/g, '/');
    const dependents = this.graph.getDependents(sourceFile);
    for (const dep of dependents) {
      const absDep = path.resolve(this.analyzer.rootDir, dep);
      let depContent = fs.readFileSync(absDep, 'utf8');
      depContent = depContent.replace(new RegExp('require\\([\'"]' + sourceRel + '[\'"]\\)', 'g'), 'require(\'' + targetRel + '\')');
      fs.writeFileSync(absDep, depContent, 'utf8');
    }
    logger.success('Moved ' + symbolName + ' from ' + sourceFile + ' to ' + targetFile);
    return ['Moved symbol and updated imports'];
  }

  // Add a parameter to a function
  async addParameter(functionName, filePath, newParam, defaultValue = null) {
    const absFile = path.resolve(this.analyzer.rootDir, filePath);
    let content = fs.readFileSync(absFile, 'utf8');
    // Find function definition line
    const lines = content.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(new RegExp('function\\s+' + functionName + '\\s*\\((.*?)\\)'))) {
        const oldParams = RegExp.$1.trim();
        const newParams = oldParams ? oldParams + ', ' + newParam : newParam;
        if (defaultValue) newParams += ' = ' + JSON.stringify(defaultValue);
        lines[i] = lines[i].replace(/\s*\((.*?)\)\s*/, function(m, p) { return '(' + newParams + ')'; });
        found = true;
        break;
      }
    }
    if (!found) throw new Error('Function ' + functionName + ' not found');
    fs.writeFileSync(absFile, lines.join('\n'), 'utf8');
    logger.success('Added parameter ' + newParam + ' to ' + functionName);
    return ['Parameter added'];
  }

  _findDefinition(content, symbolName) {
    const regex = new RegExp('(function\\s+' + symbolName + '\\s*\\([^)]*\\)\\s*\\{[^}]*\\})|(class\\s+' + symbolName + '\\s*\\{[^}]*\\})', 's');
    const match = content.match(regex);
    return match ? match[0] : null;
  }
}

module.exports = { RefactorEngine };
