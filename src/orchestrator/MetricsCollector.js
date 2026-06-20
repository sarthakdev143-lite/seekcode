const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../utils/atomicWrite');

class MetricsCollector {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.metricsDir = path.join(this.projectDir, '.seekcode', 'metrics');
    this.metricsFile = path.join(this.metricsDir, 'project.json');
    this.metrics = this._load();
  }

  _getDefaults() {
    return {
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
  }

  _load() {
    const defaults = this._getDefaults();
    if (fs.existsSync(this.metricsFile)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.metricsFile, 'utf8'));
        return {
          ...defaults,
          ...loaded
        };
      } catch (err) {}
    }
    return defaults;
  }

  save() {
    if (!fs.existsSync(this.metricsDir)) fs.mkdirSync(this.metricsDir, { recursive: true });
    atomicWriteJson(this.metricsFile, this.metrics);
    
    // Also save to global metrics
    try {
      const os = require('os');
      const globalMetricsDir = path.join(os.homedir(), '.seekcode', 'metrics');
      if (!fs.existsSync(globalMetricsDir)) fs.mkdirSync(globalMetricsDir, { recursive: true });
      const globalMetricsFile = path.join(globalMetricsDir, 'global.json');
      
      let globalMetrics = this._getDefaults();
      if (fs.existsSync(globalMetricsFile)) {
        try {
          globalMetrics = JSON.parse(fs.readFileSync(globalMetricsFile, 'utf8'));
        } catch {}
      }
      
      // Update global metrics (increment based on current project metrics)
      // Note: This is a simple approximation. In a real system we'd track session-specific deltas.
      // For now, we'll just write project metrics to global as well (or merge them if we knew the delta).
      // Let's just store the project metrics in a project-specific file in the global dir.
      const projectHash = require('crypto').createHash('md5').update(this.projectDir).digest('hex');
      const globalProjectFile = path.join(globalMetricsDir, `project-${projectHash}.json`);
      atomicWriteJson(globalProjectFile, {
        projectPath: this.projectDir,
        ...this.metrics
      });

      // Aggregated global metrics
      const files = fs.readdirSync(globalMetricsDir).filter(f => f.startsWith('project-') && f.endsWith('.json'));
      const aggregated = this._getDefaults();
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(globalMetricsDir, file), 'utf8'));
          for (const key in aggregated) {
            if (typeof data[key] === 'number') aggregated[key] += data[key];
          }
        } catch {}
      }
      atomicWriteJson(globalMetricsFile, aggregated);
    } catch (err) {
      // Ignore global metrics errors
    }
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
