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
      status: 'pending',
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
      } catch (err) {
        logger.warn(`Failed to load task state: ${err.message}`);
      }
    }
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

  setPlan(steps) {
    this.state.steps = steps.map((s, index) => ({
      id: index,
      description: s,
      status: 'pending',
      result: null,
      startTime: null,
      endTime: null,
      error: null
    }));
    this.state.status = 'in-progress';
    this.state.currentStepIndex = 0;
    this.save();
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
      this.save();
    }
  }

  completeStep(index, result) {
    this.updateStepStatus(index, 'completed', result);
    this.state.currentStepIndex = index + 1;
    if (this.state.currentStepIndex >= this.state.steps.length) {
      this.state.status = 'completed';
      this.state.endTime = Date.now();
    }
    this.save();
  }

  failStep(index, error) {
    this.updateStepStatus(index, 'failed', null, error);
    this.state.status = 'failed';
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
