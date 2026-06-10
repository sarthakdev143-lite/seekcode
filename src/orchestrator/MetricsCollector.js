const fs = require('fs');
const path = require('path');

class MetricsCollector {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.metricsFile = path.join(this.projectDir, '.seekcode', 'metrics.json');
    this.metrics = this._load();
  }

  _load() {
    if (fs.existsSync(this.metricsFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.metricsFile, 'utf8'));
      } catch (err) {}
    }
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalSteps: 0,
      stepsCompleted: 0,
      stepsFailed: 0,
      buildsRun: 0,
      buildsSucceeded: 0,
      testsRun: 0,
      testsPassed: 0,
      repairsAttempted: 0,
      repairsSucceeded: 0,
      totalDurationMs: 0
    };
  }

  save() {
    const dir = path.dirname(this.metricsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.metricsFile, JSON.stringify(this.metrics, null, 2), 'utf8');
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
    this.metrics.buildsRun++;
    if (success) this.metrics.buildsSucceeded++;
    this.save();
  }

  recordTest(success) {
    this.metrics.testsRun++;
    if (success) this.metrics.testsPassed++;
    this.save();
  }

  recordRepair(success) {
    this.metrics.repairsAttempted++;
    if (success) this.metrics.repairsSucceeded++;
    this.save();
  }

  getSummary() {
    const buildSuccessRate = this.metrics.buildsRun > 0 ? (this.metrics.buildsSucceeded / this.metrics.buildsRun) * 100 : 100;
    const testPassRate = this.metrics.testsRun > 0 ? (this.metrics.testsPassed / this.metrics.testsRun) * 100 : 100;
    const repairSuccessRate = this.metrics.repairsAttempted > 0 ? (this.metrics.repairsSucceeded / this.metrics.repairsAttempted) * 100 : 0;
    
    return {
      ...this.metrics,
      buildSuccessRate: Math.round(buildSuccessRate),
      testPassRate: Math.round(testPassRate),
      repairSuccessRate: Math.round(repairSuccessRate)
    };
  }
}

module.exports = { MetricsCollector };
