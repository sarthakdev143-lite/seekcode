const fs = require('fs');
const path = require('path');
const config = require('../config');
const { atomicWriteJson } = require('../utils/atomicWrite');

class SessionMemory {
  constructor() {
    this.cacheDir = config.CACHE_DIR;
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
    this.memoryFile = path.join(this.cacheDir, 'session.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.memoryFile)) return JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
    } catch {}
    return { tasks: [], projectMap: null, lastRun: null };
  }

  save() {
    atomicWriteJson(this.memoryFile, this.data);
  }

  rememberTask(task, result) {
    this.data.tasks.push({ task, result, time: new Date().toISOString() });
    if (this.data.tasks.length > 50) this.data.tasks = this.data.tasks.slice(-50);
    this.save();
  }

  storeProjectMap(map) {
    this.data.projectMap = map;
    this.data.lastRun = new Date().toISOString();
    this.save();
  }

  getProjectMap() { return this.data.projectMap; }
  getRecentTasks(limit = 5) { return this.data.tasks.slice(-limit); }
}

module.exports = { SessionMemory };
