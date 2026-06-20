'use strict';

const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');

class ExecutionJournal {
  constructor(projectDir, taskId) {
    this.projectDir = projectDir;
    this.taskId = taskId;
    this.entries = [];
    this.file = path.join(projectDir, '.seekcode', 'journal', `${taskId}.json`);
  }

  record(type, data = {}) {
    this.entries.push({ time: new Date().toISOString(), type, ...data });
    atomicWriteJson(this.file, { taskId: this.taskId, entries: this.entries });
  }
}

module.exports = { ExecutionJournal };
