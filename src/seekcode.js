#!/usr/bin/env node
const { program } = require('commander');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { analyzeCommand } = require('./commands/analyze');
const { planCommand } = require('./commands/plan');
const { runCommand } = require('./commands/run');
const { benchmarkCommand } = require('./commands/benchmark');
const { logsCommand } = require('./commands/logs');
const { ProjectAnalyzer } = require('./analyzer/ProjectAnalyzer');

const { TraceLogger } = require('./trace-logger');

// ---------- Crash Handling ----------
function setupCrashHandler() {
  const handler = (error, type) => {
    const crashFile = TraceLogger.logCrash(error, { type });
    logger.error(`\nCRASH DETECTED: ${error.message}`);
    if (crashFile) {
      logger.info(`Crash report saved to: ${crashFile}`);
    }
    process.exit(1);
  };

  process.on('uncaughtException', (err) => handler(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    handler(err, 'unhandledRejection');
  });
}

setupCrashHandler();

// ---------- Gateway Manager ----------
const GATEWAY_PORT = 8080;
const GATEWAY_PATH = require.resolve('deepseek-web-gateway/src/server.js');
let gatewayProcess = null;

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${GATEWAY_PORT}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function waitForGateway() {
  for (let i = 0; i < 60; i++) {
    if (await healthCheck()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function startGatewayIfNeeded() {
  if (await healthCheck()) {
    return true;
  }

  if (!fs.existsSync(GATEWAY_PATH)) {
    logger.error('Gateway not found at: ' + GATEWAY_PATH);
    logger.error('Make sure deepseek-web-gateway is a sibling directory.');
    return false;
  }

  logger.info('Starting DeepSeek Gateway...');
  gatewayProcess = spawn('node', [GATEWAY_PATH], {
    cwd: path.dirname(GATEWAY_PATH),
    stdio: 'inherit',
    detached: false,
  });

  const ready = await waitForGateway();
  if (ready) {
    logger.success('Gateway is ready.');
  } else {
    logger.error('Gateway did not start in time.');
    return false;
  }
  return true;
}

function stopGateway() {
  if (gatewayProcess) {
    gatewayProcess.kill();
    gatewayProcess = null;
    logger.info('Gateway stopped.');
  }
}

// ---------- CLI Commands ----------
program
  .name('seekcode')
  .description('AI Coding Orchestrator powered by DeepSeek')
  .version('0.1.0')
  .option('--no-trace', 'Disable detailed tracing');

program.hook('preAction', (thisCommand, actionCommand) => {
  const globalOptions = program.opts();
  if (globalOptions.trace !== false) {
    process.env.SEEKCODE_TRACE = '1';
  } else {
    delete process.env.SEEKCODE_TRACE;
  }
});

program
  .command('analyze [project]')
  .description('Analyze project structure')
  .action(async (project) => {
    await analyzeCommand(project);
  });

program
  .command('plan [project] [task]')
  .description('Generate a task plan')
  .action(async (project, task) => {
    if (!task) { console.error('Task required'); process.exit(1); }
    await planCommand(project, task);
  });

program
  .command('run [project] [task]')
  .description('Execute a task (auto-starts gateway)')
  .option('--trace', 'Enable detailed tracing (ON by default)')
  .action(async (project, task, options) => {
    if (!task) { console.error('Task required'); process.exit(1); }
    
    const gatewayReady = await startGatewayIfNeeded();
    if (!gatewayReady) process.exit(1);
    try {
      await runCommand(project, task);
    } finally {
      // Keep gateway running for subsequent commands, or stop? 
    }
  });

program
  .command('benchmark <action> [project]')
  .description('Run SeekCode capability benchmarks')
  .option('--agent', 'Execute SeekCode against each benchmark before validation')
  .option('--timeout-ms <ms>', 'Per-command timeout')
  .action(async (action, project, options) => {
    if (action !== 'run') { console.error('Only "benchmark run" is supported'); process.exit(1); }
    await benchmarkCommand(project || process.cwd(), options);
  });

program
  .command('logs [session]')
  .description('View orchestration trace logs for a project')
  .option('-p, --project <dir>', 'Project directory (default: cwd)')
  .option('-s, --summary', 'Show summary only')
  .option('-l, --last', 'Show the most recent session')
  .option('--gateway', 'Show gateway-level JSONL logs instead of orchestration traces')
  .action(async (session, options) => {
    await logsCommand(session, options);
  });

// If no subcommand is provided, enter interactive mode
const args = process.argv.slice(2);
const isCommand = args.length > 0 && !args[0].startsWith('-');

if (!isCommand) {
  (async () => {
    // Manually parse options to avoid commander showing help for "missing command"
    program.parseOptions(args);
    const globalOptions = program.opts();
    
    if (globalOptions.trace !== false) {
      process.env.SEEKCODE_TRACE = '1';
    } else {
      delete process.env.SEEKCODE_TRACE;
    }

    const gatewayReady = await startGatewayIfNeeded();
    if (!gatewayReady) process.exit(1);
    await require('./interactive').interactiveMode(process.cwd()).finally(() => {
      stopGateway();
      process.exit(0);
    });
  })();
} else {
  program.parse(process.argv);
}

// Cleanup on exit
process.on('exit', () => stopGateway());
process.on('SIGINT', () => { stopGateway(); process.exit(); });
