'use strict';
// src/session/SituationReport.js
// Generates a rich "SITUATION REPORT" string that is injected at the TOP of
// every LLM prompt sent to the agent. This gives the agent full context about
// what has happened across ALL prior sessions, eliminating cross-session amnesia.
//
// This is the direct equivalent of the "checkpoint summary" you see in antigravity
// that keeps the orchestration context coherent across long conversations.

const { ProjectMemory } = require('./ProjectMemory');
const { WorkLog }       = require('./WorkLog');

class SituationReport {
  /**
   * @param {string} projectPath
   */
  constructor(projectPath) {
    this.memory  = new ProjectMemory(projectPath);
    this.workLog = new WorkLog(projectPath);
  }

  /**
   * Generate the full situation report as a string.
   * Returns null if this is a fresh project with no prior history.
   */
  generate() {
    const summary = this.workLog.summarize();
    const broken  = this.memory.getKnownBroken();
    const working = this.memory.getKnownWorking();
    const lastVal = this.memory.getLastValidation();
    const envNotes = this.memory.getEnvNotes();
    const hotFiles = this.memory.getMostChangedFiles(8);
    const sessions = this.memory.getRecentSessions(3);

    // Nothing to report on a brand new project
    if (!summary && broken.length === 0 && working.length === 0) return null;

    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                     SITUATION REPORT                        ║',
      '║  (Persistent memory from all previous SeekCode sessions)    ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
    ];

    // --- Last validation state (most critical) ---
    if (lastVal) {
      const status = lastVal.success ? '✅ PASSED' : '❌ FAILED';
      lines.push(`LAST VALIDATION: ${status} (${this._relativeTime(lastVal.at)})`);
      if (!lastVal.success && lastVal.error) {
        lines.push(`  Error: ${lastVal.error}`);
        if (lastVal.phase) lines.push(`  Phase: ${lastVal.phase}`);
      }
      lines.push('');
    }

    // --- Known broken issues ---
    if (broken.length > 0) {
      lines.push('⚠️  KNOWN BROKEN (fix these before doing other work):');
      for (const b of broken.slice(0, 8)) {
        lines.push(`  • ${b.issue}  [${b.attempts} attempt(s), last seen ${this._relativeTime(b.lastSeen)}]`);
      }
      lines.push('');
    }

    // --- Known working ---
    if (working.length > 0) {
      lines.push('✅ CONFIRMED WORKING (do not break these):');
      for (const w of working.slice(0, 8)) {
        lines.push(`  • ${w.feature}`);
      }
      lines.push('');
    }

    // --- Environment notes ---
    if (envNotes.length > 0) {
      lines.push('🔧 ENVIRONMENT NOTES:');
      for (const note of envNotes) {
        lines.push(`  • ${note}`);
      }
      lines.push('');
    }

    // --- Most changed files (hotspots) ---
    if (hotFiles.length > 0) {
      lines.push('📁 MOST MODIFIED FILES (by prior sessions):');
      for (const f of hotFiles) {
        lines.push(`  ${f.file}  (changed ${f.changeCount}× across sessions)`);
      }
      lines.push('');
    }

    // --- Recent work log summary ---
    if (summary) {
      lines.push(`📊 WORK HISTORY: ${summary.totalEntries} actions across ${summary.sessionDays} day(s)`);
      lines.push(`   ✓ ${summary.successfulSteps} steps succeeded  ✗ ${summary.failedSteps} steps failed`);
      if (summary.lastActivity) {
        lines.push(`   Last activity: ${this._relativeTime(summary.lastActivity)}`);
      }
      if (summary.commonErrors.length > 0) {
        lines.push('   Most common errors:');
        for (const err of summary.commonErrors) {
          lines.push(`     - ${err.slice(0, 120)}`);
        }
      }
      lines.push('');
    }

    // --- Recent session summaries ---
    if (sessions.length > 0) {
      lines.push('🕐 RECENT SESSIONS:');
      for (const s of sessions.reverse()) {
        const dur = s.endedAt ? this._duration(s.startedAt, s.endedAt) : 'in-progress';
        lines.push(`  • ${this._relativeTime(s.startedAt)} — "${s.task?.slice(0, 80)}"  [${s.outcome}, ${dur}]`);
      }
      lines.push('');
    }

    lines.push('══════════════════════════════════════════════════════════════');
    lines.push('USE THIS CONTEXT: Do not repeat failed approaches. Fix known broken issues first.');
    lines.push('If you fix a known broken issue, it will be removed from future reports automatically.');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Quick one-liner version for injecting into sub-prompts.
   */
  brief() {
    const broken = this.memory.getKnownBroken();
    const lastVal = this.memory.getLastValidation();
    const summary = this.workLog.summarize();

    const parts = [];
    if (lastVal && !lastVal.success) {
      parts.push(`Last build: FAILED — ${(lastVal.error || 'unknown error').slice(0, 120)}`);
    }
    if (broken.length > 0) {
      parts.push(`Known broken: ${broken.slice(0, 3).map(b => b.issue).join('; ')}`);
    }
    if (summary && summary.failedSteps > 0) {
      parts.push(`Prior sessions: ${summary.successfulSteps} steps OK, ${summary.failedSteps} failed`);
    }
    return parts.length > 0 ? `[PRIOR CONTEXT: ${parts.join(' | ')}]` : null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _relativeTime(isoString) {
    if (!isoString) return 'unknown';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  _duration(start, end) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
}

module.exports = { SituationReport };
