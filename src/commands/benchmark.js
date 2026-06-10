'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ValidationEngine } = require('../orchestrator/ValidationEngine');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function run(command, cwd, timeoutMs = 300000) {
  return new Promise(resolve => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', c => { output += c.toString(); });
    child.stderr.on('data', c => { output += c.toString(); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ success: code === 0, code, output });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ success: false, code: null, output: err.message });
    });
  });
}

function expectedOutputsPass(workspace, expectedOutputs = []) {
  const failures = [];
  for (const expected of expectedOutputs) {
    const file = path.join(workspace, expected.file);
    if (!fs.existsSync(file)) {
      failures.push(`Missing ${expected.file}`);
      continue;
    }
    if (expected.contains && !fs.readFileSync(file, 'utf8').includes(expected.contains)) {
      failures.push(`${expected.file} does not contain ${expected.contains}`);
    }
  }
  return { success: failures.length === 0, failures };
}

async function benchmarkCommand(projectPath, options = {}) {
  const root = path.resolve(projectPath || process.cwd());
  const benchmarksDir = path.join(root, 'benchmarks');
  const runRoot = path.join(root, '.seekcode', 'benchmark-runs');
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });

  const specs = fs.readdirSync(benchmarksDir)
    .map(name => path.join(benchmarksDir, name, 'benchmark.json'))
    .filter(file => fs.existsSync(file))
    .map(file => ({ file, spec: JSON.parse(fs.readFileSync(file, 'utf8')) }));

  const results = [];
  for (const { file, spec } of specs) {
    const start = Date.now();
    const source = path.join(path.dirname(file), 'fixture');
    const workspace = path.join(runRoot, spec.id);
    copyDir(source, workspace);
    if (fs.existsSync(path.join(workspace, 'package.json'))) {
      await run('npm install --silent', workspace, Number(options.timeoutMs || 300000));
    }

    let interventionCount = 0;
    let agentResult = { success: !options.agent, output: 'agent disabled' };
    if (options.agent) {
      interventionCount = 1;
      const cli = path.join(root, 'src', 'seekcode.js');
      agentResult = await run(`node "${cli}" run "${workspace}" "${spec.task.replace(/"/g, '\\"')}"`, root, Number(options.timeoutMs || 600000));
    }

    const validator = new ValidationEngine(workspace, {
      buildCommand: spec.validationCommands?.build || null,
      testCommand: spec.validationCommands?.test || null,
      timeoutMs: Number(options.timeoutMs || 300000)
    });
    const validation = await validator.validate({ quiet: true });
    const expected = expectedOutputsPass(workspace, spec.expectedOutputs);
    const buildSuccess = validation.runs?.find(r => r.phase === 'build')?.success ?? true;
    const testRun = validation.runs?.find(r => r.phase === 'test');
    const testSuccess = buildSuccess && (testRun?.success ?? true);
    const success = agentResult.success && validation.success && expected.success;
    const repairSuccess = /repair-success|Final Validation: PASSED/i.test(agentResult.output || '');
    results.push({
      id: spec.id,
      success,
      buildSuccess,
      testSuccess,
      repairSuccess,
      interventionCount,
      executionTimeMs: Date.now() - start,
      failures: expected.failures
    });
  }

  const avg = key => results.length ? results.reduce((n, r) => n + Number(r[key] || 0), 0) / results.length : 0;
  const rate = key => results.length ? Math.round((results.filter(r => r[key]).length / results.length) * 100) : 0;
  const summary = {
    completionRate: rate('success'),
    buildSuccessRate: rate('buildSuccess'),
    testPassRate: rate('testSuccess'),
    repairSuccessRate: rate('repairSuccess'),
    averageInterventionCount: Number(avg('interventionCount').toFixed(2)),
    averageExecutionTimeMs: Math.round(avg('executionTimeMs')),
    results
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

module.exports = { benchmarkCommand };
