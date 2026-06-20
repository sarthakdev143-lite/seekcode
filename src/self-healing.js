// src/self-healing.js — Self-healing mechanisms for orchestration layer
'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

class SelfHealingOrchestrator {
  constructor(projectPath) {
    this.projectPath  = path.resolve(projectPath);
    this.checkpointDir = path.join(this.projectPath, '.seekcode', 'checkpoints');
    this.failureLog   = path.join(this.projectPath, '.seekcode', 'failures.json');
    this.maxRetries   = 3;
    this.retryDelay   = 1000;

    // FIXED: was async but method wasn't — use sync mkdir
    this._initCheckpoints();
  }

  // ── Private: sync init ─────────────────────────────────────────────────────
  _initCheckpoints() {
    try {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    } catch (err) {
      logger.warn(`Failed to create checkpoint directory: ${err.message}`);
    }
  }

  // ── Retry wrapper with exponential backoff ─────────────────────────────────
  async executeWithRetry(fn, context = 'unknown', retries = 0) {
    try {
      return await fn();
    } catch (err) {
      if (retries >= this.maxRetries) {
        await this._logFailure(context, err);
        throw new Error(`Failed after ${retries} retries in [${context}]: ${err.message}`);
      }
      const delay = this.retryDelay * Math.pow(2, retries);
      logger.warn(`Retry ${retries + 1}/${this.maxRetries} for [${context}] in ${delay}ms: ${err.message}`);
      await this._sleep(delay);
      return this.executeWithRetry(fn, context, retries + 1);
    }
  }

  // ── Checkpoints ────────────────────────────────────────────────────────────
  async createCheckpoint(stepName, data) {
    try {
      const file = path.join(this.checkpointDir, `${stepName}-${Date.now()}.json`);
      await fs.promises.writeFile(file, JSON.stringify({
        step: stepName,
        timestamp: Date.now(),
        data,
        version: '1.0',
      }, null, 2));
      logger.dim(`Checkpoint created: ${path.basename(file)}`);
      return file;
    } catch (err) {
      logger.warn(`Failed to create checkpoint: ${err.message}`);
      return null;
    }
  }

  async restoreLastCheckpoint(stepName) {
    try {
      // FIXED: fs.existsSync instead of fs.promises.access as boolean
      if (!fs.existsSync(this.checkpointDir)) return null;

      const files = fs.readdirSync(this.checkpointDir)
        .filter(f => f.startsWith(stepName) && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length === 0) return null;

      const latestFile = path.join(this.checkpointDir, files[0]);
      const checkpoint = JSON.parse(await fs.promises.readFile(latestFile, 'utf8'));
      logger.info(`Restored checkpoint: ${path.basename(latestFile)}`);
      return checkpoint.data;
    } catch (err) {
      logger.warn(`Failed to restore checkpoint: ${err.message}`);
      return null;
    }
  }

  // ── Failure logging ────────────────────────────────────────────────────────
  async _logFailure(context, error) {
    try {
      let failures = [];

      // FIXED: fs.promises.access is not a boolean — use existsSync
      if (fs.existsSync(this.failureLog)) {
        failures = JSON.parse(await fs.promises.readFile(this.failureLog, 'utf8'));
      }

      failures.push({
        context,
        error: error.message,
        stack: error.stack,
        timestamp: Date.now(),
        recovered: false,
      });

      if (failures.length > 100) failures = failures.slice(-100);

      await fs.promises.writeFile(
        this.failureLog,
        JSON.stringify(failures, null, 2)
      );
    } catch (err) {
      logger.warn(`Failed to write failure log: ${err.message}`);
    }
  }

  async analyzeFailures() {
    try {
      // FIXED: existsSync instead of access-as-boolean
      if (!fs.existsSync(this.failureLog)) return { total: 0, patterns: [] };

      const failures = JSON.parse(await fs.promises.readFile(this.failureLog, 'utf8'));
      const counts   = {};

      failures.forEach(f => {
        const key = f.error.split(':')[0];
        counts[key] = (counts[key] || 0) + 1;
      });

      const frequent = Object.entries(counts)
        .filter(([, n]) => n > 3)
        .map(([pattern, count]) => ({ pattern, count }));

      return {
        total: failures.length,
        recent: failures.slice(-10),
        patterns: frequent,
        recommendation: frequent.length > 0
          ? `Frequent errors: ${frequent.map(p => p.pattern).join(', ')}`
          : 'No frequent failure patterns detected',
      };
    } catch (err) {
      return { total: 0, patterns: [], error: err.message };
    }
  }

  // ── Rollback ───────────────────────────────────────────────────────────────
  async rollbackOnFailure(originalState) {
    try {
      logger.warn('Rolling back to previous state...');

      if (originalState?.backups) {
        // 1. Copy backed up files back
        for (const [file, backup] of Object.entries(originalState.backups)) {
          if (fs.existsSync(backup)) {
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.copyFile(backup, file);
            logger.dim(`Restored: ${file}`);
          }
        }

        // 2. Identify and delete newly created files
        const originalSet = new Set(Object.keys(originalState.backups).map(f => path.resolve(f)));
        const skip = new Set(['.git', 'node_modules', '.seekcode']);
        
        const walk = async (dir) => {
          if (!fs.existsSync(dir)) return;
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (skip.has(entry.name)) continue;
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(abs);
              try {
                const contents = await fs.promises.readdir(abs);
                if (contents.length === 0) {
                  await fs.promises.rmdir(abs);
                }
              } catch {}
            } else {
              if (!originalSet.has(path.resolve(abs))) {
                try {
                  await fs.promises.unlink(abs);
                  logger.dim(`Deleted new file on rollback: ${abs}`);
                } catch (err) {
                  logger.warn(`Failed to delete new file ${abs}: ${err.message}`);
                }
              }
            }
          }
        };
        await walk(this.projectPath);
      }

      logger.success('Rollback completed (non-destructive)');
      return true;
    } catch (err) {
      logger.error(`Rollback failed: ${err.message}`);
      return false;
    }
  }

  async rollbackStep(originalState, changedFiles) {
    try {
      logger.warn('Rolling back changes for failed step...');
      if (originalState?.backups && changedFiles && changedFiles.length > 0) {
        const changedSet = new Set(changedFiles.map(f => path.resolve(this.projectPath, f)));
        
        // 1. Restore modified files
        for (const [file, backup] of Object.entries(originalState.backups)) {
          if (changedSet.has(path.resolve(file)) && fs.existsSync(backup)) {
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.copyFile(backup, file);
            logger.dim(`Restored: ${file}`);
          }
        }
        
        // 2. Delete newly created files
        for (const file of changedFiles) {
          const abs = path.resolve(this.projectPath, file);
          const wasCreated = !originalState.backups[abs];
          if (wasCreated && fs.existsSync(abs)) {
            try {
              const stat = fs.statSync(abs);
              if (stat.isFile()) {
                await fs.promises.unlink(abs);
                logger.dim(`Deleted new file on rollback: ${abs}`);
              }
            } catch (err) {
              logger.warn(`Failed to delete new file ${abs}: ${err.message}`);
            }
          }
        }
      }
      logger.success('Step-specific rollback completed');
      return true;
    } catch (err) {
      logger.error(`Step rollback failed: ${err.message}`);
      return false;
    }
  }

  // ── Backup helpers ─────────────────────────────────────────────────────────
  async createBackup(files) {
    const backupDir = path.join(this.projectPath, '.seekcode', 'backups', Date.now().toString());
    await fs.promises.mkdir(backupDir, { recursive: true });
    const backups = {};

    for (const file of files) {
      const absPath = path.resolve(this.projectPath, file);
      if (fs.existsSync(absPath)) {
        const relPath = path.relative(this.projectPath, absPath).replace(/\\/g, '/');
        const backupPath = path.join(backupDir, relPath);
        await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.promises.copyFile(absPath, backupPath);
        backups[absPath] = backupPath;
      }
    }

    return { backups, backupDir };
  }
  // ── Auto-checkpoint interval ───────────────────────────────────────────────
  startAutoCheckpoint(stateFn, intervalMs = 60_000) {
    if (this._checkpointTimer) clearInterval(this._checkpointTimer);

    this._checkpointTimer = setInterval(async () => {
      try {
        const state = await stateFn();
        if (state) await this.createCheckpoint('auto_checkpoint', state);
      } catch (err) {
        logger.warn(`Auto-checkpoint failed: ${err.message}`);
      }
    }, intervalMs);

    return this._checkpointTimer;
  }

  stopAutoCheckpoint() {
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = null;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  async cleanupOldCheckpoints(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      if (!fs.existsSync(this.checkpointDir)) return;

      const now   = Date.now();
      let deleted = 0;

      for (const file of fs.readdirSync(this.checkpointDir)) {
        const filePath = path.join(this.checkpointDir, file);
        const { mtimeMs } = fs.statSync(filePath);
        if (now - mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
          deleted++;
        }
      }

      if (deleted > 0) logger.dim(`Cleaned up ${deleted} old checkpoints`);
    } catch (err) {
      logger.warn(`Checkpoint cleanup failed: ${err.message}`);
    }
  }

  // ── Context pruner (prevent LLM overload) ─────────────────────────────────
  pruneContext(context, maxChars = 8000) {
    const raw = JSON.stringify(context);
    if (raw.length <= maxChars) return context;

    logger.warn(`Context too large (${raw.length} chars) — pruning`);
    const pruned = { ...context };

    if (pruned.dependencyGraph && JSON.stringify(pruned.dependencyGraph).length > maxChars / 2) {
      delete pruned.dependencyGraph;
      pruned._note = 'Dependency graph pruned due to size';
    }

    if (Array.isArray(pruned.recentTasks) && pruned.recentTasks.length > 5) {
      pruned.recentTasks = pruned.recentTasks.slice(-3);
    }

    if (pruned.files) {
      pruned.files = pruned.files.map(f => ({ ...f, content: '[truncated]' }));
    }

    return pruned;
  }

  // ── Util ───────────────────────────────────────────────────────────────────
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SelfHealingOrchestrator };