'use strict';
// src/session/WorkLog.js
// A structured, persistent log of everything seekcode has attempted on a project.
// Unlike the journal (which is per-task write-only JSONL), WorkLog is a queryable
// living record that spans all sessions and provides the basis for SituationReport.

const fs   = require('fs');
const path = require('path');

class WorkLog {
  /**
   * @param {string} projectPath
   */
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.logDir  = path.join(this.projectPath, '.seekcode');
    this.logFile = path.join(this.logDir, 'work-log.json');
    this._ensureDir();
    this.entries = this._load();
  }

  _ensureDir() {
    try { fs.mkdirSync(this.logDir, { recursive: true }); } catch {}
  }

  _load() {
    try {
      if (fs.existsSync(this.logFile)) {
        return JSON.parse(fs.readFileSync(this.logFile, 'utf8'));
      }
    } catch {}
    return [];
  }

  _save() {
    try {
      // Keep only last 500 entries
      if (this.entries.length > 500) this.entries = this.entries.slice(-500);
      const tmp = this.logFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2), 'utf8');
      fs.renameSync(tmp, this.logFile);
    } catch {}
  }

  /**
   * Record a completed step with its outcome.
   * @param {object} entry
   */
  record({ type, task, step, result, success, filesChanged = [], error = null, durationMs = 0 }) {
    this.entries.push({
      at: new Date().toISOString(),
      type,         // 'step' | 'repair' | 'validation' | 'session_end' | 'env_fix'
      task: (task || '').slice(0, 200),
      step: (step || '').slice(0, 200),
      result: (result || '').slice(0, 600),
      success,
      filesChanged,
      error: error ? error.slice(0, 400) : null,
      durationMs,
    });
    this._save();
  }

  /**
   * Get the N most recent entries optionally filtered by type or success.
   */
  recent(limit = 20, { type = null, successOnly = false } = {}) {
    let filtered = this.entries;
    if (type) filtered = filtered.filter(e => e.type === type);
    if (successOnly) filtered = filtered.filter(e => e.success);
    return filtered.slice(-limit);
  }

  /**
   * Get failed attempts for a specific task (by substring match).
   */
  failuresForTask(taskSubstring, limit = 5) {
    return this.entries
      .filter(e => !e.success && e.task && e.task.includes(taskSubstring))
      .slice(-limit);
  }

  /**
   * Summarize what has been done — used for building the situation report.
   */
  summarize() {
    const total = this.entries.length;
    if (total === 0) return null;

    const sessions = new Set(this.entries.map(e => e.at.slice(0, 10))).size;
    const failures = this.entries.filter(e => !e.success && e.type === 'step');
    const successes = this.entries.filter(e => e.success && e.type === 'step');
    const validations = this.entries.filter(e => e.type === 'validation');
    const lastValidation = validations[validations.length - 1] || null;

    // Files touched most
    const fileHits = {};
    for (const e of this.entries) {
      for (const f of (e.filesChanged || [])) {
        fileHits[f] = (fileHits[f] || 0) + 1;
      }
    }
    const hotFiles = Object.entries(fileHits)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([f]) => f);

    // Common failure patterns
    const errorTexts = failures.map(e => e.error).filter(Boolean);
    const commonErrors = [...new Set(errorTexts)].slice(0, 5);

    return {
      totalEntries: total,
      sessionDays: sessions,
      successfulSteps: successes.length,
      failedSteps: failures.length,
      lastActivity: this.entries[total - 1]?.at || null,
      lastValidation,
      hotFiles,
      commonErrors,
      recentSteps: this.entries.slice(-5),
    };
  }
}

module.exports = { WorkLog };
