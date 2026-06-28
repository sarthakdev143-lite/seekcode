const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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

  /**
   * Ensure a path is ignored by git. Appends it to .gitignore (creating the
   * file if missing) only if it isn't already ignored or already present.
   *
   * Idempotent and never throws — safe to call on every project init. We check
   * `git check-ignore` first so we don't duplicate entries already covered by a
   * glob or a parent ignore rule, and we resolve the .gitignore at the repo
   * root (where ignore rules actually live), not the working subdir.
   *
   * @param {string} relPath — repo-relative path to ignore (e.g. '.seekcode')
   * @returns {boolean} true if the path is now ignored (already was, or we just added it)
   */
  ensureIgnored(relPath) {
    if (!relPath || !this.isRepo()) return false;

    // Already ignored (by a glob, a parent rule, or a prior run)? Done.
    if (this._isIgnored(relPath)) return true;

    try {
      const gitignorePath = this._gitignorePath();
      const existing = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, 'utf8')
        : '';

      // Avoid duplicate lines if a literal entry already exists.
      const alreadyListed = existing
        .split(/\r?\n/)
        .map(l => l.trim())
        .includes(relPath);
      if (alreadyListed) return true;

      const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      const trailer = existing.endsWith('\n') ? '\n' : '\n';
      fs.writeFileSync(
        gitignorePath,
        existing + `${prefix}# SeekCode agent state (sessions, checkpoints, memory)\n${relPath}${trailer}`,
        'utf8'
      );
      logger.info(`Added "${relPath}" to .gitignore`);
      return true;
    } catch (err) {
      logger.warn(`Could not update .gitignore for "${relPath}": ${err.message}`);
      return false;
    }
  }

  /** True if git currently ignores the given repo-relative path. */
  _isIgnored(relPath) {
    try {
      const out = execSync(`git check-ignore "${relPath}"`, {
        cwd: this.projectDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return out.length > 0;
    } catch {
      // Non-zero exit means git does NOT ignore it (or git errored). Treat as
      // "not ignored" so we attempt the append; ensureIgnored is idempotent.
      return false;
    }
  }

  /** Absolute path to the repo-root .gitignore. */
  _gitignorePath() {
    const root = this._repoRoot();
    return path.join(root, '.gitignore');
  }

  _repoRoot() {
    try {
      return execSync('git rev-parse --show-toplevel', {
        cwd: this.projectDir, encoding: 'utf8',
      }).trim();
    } catch {
      return this.projectDir; // fall back to the configured project dir
    }
  }
}

module.exports = { GitManager };
