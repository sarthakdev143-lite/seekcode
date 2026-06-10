const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../logger');

class ValidationEngine {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.buildCommand = this._detectBuildCommand();
    this.testCommand = this._detectTestCommand();
  }

  _detectBuildCommand() {
    const pkgPath = path.join(this.projectDir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts) {
          if (pkg.scripts.build) return 'npm run build';
          if (pkg.scripts.compile) return 'npm run compile';
        }
      }
    } catch {}
    
    // Check for tsconfig.json as a hint for tsc
    if (fs.existsSync(path.join(this.projectDir, 'tsconfig.json'))) {
      return 'npx tsc';
    }

    return null;
  }

  _detectTestCommand() {
    const pkgPath = path.join(this.projectDir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts) {
          if (pkg.scripts.test) return 'npm test';
          if (pkg.scripts['test:unit']) return 'npm run test:unit';
        }
      }
    } catch {}
    
    // Fallback to jest if available in node_modules
    if (fs.existsSync(path.join(this.projectDir, 'node_modules', '.bin', 'jest'))) {
      return 'npx jest --passWithNoTests';
    }

    return null;
  }

  async runBuild() {
    if (!this.buildCommand) {
      return { success: true, message: 'No build command detected' };
    }

    logger.info('Validating build: ' + this.buildCommand);
    try {
      const output = execSync(this.buildCommand, {
        cwd: this.projectDir,
        encoding: 'utf8',
        timeout: 300_000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, output: output.trim() };
    } catch (err) {
      const stdout = (err.stdout || '').trim();
      const stderr = (err.stderr || '').trim();
      return { 
        success: false, 
        output: stdout + '\n' + stderr, 
        exitCode: err.status,
        error: this._parseError(stdout + '\n' + stderr)
      };
    }
  }

  async runTests() {
    if (!this.testCommand) {
      return { success: true, message: 'No test command detected' };
    }

    logger.info('Validating tests: ' + this.testCommand);
    try {
      const output = execSync(this.testCommand, {
        cwd: this.projectDir,
        encoding: 'utf8',
        timeout: 300_000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, output: output.trim() };
    } catch (err) {
      const stdout = (err.stdout || '').trim();
      const stderr = (err.stderr || '').trim();
      return { 
        success: false, 
        output: stdout + '\n' + stderr, 
        exitCode: err.status,
        error: this._parseError(stdout + '\n' + stderr)
      };
    }
  }

  _parseError(output) {
    // Basic error parsing logic
    // Look for common patterns like "Cannot find module", "SyntaxError", etc.
    const lines = output.split('\n');
    const relevantLines = lines.filter(line => 
      line.includes('Error:') || 
      line.includes('ERR!') || 
      line.includes('TS') && line.includes(': error')
    );
    
    if (relevantLines.length > 0) {
      return relevantLines.slice(0, 3).join('\n');
    }
    
    return output.substring(0, 500);
  }

  async validate() {
    const buildResult = await this.runBuild();
    if (!buildResult.success) {
      return { 
        success: false, 
        phase: 'build', 
        output: buildResult.output,
        error: buildResult.error 
      };
    }

    const testResult = await this.runTests();
    if (!testResult.success) {
      return { 
        success: false, 
        phase: 'test', 
        output: testResult.output,
        error: testResult.error
      };
    }

    return { success: true };
  }
}

module.exports = { ValidationEngine };
