'use strict';

const path = require('path');
const logger = require('../logger');

// Maximum simultaneous DeepSeek browser tabs allowed.
// The agent scales automatically between 1 and MAX_PARALLEL_TABS based on
// plan complexity — smaller plans reuse fewer tabs to avoid needless overhead.
const MAX_PARALLEL_TABS = 5;

class ParallelStepExecutor {
  /**
   * Run the execution plan steps in parallel where independent.
   * @param {Object} orchestrator The EnhancedOrchestrator instance
   * @param {Object} plan The plan containing steps array
   * @param {string} task The overall task description
   * @returns {Promise<string>} The combined results
   */
  static async run(orchestrator, plan, task) {
    const steps = plan.steps;
    const totalSteps = steps.length;
    const results = new Array(totalSteps).fill(null);
    const completed = new Set();
    const running = new Set();

    // Steps may be plain strings (rule-based plan) or annotated objects
    // { description, reads, writes } from the Option-B annotation pass.
    // Normalise to always work with both shapes.
    const stepDescriptions = steps.map(s =>
      typeof s === 'string' ? s : (s.description || String(s))
    );

    // 1. Build dependency graph (DAG)
    // We analyze the files mentioned in each step
    const stepFiles = steps.map((step, idx) => {
      return ParallelStepExecutor._extractStepFiles(step, orchestrator);
    });

    const dependencies = new Map(); // stepIndex -> Set of stepIndexes this step depends on
    for (let i = 0; i < totalSteps; i++) {
      dependencies.set(i, new Set());
    }

    // Heuristics for dependencies:
    // - A step depends on a previous step if they touch/write to the same file.
    // - Any step that looks like an "install", "setup", "initialize" or "migration" is a barrier:
    //   every subsequent step depends on it, and it depends on all prior steps.
    for (let i = 0; i < totalSteps; i++) {
      const stepText = stepDescriptions[i].toLowerCase();
      const isBarrier = stepText.includes('install') || stepText.includes('setup') || 
                        stepText.includes('init') || stepText.includes('git') || 
                        stepText.includes('build') || stepText.includes('configure');
      
      if (isBarrier) {
        // Depends on all prior steps
        for (let j = 0; j < i; j++) {
          dependencies.get(i).add(j);
        }
        // All subsequent steps depend on this barrier
        for (let j = i + 1; j < totalSteps; j++) {
          dependencies.get(j).add(i);
        }
      }

      // Check file overlap dependencies
      const filesI = stepFiles[i];
      for (let j = i + 1; j < totalSteps; j++) {
        const filesJ = stepFiles[j];
        const overlap = Array.from(filesI).some(f => filesJ.has(f));
        if (overlap) {
          dependencies.get(j).add(i);
        }
      }
    }

    // Auto-scale concurrency: use as many tabs as there are genuinely independent
    // steps, but never exceed MAX_PARALLEL_TABS.
    //
    // Scale rule ("wisdom to scale tabs"):
    //   totalSteps = 1  → max 1 tab
    //   ≤ 4 steps       → max 2 tabs
    //   ≤ 8 steps       → max 3 tabs
    //   > 8 steps       → max 5 tabs
    let MAX_CONCURRENT;
    if (totalSteps === 1)      MAX_CONCURRENT = 1;
    else if (totalSteps <= 4)  MAX_CONCURRENT = 2;
    else if (totalSteps <= 8)  MAX_CONCURRENT = 3;
    else                       MAX_CONCURRENT = MAX_PARALLEL_TABS; // 5

    const tabAssignment = new Map(); // stepIndex -> tabName string

    logger.info(
      `Built execution DAG (${totalSteps} steps). ` +
      `Auto-scaled to MAX_CONCURRENT=${MAX_CONCURRENT} tab(s).`
    );

    // 2. Loop until all steps are completed
    while (completed.size < totalSteps) {
      // Find all ready steps that are not yet running
      const readySteps = [];
      for (let i = 0; i < totalSteps; i++) {
        if (!completed.has(i) && !running.has(i)) {
          // Check if all dependencies are completed
          const deps = dependencies.get(i);
          const allDepsDone = Array.from(deps).every(d => completed.has(d));
          if (allDepsDone) {
            readySteps.push(i);
          }
        }
      }

      if (readySteps.length === 0 && running.size === 0) {
        // Deadlock or cyclic dependency? Fallback to sequential run of remaining steps
        const remaining = [];
        for (let i = 0; i < totalSteps; i++) {
          if (!completed.has(i) && !running.has(i)) remaining.push(i);
        }
        if (remaining.length > 0) {
          logger.warn(`Potential DAG cycle or deadlock. Executing remaining steps sequentially.`);
          for (const i of remaining) {
            await runStep(i);
          }
        }
        break;
      }

      // Start executing ready steps up to concurrency limit
      const limit = MAX_CONCURRENT - running.size;
      const stepsToStart = readySteps.slice(0, limit);

      if (stepsToStart.length > 0) {
        const promises = stepsToStart.map(async i => {
          running.add(i);
          
          // Allocate a dedicated tab for this step
          const tabName = `step-tab-${i + 1}`;
          tabAssignment.set(i, tabName);
          
          try {
            await runStep(i, tabName);
          } catch (err) {
            logger.error(`Error running step ${i + 1} on parallel tab: ${err.message}`);
            throw err;
          } finally {
            running.delete(i);
            completed.add(i);
          }
        });
        
        // Wait for at least one running step to finish before polling again
        await Promise.race(promises).catch(() => {});
      } else {
        // Just wait a moment for running tasks to complete
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    async function runStep(i, tabName) {
      orchestrator._updateTopic(`Step ${i+1}/${totalSteps}`, stepDescriptions[i]);
      orchestrator._renderProgressBar(i + 1, totalSteps, stepDescriptions[i]);
      
      // Construct dynamic step-aware context for this step
      const stepContext = orchestrator._baseContext(stepDescriptions[i]);
      
      // Override gateway/agent options to run on the specific tabName
      const originalOptions = orchestrator.options;
      const tabOptions = { ...originalOptions, tab: tabName };
      orchestrator.options = tabOptions;
      
      try {
        // Run execution step — pass the original step object (may have reads/writes)
        const result = await orchestrator._executeStep(i, steps[i], totalSteps, task, stepContext);
        results[i] = result;
      } finally {
        // Restore original options
        orchestrator.options = originalOptions;
      }
    }

    return results.filter(Boolean).join('');
  }

  /**
   * Extract the set of files a step is expected to touch.
   *
   * Priority order:
   *   1. Annotated reads+writes from the Option-B planning pass  (accurate)
   *   2. Keyword heuristics against the existing dependency graph (fallback)
   *
   * @param {string|{description,reads,writes}} step
   * @param {Object} orchestrator
   * @returns {Set<string>}
   */
  static _extractStepFiles(step, orchestrator) {
    const fileSet = new Set();

    // ── Option B: use annotated file lists when present ───────────────────────
    if (step && typeof step === 'object') {
      const reads  = Array.isArray(step.reads)  ? step.reads  : [];
      const writes = Array.isArray(step.writes) ? step.writes : [];
      for (const f of [...reads, ...writes]) {
        if (f) fileSet.add(f);
      }
      // If the annotation gave us data, trust it and skip heuristics
      if (fileSet.size > 0) return fileSet;
    }

    // ── Fallback: keyword heuristics ──────────────────────────────────────
    const graph = orchestrator.analyzer.getDependencyGraph();
    if (!graph) return fileSet;

    const stepText = typeof step === 'string' ? step : (step.description || '');
    const allFiles = graph.getAllFiles();
    const words = stepText.toLowerCase().split(/[^a-zA-Z0-9_\-\.\/]+/);

    for (const word of words) {
      if (word.length < 3) continue;
      for (const fp of allFiles) {
        const rel  = fp.toLowerCase();
        const base = path.basename(fp).toLowerCase();
        if (rel.includes(word) || word.includes(base)) {
          fileSet.add(fp);
        }
      }
    }
    return fileSet;
  }
}

module.exports = { ParallelStepExecutor };
