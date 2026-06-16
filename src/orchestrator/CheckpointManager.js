'use strict';

const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');

class CheckpointManager {
  constructor(projectDir, taskId) {
    this.projectDir = projectDir;
    this.taskId = taskId;
    this.dir = path.join(projectDir, '.seekcode', 'checkpoints');
  }

  create(reason, payload = {}) {
    const safeReason = reason.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const checkpointId = `${Date.now()}-${this.taskId}-${safeReason}`;
    const file = path.join(this.dir, `${checkpointId}.json`);
    
    // Create checkpoint metadata
    const checkpoint = {
      id: checkpointId,
      taskId: this.taskId,
      reason,
      createdAt: new Date().toISOString(),
      filesChanged: [],
      completedTasks: [],
      validationStatus: {},
      ...payload
    };
    
    atomicWriteJson(file, checkpoint);
    
    // Also capture a snapshot of the workspace files
    try {
      this._saveSnapshot(checkpointId);
    } catch (err) {
      console.warn(`Failed to capture workspace snapshot for checkpoint ${checkpointId}: ${err.message}`);
    }
    
    return checkpoint;
  }

  restore(checkpointId) {
    const fs = require('fs');
    const backupDir = path.join(this.dir, checkpointId);
    if (!fs.existsSync(backupDir)) {
      throw new Error(`Checkpoint backup directory not found: ${checkpointId}`);
    }

    const skip = new Set(['.git', 'node_modules', '.seekcode']);
    
    // 1. Walk workspace and delete files that are not in the checkpoint snapshot
    const walkWorkspace = dir => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkWorkspace(abs);
          try {
            if (fs.readdirSync(abs).length === 0) {
              fs.rmdirSync(abs);
            }
          } catch {}
        } else {
          const rel = path.relative(this.projectDir, abs).replace(/\\/g, '/');
          const backupFile = path.join(backupDir, rel);
          if (!fs.existsSync(backupFile)) {
            try {
              fs.unlinkSync(abs);
            } catch (err) {
              console.warn(`Failed to delete file ${abs} during checkpoint restore: ${err.message}`);
            }
          }
        }
      }
    };
    walkWorkspace(this.projectDir);

    // 2. Restore all files from the checkpoint snapshot
    const walkBackup = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkBackup(abs);
        } else {
          const rel = path.relative(backupDir, abs).replace(/\\/g, '/');
          const dest = path.join(this.projectDir, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(abs, dest);
        }
      }
    };
    walkBackup(backupDir);
  }

  _saveSnapshot(checkpointId) {
    const fs = require('fs');
    const backupDir = path.join(this.dir, checkpointId);
    fs.mkdirSync(backupDir, { recursive: true });

    const skip = new Set(['.git', 'node_modules', '.seekcode']);
    const walk = dir => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
        } else {
          const rel = path.relative(this.projectDir, abs).replace(/\\/g, '/');
          const dest = path.join(backupDir, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(abs, dest);
        }
      }
    };
    walk(this.projectDir);
  }

  /** List checkpoint metadata, newest first. */
  listCheckpoints(taskId = this.taskId) {
    const fs = require('fs');
    if (!fs.existsSync(this.dir)) return [];

    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
          const backupDir = path.join(this.dir, meta.id);
          return fs.existsSync(backupDir) ? meta : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(cp => !taskId || cp.taskId === taskId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  findLatest(taskId = this.taskId) {
    return this.listCheckpoints(taskId)[0] || null;
  }

  restoreLatest(taskId = this.taskId) {
    const latest = this.findLatest(taskId);
    if (!latest) return null;
    this.restore(latest.id);
    return latest;
  }
}

module.exports = { CheckpointManager };
