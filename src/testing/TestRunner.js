const { execSync } = require('child_process');
const path = require('path');
const logger = require('../logger');

class TestRunner {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.command = this._detectTestCommand();
  }

  _detectTestCommand() {
    const pkgPath = path.join(this.projectDir, 'package.json');
    try {
      const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.test) return 'npm test';
      if (pkg.scripts && pkg.scripts['test:unit']) return 'npm run test:unit';
    } catch {}
    return 'npx jest --passWithNoTests 2>NUL';
  }

  async run() {
    logger.info('Running tests: ' + this.command);
    try {
      const output = execSync(this.command, {
        cwd: this.projectDir,
        encoding: 'utf8',
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true, output: output.trim() };
    } catch (err) {
      const stdout = (err.stdout || '').trim();
      const stderr = (err.stderr || '').trim();
      return { success: false, output: stdout + '\n' + stderr, exitCode: err.status };
    }
  }
}

module.exports = { TestRunner };
