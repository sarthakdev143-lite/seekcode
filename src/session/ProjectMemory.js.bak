'use strict';
// src/session/ProjectMemory.js
// Project-scoped persistent memory that survives process restarts.
// This is the core fix for the "goldfish memory" problem where each seekcode
// invocation starts completely blind with no knowledge of prior attempts.

const fs   = require('fs');
const path = require('path');

const MEMORY_VERSION = 3;

class ProjectMemory {
  /**
   * @param {string} projectPath  Absolute path to the project root
   */
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.memoryDir   = path.join(this.projectPath, '.seekcode');
    this.memoryFile  = path.join(this.memoryDir, 'project-memory.json');
    this._ensureDir();
    this.data = this._load();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _ensureDir() {
    try { fs.mkdirSync(this.memoryDir, { recursive: true }); } catch {}
  }

  _load() {
    try {
      if (fs.existsSync(this.memoryFile)) {
        const raw = JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
        if (raw.version === MEMORY_VERSION) return raw;
        if (raw.version === 2) return this._migrateV2(raw);
      }
    } catch {}
    return this._fresh();
  }

  _fresh() {
    return {
      version: MEMORY_VERSION,
      projectPath: this.projectPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // What is currently known to be broken
      knownBroken: [],     // [{ issue, since, attempts }]

      // What is confirmed working
      knownWorking: [],    // [{ feature, confirmedAt }]

      // Files that were changed across all sessions
      changedFiles: {},    // { filePath: { lastChangedAt, changeCount } }

      // Errors encountered and how many times
      errorHistory: {},    // { fingerprint: { error, count, lastSeen, resolved } }

      // Sessions run on this project
      sessions: [],        // [{ id, startedAt, endedAt, task, outcome }]

      // Last validation state
      lastValidation: null, // { at, success, phase, error }

      // Last known working port (for runtime validation)
      lastKnownPort: null,

      // Environment notes (e.g. "missing .env file", "fabric not installed")
      envNotes: [],

      activeTaskState: null,
      projectFacts: [],
      pastFailures: [],
      userPreferences: [],
      runSummaries: [],
    };
  }

  _migrateV2(raw) {
    return {
      ...this._fresh(),
      ...raw,
      version: MEMORY_VERSION,
      activeTaskState: null,
      projectFacts: raw.knownWorking || [],
      pastFailures: Object.values(raw.errorHistory || {}),
      userPreferences: [],
      runSummaries: raw.sessions || [],
    };
  }

  _save() {
    try {
      this.data.updatedAt = new Date().toISOString();
      const tmp = this.memoryFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.memoryFile);
    } catch (err) {
      // non-fatal
    }
  }

  // ─── Session tracking ──────────────────────────────────────────────────────

  startSession(sessionId, task) {
    const entry = { id: sessionId, startedAt: new Date().toISOString(), endedAt: null, task, outcome: 'in-progress' };
    this.data.sessions.push(entry);
    this.data.activeTaskState = { sessionId, task, startedAt: entry.startedAt };
    if (this.data.sessions.length > 100) this.data.sessions = this.data.sessions.slice(-100);
    this._save();
    return entry;
  }

  endSession(sessionId, outcome) {
    const session = this.data.sessions.find(s => s.id === sessionId);
    if (session) {
      session.endedAt = new Date().toISOString();
      session.outcome = outcome; // 'success' | 'failed' | 'partial'
    }
    if (this.data.activeTaskState?.sessionId === sessionId) this.data.activeTaskState = null;
    this.data.runSummaries.push({ sessionId, outcome, endedAt: new Date().toISOString() });
    this.data.runSummaries = this.data.runSummaries.slice(-100);
    this._save();
  }

  // ─── Known broken / working ────────────────────────────────────────────────

  markBroken(issue, { attempts = 1 } = {}) {
    const existing = this.data.knownBroken.find(b => b.issue === issue);
    if (existing) {
      existing.attempts += attempts;
      existing.lastSeen = new Date().toISOString();
    } else {
      this.data.knownBroken.push({ issue, since: new Date().toISOString(), lastSeen: new Date().toISOString(), attempts });
    }
    this._save();
  }

  markFixed(issue) {
    this.data.knownBroken = this.data.knownBroken.filter(b => b.issue !== issue);
    this._save();
  }

  markWorking(feature) {
    if (!this.data.knownWorking.find(w => w.feature === feature)) {
      this.data.knownWorking.push({ feature, confirmedAt: new Date().toISOString() });
      if (this.data.knownWorking.length > 50) this.data.knownWorking = this.data.knownWorking.slice(-50);
    }
    this._save();
  }

  // ─── File change tracking ──────────────────────────────────────────────────

  recordFileChanges(filePaths) {
    const now = new Date().toISOString();
    for (const fp of filePaths) {
      const rel = path.relative(this.projectPath, fp).replace(/\\/g, '/');
      if (!this.data.changedFiles[rel]) {
        this.data.changedFiles[rel] = { lastChangedAt: now, changeCount: 0 };
      }
      this.data.changedFiles[rel].lastChangedAt = now;
      this.data.changedFiles[rel].changeCount++;
    }
    this._save();
  }

  getMostChangedFiles(limit = 10) {
    return Object.entries(this.data.changedFiles)
      .sort(([, a], [, b]) => b.changeCount - a.changeCount)
      .slice(0, limit)
      .map(([file, info]) => ({ file, ...info }));
  }

  // ─── Error history ─────────────────────────────────────────────────────────

  recordError(fingerprint, errorText) {
    if (!this.data.errorHistory[fingerprint]) {
      this.data.errorHistory[fingerprint] = { error: errorText.slice(0, 500), count: 0, firstSeen: new Date().toISOString(), lastSeen: null, resolved: false };
    }
    this.data.errorHistory[fingerprint].count++;
    this.data.errorHistory[fingerprint].lastSeen = new Date().toISOString();
    this.data.pastFailures.push({ fingerprint, error: errorText.slice(0, 500), at: new Date().toISOString() });
    this.data.pastFailures = this.data.pastFailures.slice(-100);
    this._save();
  }

  resolveError(fingerprint) {
    if (this.data.errorHistory[fingerprint]) {
      this.data.errorHistory[fingerprint].resolved = true;
      this._save();
    }
  }

  getUnresolvedErrors() {
    return Object.values(this.data.errorHistory).filter(e => !e.resolved);
  }

  // ─── Validation state ──────────────────────────────────────────────────────

  recordValidation(success, phase, error) {
    this.data.lastValidation = { at: new Date().toISOString(), success, phase, error: error?.slice(0, 500) || null };
    this._save();
  }

  // ─── Environment notes ─────────────────────────────────────────────────────

  addEnvNote(note) {
    if (!this.data.envNotes.includes(note)) {
      this.data.envNotes.push(note);
      if (this.data.envNotes.length > 20) this.data.envNotes = this.data.envNotes.slice(-20);
      this._save();
    }
  }

  setKnownPort(port) {
    this.data.lastKnownPort = port;
    this._save();
  }

  // ─── Read accessors ────────────────────────────────────────────────────────

  getKnownBroken()    { return this.data.knownBroken; }
  getKnownWorking()   { return this.data.knownWorking; }
  getLastValidation() { return this.data.lastValidation; }
  getRecentSessions(limit = 5) { return this.data.sessions.slice(-limit); }
  getEnvNotes()       { return this.data.envNotes; }
  getLastKnownPort()  { return this.data.lastKnownPort; }
  getActiveTaskState({ allowResume = false } = {}) { return allowResume ? this.data.activeTaskState : null; }
  getProjectFacts() { return this.data.projectFacts || []; }
  getPastFailures(limit = 10) { return (this.data.pastFailures || []).slice(-limit); }
  getUserPreferences() { return this.data.userPreferences || []; }
  getRunSummaries(limit = 5) { return (this.data.runSummaries || []).slice(-limit); }
}

module.exports = { ProjectMemory };
