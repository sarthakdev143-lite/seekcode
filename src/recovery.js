// recovery.js — State persistence and recovery system
'use strict';

const fs = require('fs');
const path = require('path');

class StateRecovery {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.stateDir = path.join(this.projectPath, '.seekcode', 'state');
    this.checkpointInterval = null;
    this.init();
  }
  
  init() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }
  
  async saveState(key, data, metadata = {}) {
    const stateFile = path.join(this.stateDir, `${key}.json`);
    const state = {
      key,
      data,
      metadata: {
        ...metadata,
        savedAt: Date.now(),
        version: '1.0'
      }
    };
    
    // Write with backup
    const backup = path.join(this.stateDir, `${key}.backup.json`);
    if (fs.existsSync(stateFile)) {
      fs.copyFileSync(stateFile, backup);
    }
    
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    
    if (fs.existsSync(backup)) {
      fs.unlinkSync(backup);
    }
    
    return stateFile;
  }
  
  async loadState(key) {
    const stateFile = path.join(this.stateDir, `${key}.json`);
    const backupFile = path.join(this.stateDir, `${key}.backup.json`);
    
    try {
      if (fs.existsSync(stateFile)) {
        const content = fs.readFileSync(stateFile, 'utf8');
        return JSON.parse(content);
      } else if (fs.existsSync(backupFile)) {
        console.warn(`Loading from backup for ${key}`);
        const content = fs.readFileSync(backupFile, 'utf8');
        return JSON.parse(content);
      }
    } catch (err) {
      console.error(`Failed to load state ${key}: ${err.message}`);
    }
    
    return null;
  }
  
  startAutoCheckpoint(fn, intervalMs = 60000) {
    if (this.checkpointInterval) clearInterval(this.checkpointInterval);
    
    this.checkpointInterval = setInterval(async () => {
      try {
        const state = await fn();
        if (state) {
          await this.saveState('auto_checkpoint', state, { auto: true });
        }
      } catch (err) {
        console.error(`Auto-checkpoint failed: ${err.message}`);
      }
    }, intervalMs);
    
    return this.checkpointInterval;
  }
  
  stopAutoCheckpoint() {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }
  }
  
  async listStates() {
    const files = fs.readdirSync(this.stateDir);
    return files.filter(f => f.endsWith('.json') && !f.includes('.backup'));
  }
  
  async purgeOldStates(maxAge = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let deleted = 0;
    
    for (const file of await this.listStates()) {
      const filePath = path.join(this.stateDir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }
    
    return deleted;
  }
}

module.exports = { StateRecovery };
