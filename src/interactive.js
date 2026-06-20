'use strict';

const readline = require('readline');
const { SeekCodeAgent } = require('./agent/SeekCodeAgent');
const { collectUserInput, expandFileReferences, printInputHelp } = require('./interactive-input');
const logger = require('./logger');
const chalk = require('chalk');
const ora = require('ora');
const pkg = require('../package.json');

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
    historySize: 200,
  });
}

function renderBox(lines, color = chalk.cyan, pad = 1) {
  const maxLen = Math.max(...lines.map(l => l.length));
  const width = maxLen + pad * 2 + 2;
  const border = color('─'.repeat(width - 2));
  const top = color('┌' + border + '┐');
  const bottom = color('└' + border + '┘');
  const content = lines.map(line => {
    const space = ' '.repeat(width - 2 - pad * 2 - line.length);
    return color('│' + ' '.repeat(pad) + line + space + ' '.repeat(pad) + '│');
  });
  return [top, ...content, bottom].join('\n');
}

/**
 * @param {string} projectPath
 * @param {{ setCurrentAgent?: (agent: any) => void }} [options]
 */
async function interactiveMode(projectPath, options = {}) {
  process.stdout.write('\x1Bc');

  const agent = new SeekCodeAgent(projectPath);

  if (typeof options.setCurrentAgent === 'function') {
    options.setCurrentAgent(agent);
  }

  // Welcome box
  const welcomeLines = [
    chalk.bold('SeekCode v' + pkg.version),
    chalk.dim('Agentic AI Coding Assistant'),
    chalk.dim('Project: ' + chalk.white(projectPath)),
  ];
  console.log(renderBox(welcomeLines, chalk.cyan) + '\n');

  const spinner = ora('Initializing agent...').start();
  try {
    await agent.init();
    spinner.stop();
    console.log(
      chalk.green('✔') + ' Agent ready. ' + chalk.bold(agent.analyzer.getSummary().project) + '\n'
    );
  } catch (err) {
    spinner.fail('Agent initialization failed');
    logger.error(err.message);
    process.exit(1);
  }

  if (agent.traceLogger) {
    console.log(chalk.dim('  📝 Seekcode trace  : ') + chalk.cyan(agent.traceLogger.projectLogPath));
  }
  if (agent.gateway.sessionLogPath) {
    console.log(chalk.dim('  📋 Gateway log     : ') + chalk.cyan(agent.gateway.sessionLogPath));
    console.log(chalk.dim('     (full per-iteration tool call & LLM logs are here)'));
  }
  console.log('');

  // Help box
  console.log(chalk.dim('  ' + '─'.repeat(50)));
  printInputHelp();
  console.log(chalk.dim('  ' + '─'.repeat(50)) + '\n');

  const rl = createReadlineInterface();

  while (true) {
    let rawInput;
    try {
      rawInput = await collectUserInput(rl, projectPath);
    } catch (err) {
      if (err.message === 'Input cancelled' || err.message === 'Cancelled') {
        continue;
      }
      logger.warn(err.message);
      continue;
    }

    if (!rawInput) continue;
    if (typeof rawInput === 'object' && rawInput.__exit) break;

    const finalInput = expandFileReferences(rawInput, projectPath);
    const preview = rawInput.split('\n')[0].slice(0, 120);
    logger.topic('Handling Task', preview + (rawInput.length > preview.length ? '…' : ''));

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
    }
  }

  rl.close();
  await agent.shutdown();
  console.log(chalk.cyan.bold('\nGoodbye! 👋\n'));
}

module.exports = { interactiveMode };
