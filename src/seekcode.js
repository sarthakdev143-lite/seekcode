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
const { ProjectAnalyzer } = require('./analyzer/ProjectAnalyzer');

// ---------- Gateway Manager ----------
const GATEWAY_PORT = 8080;
const GATEWAY_PATH = path.resolve(__dirname, '..', '..', 'deepseek-web-gateway', 'src', 'server.js');
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
    logger.info('Gateway already running.');
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
  .version('0.1.0');

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
  .action(async (project, task) => {
    if (!task) { console.error('Task required'); process.exit(1); }
    const gatewayReady = await startGatewayIfNeeded();
    if (!gatewayReady) process.exit(1);
    try {
      await runCommand(project, task);
    } finally {
      // Keep gateway running for subsequent commands, or stop? 
      // For single command, we'll leave it running; user can Ctrl+C.
    }
  });

// Default: interactive mode if no arguments
if (process.argv.length === 2) {
  (async () => {
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
