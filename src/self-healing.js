// src/self-healing.js — Self-healing mechanisms for orchestration layer
'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class SelfHealingOrchestrator {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.checkpointDir = path.join(this.projectPath, '.seekcode', 'checkpoints');
    this.failureLog = path.join(this.projectPath, '.seekcode', 'failures.json');
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.initCheckpoints();
  }

  initCheckpoints() {
    try {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    } catch (err) {
      logger.warn(`Failed to create checkpoint directory: ${err.message}`);
    }
  }

  async executeWithRetry(fn, context = 'unknown', retries = 0) {
    try {
      return await fn();
    } catch (err) {
      if (retries >= this.maxRetries) {
        await this.logFailure(context, err);
        throw new Error(`Failed after ${retries} retries: ${err.message}`);
      }
      
      logger.warn(`Retry ${retries + 1}/${this.maxRetries} for ${context}: ${err.message}`);
      await this.sleep(this.retryDelay * Math.pow(2, retries)); // Exponential backoff
      return this.executeWithRetry(fn, context, retries + 1);
    }
  }

  async createCheckpoint(stepName, data) {
    try {
      const checkpointFile = path.join(this.checkpointDir, `${stepName}-${Date.now()}.json`);
      const checkpoint = {
        step: stepName,
        timestamp: Date.now(),
        data: data,
        version: '1.0'
      };
      fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
      logger.dim(`Checkpoint created: ${path.basename(checkpointFile)}`);
      return checkpointFile;
    } catch (err) {
      logger.warn(`Failed to create checkpoint: ${err.message}`);
      return null;
    }
  }

  async restoreLastCheckpoint(stepName) {
    try {
      const files = fs.readdirSync(this.checkpointDir)
        .filter(f => f.startsWith(stepName) && f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (files.length === 0) return null;
      
      const latestFile = path.join(this.checkpointDir, files[0]);
      const checkpoint = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      logger.info(`Restored checkpoint: ${path.basename(latestFile)}`);
      return checkpoint.data;
    } catch (err) {
      logger.warn(`Failed to restore checkpoint: ${err.message}`);
      return null;
    }
  }

  async logFailure(context, error) {
    try {
      let failures = [];
      if (fs.existsSync(this.failureLog)) {
        failures = JSON.parse(fs.readFileSync(this.failureLog, 'utf8'));
      }
      
      failures.push({
        context: context,
        error: error.message,
        stack: error.stack,
        timestamp: Date.now(),
        recovered: false
      });
      
      // Keep last 100 failures
      if (failures.length > 100) failures = failures.slice(-100);
      
      fs.writeFileSync(this.failureLog, JSON.stringify(failures, null, 2));
    } catch (err) {
      logger.warn(`Failed to log failure: ${err.message}`);
    }
  }

  async analyzeFailures() {
    try {
      if (!fs.existsSync(this.failureLog)) return { total: 0, patterns: [] };
      
      const failures = JSON.parse(fs.readFileSync(this.failureLog, 'utf8'));
      const patterns = {};
      
      failures.forEach(f => {
        const errorType = f.error.split(':')[0];
        patterns[errorType] = (patterns[errorType] || 0) + 1;
      });
      
      const frequentPatterns = Object.entries(patterns)
        .filter(([_, count]) => count > 3)
        .map(([pattern, count]) => ({ pattern, count }));
      
      return {
        total: failures.length,
        recent: failures.slice(-10),
        patterns: frequentPatterns,
        recommendation: frequentPatterns.length > 0 
          ? `Consider addressing: ${frequentPatterns.map(p => p.pattern).join(', ')}`
          : 'No frequent failure patterns detected'
      };
    } catch (err) {
      return { total: 0, patterns: [], error: err.message };
    }
  }

  async rollbackOnFailure(originalState) {
    try {
      logger.warn('Rolling back to previous state...');
      
      // Restore backed up files
      if (originalState && originalState.backups) {
        for (const [file, backup] of Object.entries(originalState.backups)) {
          if (fs.existsSync(backup)) {
            fs.copyFileSync(backup, file);
            logger.dim(`Restored: ${file}`);
          }
        }
      }
      
      // Git rollback if available
      const { GitManager } = require('./git');
      const git = new GitManager(this.projectPath);
      if (git.isRepo()) {
        await git.rollbackLastCommit();
        logger.success('Git rollback completed');
      }
      
      return true;
    } catch (err) {
      logger.error(`Rollback failed: ${err.message}`);
      return false;
    }
  }

  async createBackup(files) {
    const backups = {};
    const backupDir = path.join(this.projectPath, '.seekcode', 'backups', Date.now().toString());
    fs.mkdirSync(backupDir, { recursive: true });
    
    for (const file of files) {
      const absPath = path.resolve(this.projectPath, file);
      if (fs.existsSync(absPath)) {
        const backupPath = path.join(backupDir, path.basename(file));
        fs.copyFileSync(absPath, backupPath);
        backups[absPath] = backupPath;
      }
    }
    
    return { backups, backupDir };
  }

  async cleanupOldCheckpoints(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    try {
      const now = Date.now();
      const files = fs.readdirSync(this.checkpointDir);
      let deleted = 0;
      
      for (const file of files) {
        const filePath = path.join(this.checkpointDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
      
      if (deleted > 0) {
        logger.dim(`Cleaned up ${deleted} old checkpoints`);
      }
    } catch (err) {
      logger.warn(`Checkpoint cleanup failed: ${err.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Intelligent context pruning to prevent overload
  pruneContext(context, maxTokens = 8000) {
    const contextStr = JSON.stringify(context);
    if (contextStr.length <= maxTokens) return context;
    
    logger.warn(`Context too large (${contextStr.length} chars) - pruning`);
    
    const pruned = { ...context };
    
    // Remove dependency graph if too large
    if (pruned.dependencyGraph && JSON.stringify(pruned.dependencyGraph).length > maxTokens / 2) {
      delete pruned.dependencyGraph;
      pruned._note = 'Dependency graph pruned due to size';
    }
    
    // Truncate recent tasks
    if (pruned.recentTasks && pruned.recentTasks.length > 5) {
      pruned.recentTasks = pruned.recentTasks.slice(-3);
    }
    
    // Remove file contents if present
    if (pruned.files) {
      pruned.files = pruned.files.map(f => ({ ...f, content: '[truncated]' }));
    }
    
    return pruned;
  }
}

module.exports = { SelfHealingOrchestrator };
