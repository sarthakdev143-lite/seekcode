const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { atomicWriteJson } = require('../utils/atomicWrite');

class TaskManager {
  constructor(projectDir, taskId) {
    this.projectDir = projectDir;
    this.taskId = taskId || `task_${Date.now()}`;
    this.stateDir = path.join(this.projectDir, '.seekcode', 'tasks');
    this.stateFile = path.join(this.stateDir, `${this.taskId}.json`);
    this.lastActiveFile = path.join(this.projectDir, '.seekcode', 'last-active-task.json');
    this.state = {
      taskId: this.taskId,
      taskDescription: null,
      status: 'pending',
      phase: 'pending',
      transitions: [],
      lastProgressAt: Date.now(),
      activity: [],
      steps: [],
      currentStepIndex: -1,
      startTime: Date.now(),
      endTime: null,
      error: null
    };
    
    this._init();
  }

  _init() {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
    
    if (fs.existsSync(this.stateFile)) {
      try {
        this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        this.state.phase = this.state.phase || (this.state.status === 'completed' ? 'done' : this.state.status === 'failed' ? 'failed' : 'pending');
        this.state.transitions = Array.isArray(this.state.transitions) ? this.state.transitions : [];
        this.state.activity = Array.isArray(this.state.activity) ? this.state.activity : [];
        this.state.lastProgressAt = this.state.lastProgressAt || Date.now();
        this._normalizeLoadedSteps();
      } catch (err) {
        logger.warn(`Failed to load task state: ${err.message}`);
      }
    }
  }

  _normalizeLoadedSteps() {
    if (!Array.isArray(this.state.steps)) return;
    this.state.steps = this.state.steps.map((step, index) => {
      const rawDescription = step.description ?? step;
      const metadata = rawDescription && typeof rawDescription === 'object' ? rawDescription : step;
      return {
        ...step,
        id: step.id ?? index,
        description: typeof rawDescription === 'string'
          ? rawDescription
          : (rawDescription?.description || String(rawDescription)),
        reads: Array.isArray(step.reads) ? step.reads : (Array.isArray(metadata?.reads) ? metadata.reads : []),
        writes: Array.isArray(step.writes) ? step.writes : (Array.isArray(metadata?.writes) ? metadata.writes : []),
      };
    });
    this.save();
  }

  save() {
    try {
      atomicWriteJson(this.stateFile, this.state);
      atomicWriteJson(this.lastActiveFile, {
        taskId: this.taskId,
        updatedAt: Date.now(),
        status: this.state.status
      });
    } catch (err) {
      logger.error(`Failed to save task state: ${err.message}`);
    }
  }

  setPlan(steps, taskDescription = null) {
    if (taskDescription) this.state.taskDescription = taskDescription;
    this.state.steps = steps.map((s, index) => ({
      id: index,
      description: typeof s === 'string' ? s : (s?.description || String(s)),
      reads: Array.isArray(s?.reads) ? s.reads : [],
      writes: Array.isArray(s?.writes) ? s.writes : [],
      status: 'pending',
      result: null,
      startTime: null,
      endTime: null,
      error: null
    }));
    this.state.status = 'in-progress';
    this.state.phase = 'planning';
    this.state.currentStepIndex = 0;
    this.recordActivity('plan-set', { steps: this.state.steps.length }, false);
    this.save();
  }

  recordTransition(entry) {
    this.state.phase = entry.to;
    this.state.transitions = Array.isArray(this.state.transitions) ? this.state.transitions : [];
    this.state.transitions.push(entry);
    this.recordActivity('state-transition', entry, false);
    if (entry.to === 'done') {
      this.state.status = 'completed';
      this.state.endTime = Date.now();
    }
    if (entry.to === 'failed') {
      this.state.status = 'failed';
      this.state.endTime = Date.now();
      this.state.error = entry.error || this.state.error;
    }
    this.save();
  }

  recordActivity(type, data = {}, save = true) {
    this.state.lastProgressAt = Date.now();
    this.state.activity = Array.isArray(this.state.activity) ? this.state.activity : [];
    this.state.activity.push({ at: new Date().toISOString(), type, ...data });
    this.state.activity = this.state.activity.slice(-100);
    if (save) this.save();
  }

  getCurrentStep() {
    if (this.state.currentStepIndex >= 0 && this.state.currentStepIndex < this.state.steps.length) {
      return this.state.steps[this.state.currentStepIndex];
    }
    return null;
  }

  updateStepStatus(index, status, result = null, error = null) {
    const step = this.state.steps[index];
    if (step) {
      step.status = status;
      if (status === 'in-progress') step.startTime = Date.now();
      if (status === 'completed' || status === 'failed') step.endTime = Date.now();
      if (result) step.result = result;
      if (error) step.error = error;
      this.recordActivity('step-status', { index, status, error }, false);
      this.save();
    }
  }

  completeStep(index, result) {
    this.updateStepStatus(index, 'completed', result);
    this.state.currentStepIndex = index + 1;
    if (this.state.currentStepIndex >= this.state.steps.length) {
      this.state.status = 'completed';
      this.state.phase = 'validating';
      this.state.endTime = Date.now();
    }
    this.save();
  }

  failStep(index, error) {
    this.updateStepStatus(index, 'failed', null, error);
    this.state.status = 'failed';
    this.state.phase = 'failed';
    this.state.endTime = Date.now();
    this.save();
  }

  static findPendingTask(projectDir, explicitTaskId = null) {
    const stateDir = path.join(projectDir, '.seekcode', 'tasks');
    if (!fs.existsSync(stateDir)) return null;

    if (explicitTaskId) {
      const explicitFile = path.join(stateDir, `${explicitTaskId}.json`);
      if (fs.existsSync(explicitFile)) return explicitTaskId;
      return null;
    }

    const lastActiveFile = path.join(projectDir, '.seekcode', 'last-active-task.json');
    try {
      if (fs.existsSync(lastActiveFile)) {
        const last = JSON.parse(fs.readFileSync(lastActiveFile, 'utf8'));
        const state = JSON.parse(fs.readFileSync(path.join(stateDir, `${last.taskId}.json`), 'utf8'));
        if (state.status === 'in-progress') return state.taskId;
      }
    } catch {}
    
    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    const candidates = [];
    for (const file of files) {
      try {
        const fullPath = path.join(stateDir, file);
        const state = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (state.status === 'in-progress') candidates.push({ taskId: state.taskId, mtimeMs: fs.statSync(fullPath).mtimeMs });
      } catch {}
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.taskId || null;
  }
}

module.exports = { TaskManager };
