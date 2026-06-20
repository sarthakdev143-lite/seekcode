const { execSync } = require('child_process');
const logger = require('../logger');

class GitManager {
  constructor(projectDir) {
    this.projectDir = projectDir;
  }

  // Run a git command, returning trimmed stdout. Never throws.
  _run(cmd) {
    try {
      return execSync(cmd, { cwd: this.projectDir, encoding: 'utf8' }).trim();
    } catch (err) {
      // Return stderr/stdout if available, otherwise empty string
      const msg = (err.stderr || err.stdout || '').trim();
      if (msg) logger.dim('git: ' + msg);
      return msg;
    }
  }

  getDiff() {
    return this._run('git diff --staged') || this._run('git diff');
  }

  getBranch() {
    return this._run('git branch --show-current') || 'unknown';
  }

  stageAll() {
    this._run('git add -A');
    logger.info('Staged all changes');
  }

  commit(message) {
    // Check if there is anything to commit
    const status = this._run('git status --porcelain');
    if (!status) {
      logger.info('Nothing to commit (working tree clean)');
      return;
    }
    this._run('git commit -m "' + message.replace(/"/g, '\\"') + '"');
    logger.success('Committed: ' + message);
  }

  isRepo() {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: this.projectDir, encoding: 'utf8' });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { GitManager };
