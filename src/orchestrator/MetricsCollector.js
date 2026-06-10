const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');

class MetricsCollector {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.metricsFile = path.join(this.projectDir, '.seekcode', 'metrics.json');
    this.metrics = this._load();
  }

  _load() {
    const defaults = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalSteps: 0,
      stepsCompleted: 0,
      stepsFailed: 0,
      buildRuns: 0,
      buildFailures: 0,
      testRuns: 0,
      testFailures: 0,
      repairAttempts: 0,
      repairSuccess: 0,
      totalDurationMs: 0
    };
    if (fs.existsSync(this.metricsFile)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.metricsFile, 'utf8'));
        return {
          ...defaults,
          ...loaded,
          buildRuns: loaded.buildRuns ?? loaded.buildsRun ?? defaults.buildRuns,
          buildFailures: loaded.buildFailures ?? ((loaded.buildsRun || 0) - (loaded.buildsSucceeded || 0)),
          testRuns: loaded.testRuns ?? loaded.testsRun ?? defaults.testRuns,
          testFailures: loaded.testFailures ?? ((loaded.testsRun || 0) - (loaded.testsPassed || 0)),
          repairAttempts: loaded.repairAttempts ?? loaded.repairsAttempted ?? defaults.repairAttempts,
          repairSuccess: loaded.repairSuccess ?? loaded.repairsSucceeded ?? defaults.repairSuccess
        };
      } catch (err) {}
    }
    return defaults;
  }

  save() {
    const dir = path.dirname(this.metricsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteJson(this.metricsFile, this.metrics);
  }

  recordTask(success, durationMs) {
    if (success) this.metrics.tasksCompleted++;
    else this.metrics.tasksFailed++;
    this.metrics.totalDurationMs += durationMs;
    this.save();
  }

  recordStep(success) {
    this.metrics.totalSteps++;
    if (success) this.metrics.stepsCompleted++;
    else this.metrics.stepsFailed++;
    this.save();
  }

  recordBuild(success) {
    this.metrics.buildRuns++;
    if (!success) this.metrics.buildFailures++;
    this.save();
  }

  recordTest(success) {
    this.metrics.testRuns++;
    if (!success) this.metrics.testFailures++;
    this.save();
  }

  recordRepair(success) {
    this.metrics.repairAttempts++;
    if (success) this.metrics.repairSuccess++;
    this.save();
  }

  recordValidation(validation) {
    for (const run of validation.runs || []) {
      if (run.skipped) continue;
      if (run.phase === 'build') this.metrics.buildRuns++;
      if (run.phase === 'build' && !run.success) this.metrics.buildFailures++;
      if (run.phase === 'test') this.metrics.testRuns++;
      if (run.phase === 'test' && !run.success) this.metrics.testFailures++;
    }
    this.save();
  }

  getSummary() {
    const buildSuccessRate = this.metrics.buildRuns > 0 ? ((this.metrics.buildRuns - this.metrics.buildFailures) / this.metrics.buildRuns) * 100 : 100;
    const testPassRate = this.metrics.testRuns > 0 ? ((this.metrics.testRuns - this.metrics.testFailures) / this.metrics.testRuns) * 100 : 100;
    const repairSuccessRate = this.metrics.repairAttempts > 0 ? (this.metrics.repairSuccess / this.metrics.repairAttempts) * 100 : 0;
    
    return {
      ...this.metrics,
      buildSuccessRate: Math.round(buildSuccessRate),
      testPassRate: Math.round(testPassRate),
      repairSuccessRate: Math.round(repairSuccessRate)
    };
  }
}

module.exports = { MetricsCollector };
