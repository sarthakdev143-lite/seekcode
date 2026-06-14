'use strict';

const readline = require('readline');
const { SeekCodeAgent } = require('./agent/SeekCodeAgent');
const logger = require('./logger');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');

// ─── Robust multi-line input via readline ────────────────────────────────────
// enquirer's Multiline prompt requires VT100/TTY support that PowerShell often
// lacks, causing an immediate EOF throw. readline works everywhere.
//
// Usage: type your task, then press Enter twice (blank line) to submit.
// Single-line tasks: just press Enter once (auto-submits if non-empty).

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
}

async function getTask(rl) {
  return new Promise((resolve, reject) => {
    const lines = [];

    process.stdout.write(chalk.cyan('\n❯ ') + chalk.dim('Enter task (blank line to submit, "exit" to quit)\n'));
    process.stdout.write(chalk.cyan('  '));

    const onLine = (line) => {
      // Empty line = end of input (submit whatever we have)
      if (line.trim() === '') {
        if (lines.length > 0) {
          rl.removeListener('line', onLine);
          rl.removeListener('close', onClose);
          resolve(lines.join('\n').trim());
        } else {
          // Empty submit — just show the prompt again
          process.stdout.write(chalk.cyan('  '));
        }
        return;
      }
      lines.push(line);
      process.stdout.write(chalk.cyan('  '));
    };

    const onClose = () => {
      rl.removeListener('line', onLine);
      if (lines.length > 0) {
        resolve(lines.join('\n').trim());
      } else {
        reject(new Error('EOF'));
      }
    };

    rl.on('line', onLine);
    rl.once('close', onClose);
  });
}

/**
 * @param {string} projectPath
 * @param {{ setCurrentAgent?: (agent: any) => void }} [options]
 */
async function interactiveMode(projectPath, options = {}) {
  // Clear terminal for a fresh UI
  process.stdout.write('\x1Bc');

  const agent = new SeekCodeAgent(projectPath);

  // Register agent with the crash handler immediately — before init() —
  // so even an init-time crash will flush partial logs.
  if (typeof options.setCurrentAgent === 'function') {
    options.setCurrentAgent(agent);
  }

  // Header
  console.log(chalk.cyan.bold('SeekCode') + ' | ' + chalk.white('Agentic CLI') + '\n');

  const spinner = ora('Initializing agent...').start();
  try {
    await agent.init();
    spinner.stop();
    console.log(
      chalk.green('✔') + ' Agent ready. Project: ' +
      chalk.bold(agent.analyzer.getSummary().project) + '\n'
    );
  } catch (err) {
    spinner.fail('Agent initialization failed');
    logger.error(err.message);
    process.exit(1);
  }

  // ── Print log file locations so they are always discoverable ──────────────
  if (agent.traceLogger) {
    console.log(chalk.dim('  📝 Seekcode trace  : ') + chalk.cyan(agent.traceLogger.projectLogPath));
  }
  if (agent.gateway.sessionLogPath) {
    console.log(chalk.dim('  📋 Gateway log     : ') + chalk.cyan(agent.gateway.sessionLogPath));
    console.log(chalk.dim('     (full per-iteration tool call & LLM logs are here)'));
  }
  console.log('');

  console.log(chalk.dim('  Commands: type your task and press Enter (or Enter twice for multi-line)'));
  console.log(chalk.dim('  Type "exit" or "quit" to leave.\n'));

  const rl = createReadlineInterface();

  while (true) {
    let input;
    try {
      input = await getTask(rl);
    } catch (err) {
      // EOF / Ctrl-D / stdin closed
      break;
    }

    if (!input) continue;
    if (['exit', 'quit', 'q'].includes(input.toLowerCase())) break;

    // ── @file injection ─────────────────────────────────────────────────────
    let finalInput = input;
    const matches = input.match(/@([\w/.\-\\]+)/g);
    if (matches) {
      for (const match of matches) {
        const filePath = match.slice(1);
        try {
          const absPath = path.resolve(projectPath, filePath);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf8');
            finalInput = finalInput.replace(
              match,
              `\n--- FILE: ${filePath} ---\n${content}\n------------------------\n`
            );
          } else {
            logger.warn(`File not found: ${filePath}`);
          }
        } catch (e) {
          logger.warn(`Could not read file for context: ${filePath}`);
        }
      }
    }

    logger.topic('Handling Task', input);

    const stepSpinner = ora('Processing...').start();
    const startTime = Date.now();

    try {
      const response = await agent.handle(finalInput);
      stepSpinner.stop();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(logger.renderMarkdown(response));
      console.log(chalk.dim(`\n--- Completed in ${elapsed}s ---\n`));
    } catch (err) {
      stepSpinner.fail('Task failed');
      logger.error(err.message);
      // Don't exit — let the user retry or type something else
    }
  }

  rl.close();
  await agent.shutdown();
  console.log(chalk.cyan.bold('\nGoodbye! 👋\n'));
}

module.exports = { interactiveMode };
