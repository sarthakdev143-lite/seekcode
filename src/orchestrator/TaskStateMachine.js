'use strict';

const STATES = Object.freeze({
  PLANNING: 'planning',
  EXECUTING: 'executing',
  VALIDATING: 'validating',
  REVIEWING: 'reviewing',
  DONE: 'done',
  FAILED: 'failed',
});

const ALLOWED = Object.freeze({
  pending: new Set([STATES.PLANNING, STATES.EXECUTING, STATES.FAILED]),
  [STATES.PLANNING]: new Set([STATES.EXECUTING, STATES.FAILED]),
  [STATES.EXECUTING]: new Set([STATES.VALIDATING, STATES.FAILED]),
  [STATES.VALIDATING]: new Set([STATES.EXECUTING, STATES.REVIEWING, STATES.FAILED]),
  [STATES.REVIEWING]: new Set([STATES.EXECUTING, STATES.DONE, STATES.FAILED]),
  [STATES.DONE]: new Set([]),
  [STATES.FAILED]: new Set([]),
});

class TaskStateMachine {
  constructor(taskManager, { journal = null, traceLogger = null } = {}) {
    this.taskManager = taskManager;
    this.journal = journal;
    this.traceLogger = traceLogger;
  }

  get state() {
    return this.taskManager?.state?.phase || 'pending';
  }

  transition(to, meta = {}) {
    const from = this.state;
    const allowed = ALLOWED[from] || new Set();
    if (from !== to && !allowed.has(to)) {
      throw new Error(`Invalid task phase transition: ${from} -> ${to}`);
    }

    const entry = {
      from,
      to,
      at: new Date().toISOString(),
      ...meta,
    };
    this.taskManager.recordTransition(entry);
    this.journal?.record('state-transition', entry);
    this.traceLogger?.logEvent('state_transition', entry);
    return entry;
  }

  fail(error, meta = {}) {
    return this.transition(STATES.FAILED, {
      error: error?.message || String(error || 'unknown error'),
      ...meta,
    });
  }
}

module.exports = { TaskStateMachine, STATES };
