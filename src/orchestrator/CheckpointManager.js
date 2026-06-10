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
    const file = path.join(this.dir, `${Date.now()}-${this.taskId}-${safeReason}.json`);
    const checkpoint = {
      taskId: this.taskId,
      reason,
      createdAt: new Date().toISOString(),
      filesChanged: [],
      completedTasks: [],
      validationStatus: {},
      ...payload
    };
    atomicWriteJson(file, checkpoint);
    return checkpoint;
  }
}

module.exports = { CheckpointManager };
