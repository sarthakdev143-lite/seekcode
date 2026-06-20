'use strict';

const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');

class FailureReporter {
  constructor(projectDir, taskManager, traceLogger) {
    this.projectDir = projectDir;
    this.taskManager = taskManager;
    this.traceLogger = traceLogger;
  }

  write(error, context = {}) {
    const currentStep = this.taskManager?.getCurrentStep?.();
    const report = {
      at: new Date().toISOString(),
      taskId: this.taskManager?.taskId || null,
      phase: this.taskManager?.state?.phase || 'unknown',
      currentStep: currentStep ? {
        id: currentStep.id,
        description: currentStep.description,
        status: currentStep.status,
      } : null,
      lastToolCall: context.lastToolCall || null,
      lastModelResponsePreview: context.lastModelResponsePreview || null,
      tracePath: this.traceLogger?.projectLogPath || null,
      error: error?.message || String(error || 'unknown error'),
      stack: error?.stack?.slice(0, 2000) || null,
      suggestedResumeCommand: this.taskManager?.taskId
        ? `SEEKCODE_TASK_ID=${this.taskManager.taskId} seekcode resume "${this.projectDir}"`
        : null,
    };

    const file = path.join(this.projectDir, '.seekcode', 'failures', `${report.taskId || Date.now()}.json`);
    atomicWriteJson(file, report);
    return { file, report };
  }
}

module.exports = { FailureReporter };
