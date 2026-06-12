// src/commands/logs.js — `seekcode logs` command
// Shows seekcode orchestration traces (from .seekcode/traces/) by default.
// Pass --gateway to show the deeper gateway-level JSONL logs instead.
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────
//  ANSI colours (no deps)
// ─────────────────────────────────────────────
const A = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  gray: '\x1b[90m', lred: '\x1b[91m', lgreen: '\x1b[92m',
  lyellow: '\x1b[93m', lblue: '\x1b[94m', lcyan: '\x1b[96m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
};
const c  = (code, t) => `${A[code] || ''}${t}${A.reset}`;
const cb = (code, t) => `${A.bold}${A[code] || ''}${t}${A.reset}`;

function trunc(s, max = 400) {
  const str = String(s || '');
  return str.length <= max ? str : str.slice(0, max) + c('gray', ` …(+${str.length - max})`);
}
function fmtMs(ms) {
  if (ms == null) return '?';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// ─────────────────────────────────────────────
//  Seekcode trace log viewer (project-level JSONL)
// ─────────────────────────────────────────────

const ORCH_EVENT_COLOR = {
  session_start      : 'lcyan',
  session_end        : 'lcyan',
  orchestrator_init  : 'lblue',
  run_start          : 'lgreen',
  run_complete       : 'lgreen',
  run_error          : 'lred',
  plan_start         : 'cyan',
  plan_created       : 'cyan',
  plan_resumed       : 'cyan',
  research_start     : 'lyellow',
  research_end       : 'lyellow',
  research_error     : 'lred',
  step               : 'white',
  step_iteration_limit: 'lyellow',
  step_replan        : 'lyellow',
  validation_final   : 'lgreen',
  validation_after_repair: 'lgreen',
  repair_start       : 'magenta',
  repair_end         : 'magenta',
  repair_step        : 'magenta',
  repair_review_start: 'magenta',
  repair_review_end  : 'magenta',
  review_complete    : 'lgreen',
  review_after_repair: 'lgreen',
  replan_after_repair: 'lyellow',
  topic_update       : 'gray',
  llm_turn           : 'lblue',
  tool_call          : 'magenta',
  event              : 'gray',
};

function printOrchestratorEvent(entry) {
  const rawType = entry.type || entry.eventName || '?';
  const color   = ORCH_EVENT_COLOR[rawType] || 'gray';
  const ts      = (entry.timestamp || '').slice(11, 23);
  const dur     = entry.durationMs != null ? c('gray', ` (${fmtMs(entry.durationMs)})`) : '';

  process.stdout.write(
    `  ${c('gray', ts)}  ${cb(color, rawType.toUpperCase().slice(0, 24).padEnd(24))}${dur}\n`
  );

  // Specific fields per type
  switch (rawType) {
    case 'session_start':
      console.log(c('gray', `    cwd: ${entry.cwd}`));
      break;
    case 'run_start':
      console.log(c('gray', `    task: ${trunc(entry.task, 120)}`));
      break;
    case 'plan_created':
      console.log(c('cyan', `    steps (${entry.steps?.length || 0}):`));
      (entry.steps || []).forEach((s, i) => console.log(c('gray', `      ${i + 1}. ${trunc(s, 100)}`)));
      break;
    case 'research_start':
      console.log(c('gray', `    step ${entry.stepIndex}: ${trunc(entry.step, 100)}`));
      break;
    case 'research_end':
      console.log(c('gray', `    findings: ${entry.findingsLen} chars`));
      break;
    case 'research_error':
      console.log(c('lred', `    error: ${entry.error}`));
      break;
    case 'step':
      const icon = entry.status === 'complete' ? c('lgreen','✓') : c('lred','✗');
      console.log(`    ${icon} ${trunc(entry.stepName, 100)}`);
      if (entry.data?.changedFiles?.length)
        console.log(c('gray', `    changed: ${entry.data.changedFiles.join(', ')}`));
      break;
    case 'validation_final':
    case 'validation_after_repair':
      const vIcon = entry.success ? c('lgreen','✓ PASSED') : c('lred','✗ FAILED');
      console.log(`    ${vIcon}${entry.error ? c('lred',`  — ${trunc(entry.error, 120)}`) : ''}`);
      break;
    case 'repair_start':
    case 'repair_end':
      if (entry.success != null)
        console.log(`    ${entry.success ? c('lgreen','✓ repaired') : c('lred','✗ repair failed')}`);
      if (entry.error) console.log(c('gray', `    error: ${trunc(entry.error, 100)}`));
      break;
    case 'repair_step':
      console.log(`    step ${entry.stepIndex}: ${entry.success ? c('lgreen','✓') : c('lred','✗')}`);
      break;
    case 'review_complete':
    case 'review_after_repair':
      const rIcon = entry.passed ? c('lgreen','✓ PASSED') : c('lred','✗ FAILED');
      console.log(`    ${rIcon}`);
      if (!entry.passed && entry.findings?.length)
        entry.findings.slice(0, 3).forEach(f => console.log(c('gray', `      • ${trunc(f, 100)}`)));
      break;
    case 'run_complete':
      console.log(c('lgreen', `    ✓ done in ${fmtMs(entry.totalDurationMs)}`));
      console.log(c('gray',   `    steps: ${entry.stepsCompleted}/${entry.totalSteps}`));
      console.log(`    validation: ${entry.validationPassed ? c('lgreen','PASSED') : c('lred','FAILED')}  review: ${entry.reviewPassed ? c('lgreen','PASSED') : c('lred','FAILED')}`);
      break;
    case 'run_error':
      console.log(c('lred', `    ✗ ${entry.error}`));
      break;
    case 'llm_turn':
      console.log(c('gray', `    prompt:   ${entry.promptLength} chars`));
      console.log(c('gray', `    response: ${entry.responseLength} chars  dur: ${fmtMs(entry.durationMs)}`));
      break;
    case 'tool_call':
      console.log(c('magenta', `    tool: ${entry.tool}`));
      if (entry.error) console.log(c('lred', `    error: ${trunc(entry.error, 100)}`));
      break;
    case 'topic_update':
      console.log(c('gray', `    ${entry.title}: ${trunc(entry.intent, 100)}`));
      break;
    case 'step_replan':
      console.log(c('lyellow', `    step ${entry.stepIndex} failed: ${trunc(entry.error, 100)}`));
      break;
    default:
      const keys = Object.keys(entry).filter(k => !['type','eventName','timestamp'].includes(k));
      if (keys.length) console.log(c('gray', `    ${keys.map(k => `${k}=${JSON.stringify(entry[k])?.slice(0,60)}`).join('  ')}`));
  }
  console.log('');
}

function listTraceSessions(tracesDir) {
  if (!fs.existsSync(tracesDir)) return [];
  return fs.readdirSync(tracesDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort().reverse();
}

function showTraceLog(filePath, { summary } = {}) {
  const lines  = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  if (summary) {
    const counts = {};
    entries.forEach(e => { const t = e.type || e.eventName || '?'; counts[t] = (counts[t]||0)+1; });
    const start = entries.find(e => e.type === 'run_start');
    const end   = entries.find(e => e.type === 'run_complete');
    console.log(cb('lcyan', '\n══ TRACE SUMMARY ════════════════════════════════════════\n'));
    if (start) console.log(c('gray', `  task    : ${trunc(start.task, 120)}`));
    if (end)   console.log(`  result  : ${end.validationPassed ? c('lgreen','PASSED') : c('lred','FAILED')}  (${fmtMs(end.totalDurationMs)})`);
    console.log(c('gray', `  events  : ${entries.length}`));
    console.log('');
    console.log(cb('white', '  Event Counts:'));
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
      const color = ORCH_EVENT_COLOR[k] || 'gray';
      console.log(`    ${c(color, k.padEnd(30))} ${c('white', String(v).padStart(4))}×`);
    });
    console.log('');
    return;
  }

  console.log(cb('lcyan', `\n══ TRACE: ${path.basename(filePath)} ══\n`));
  entries.forEach(printOrchestratorEvent);
}

function listTraces(projectPath) {
  const tracesDir = path.join(projectPath, '.seekcode', 'traces');
  const files = listTraceSessions(tracesDir);
  console.log(cb('lcyan', '\n══ SEEKCODE TRACES ══════════════════════════════════════\n'));
  console.log(c('gray', `  Project : ${projectPath}`));
  console.log(c('gray', `  Dir     : ${tracesDir}\n`));

  if (!files.length) {
    console.log(c('lyellow', '  No traces found. Run a task first.\n'));
    return;
  }

  files.forEach((f, i) => {
    const fp   = path.join(tracesDir, f);
    const raw  = fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean);
    let evts=0, steps=0, errors=0, dur='?', task='?';
    for (const line of raw) {
      try {
        const e = JSON.parse(line); evts++;
        if (e.type === 'step') steps++;
        if (e.type === 'run_error') errors++;
        if (e.type === 'run_complete') dur = fmtMs(e.totalDurationMs);
        if (e.type === 'run_start') task = (e.task || '').slice(0, 60);
      } catch {}
    }
    const errTag = errors ? c('lred', ` ✖${errors}`) : '';
    console.log(
      `  ${c('gray', String(i+1).padStart(2)+'.')} ` +
      `${c('cyan', f.replace('.jsonl','').slice(0, 30).padEnd(32))}` +
      `${c('white', String(evts).padStart(4))} evts  ` +
      `${c('gray', dur.padStart(7))}  ` +
      `${c('dim', trunc(task, 50))}${errTag}`
    );
  });

  console.log('');
  console.log(c('gray', '  seekcode logs            → list sessions'));
  console.log(c('gray', '  seekcode logs <id>       → full trace'));
  console.log(c('gray', '  seekcode logs -l         → latest session'));
  console.log(c('gray', '  seekcode logs -l -s      → latest summary'));
  console.log(c('gray', '  seekcode logs --gateway  → gateway JSONL logs'));
  console.log('');
}

// ─────────────────────────────────────────────
//  Main command handler
// ─────────────────────────────────────────────
async function logsCommand(sessionArg, options = {}) {
  const projectPath = path.resolve(options.project || process.cwd());

  // Gateway logs — delegate to the view-logs.js in the gateway package
  if (options.gateway) {
    let viewLogsScript;
    try {
      viewLogsScript = require.resolve('deepseek-web-gateway/src/view-logs.js');
    } catch {
      viewLogsScript = path.resolve(__dirname, '..', '..', '..', 'deepseek-web-gateway', 'src', 'view-logs.js');
    }
    if (!fs.existsSync(viewLogsScript)) {
      console.error(c('lred', `  Could not find gateway log viewer at: ${viewLogsScript}`));
      process.exit(1);
    }
    const args = [viewLogsScript];
    if (sessionArg) args.push(sessionArg);
    if (options.last) args.push('--last');
    if (options.summary) args.push('--summary');
    try {
      execSync(`node ${args.join(' ')}`, { stdio: 'inherit' });
    } catch { /* already printed */ }
    return;
  }

  // Seekcode trace logs
  const tracesDir = path.join(projectPath, '.seekcode', 'traces');
  const files = listTraceSessions(tracesDir);

  let targetFile = null;

  if (options.last) {
    targetFile = files[0] ? path.join(tracesDir, files[0]) : null;
  } else if (sessionArg) {
    const match = files.find(f => f.includes(sessionArg));
    if (match) targetFile = path.join(tracesDir, match);
  }

  if (!sessionArg && !options.last) {
    listTraces(projectPath);
    return;
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    console.error(c('lred', `\n  No trace found matching: ${sessionArg || '(last)'}\n`));
    listTraces(projectPath);
    process.exit(1);
  }

  showTraceLog(targetFile, { summary: !!options.summary });
}

module.exports = { logsCommand };
