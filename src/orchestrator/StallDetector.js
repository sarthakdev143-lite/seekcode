'use strict';

const fs = require('fs');
const path = require('path');

class StallDetector {
  constructor(orchestrator, options = {}) {
    this.orchestrator = orchestrator;
    this.timeoutMs = Number(options.timeoutMs || process.env.SEEKCODE_STALL_MS || 5 * 60 * 1000);
    this.retryLimit = options.retryLimit ?? 1;
  }

  async runStepWithRecovery(stepInfo, fn) {
    let attempt = 0;
    while (true) {
      try {
        return await this._race(stepInfo, fn);
      } catch (err) {
        if (!err.isStall || attempt >= this.retryLimit) throw err;
        attempt++;
        const diagnosis = await this.diagnoseAndRecover(stepInfo, err);
        this.orchestrator._log('stall_retry', { stepInfo, attempt, diagnosis });
      }
    }
  }

  _race(stepInfo, fn) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        const err = new Error(`No orchestrator progress for ${Math.round(this.timeoutMs / 60000)} minute(s)`);
        err.isStall = true;
        err.stepInfo = stepInfo;
        reject(err);
      }, this.timeoutMs);

      Promise.resolve()
        .then(fn)
        .then(value => {
          done = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch(err => {
          done = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async diagnoseAndRecover(stepInfo, err) {
    const artifacts = {
      reason: err.message,
      tracePath: this.orchestrator.traceLogger?.projectLogPath || null,
      changeLogPath: path.join(this.orchestrator.projectPath, '.seekcode', 'changes.json'),
      changeLogMtime: null,
      browser: null,
    };

    try {
      if (fs.existsSync(artifacts.changeLogPath)) {
        artifacts.changeLogMtime = fs.statSync(artifacts.changeLogPath).mtime.toISOString();
      }
    } catch {}

    try {
      artifacts.browser = await this.orchestrator.gateway.diagnose(stepInfo.tab || 'default');
    } catch (diagErr) {
      artifacts.browser = { error: diagErr.message };
    }

    try {
      await this.orchestrator.gateway.recreateTab(stepInfo.tab || 'default');
      artifacts.tabRecreated = true;
    } catch (recreateErr) {
      artifacts.tabRecreated = false;
      artifacts.recreateError = recreateErr.message;
      try {
        await this.orchestrator.gateway.closeSession();
        await this.orchestrator.gateway.createSession();
        artifacts.sessionRecreated = true;
      } catch (sessionErr) {
        artifacts.sessionRecreated = false;
        artifacts.sessionError = sessionErr.message;
      }
    }

    this.orchestrator.journal?.record('stall-diagnosis', { stepInfo, artifacts });
    return artifacts;
  }
}

module.exports = { StallDetector };
