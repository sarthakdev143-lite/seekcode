const { SeekCodeAgent } = require('./agent/SeekCodeAgent');
const logger = require('./logger');
const readline = require('readline');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');

async function interactiveMode(projectPath) {
  const agent = new SeekCodeAgent(projectPath);
  
  // Banner
  console.log('\n' + chalk.cyan.bold(' ╔════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold(' ║') + chalk.white.bold('           SeekCode Agentic CLI           ') + chalk.cyan.bold('║'));
  console.log(chalk.cyan.bold(' ╚════════════════════════════════════════════╝'));
  
  const spinner = ora('Agent initializing...').start();
  try {
    await agent.init();
    spinner.succeed('Agent ready. Project: ' + agent.analyzer.getSummary().project);
  } catch (err) {
    spinner.fail('Agent initialization failed');
    logger.error(err.message);
    process.exit(1);
  }

  // Get file list for tab-completion
  const files = agent.analyzer.getDependencyGraph().getAllFiles();

  // Tab completion function
  function completer(line) {
    const hits = files.filter(f => f.startsWith(line.split('@').pop()));
    return [hits.map(h => '@' + h), line];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: completer,
    terminal: true
  });

  const getTask = () => new Promise((resolve, reject) => {
    let input = '';
    console.log(chalk.cyan('\n❯ ') + chalk.dim('Enter task (blank line or Ctrl+D to submit):'));

    const cleanup = () => {
      rl.removeListener('line', onLine);
      rl.removeListener('close', onClose);
    };

    const onLine = (line) => {
      if (line.trim() === '') {
        cleanup();
        // If nothing typed yet, keep waiting
        if (!input) {
          console.log(chalk.cyan('\n❯ ') + chalk.dim('Enter task (blank line or Ctrl+D to submit):'));
          rl.on('line', onLine);
          rl.once('close', onClose);
          return;
        }
        resolve(input.trim());
      } else {
        input += (input ? '\n' : '') + line;
      }
    };

    const onClose = () => {
      cleanup();
      // Ctrl+D — submit whatever we have, or break the loop
      if (input.trim()) {
        resolve(input.trim());
      } else {
        reject(new Error('EOF'));
      }
    };

    rl.on('line', onLine);
    rl.once('close', onClose);
  });

  console.log(chalk.dim('\nType your task. Use @ to reference files (press Tab to autocomplete).\n'));

  while (true) {
    let input;
    try {
      input = await getTask();
    } catch (err) {
      break; 
    }

    if (!input) continue;
    if (['exit', 'quit', 'q'].includes(input.toLowerCase())) break;

    // Inject file content if referenced
    let finalInput = input;
    const matches = input.match(/@([\w/.-]+)/g);
    if (matches) {
      for (const match of matches) {
        const filePath = match.slice(1);
        try {
          const absPath = path.resolve(projectPath, filePath);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf8');
            finalInput = finalInput.replace(match, `\n--- FILE: ${filePath} ---\n${content}\n------------------------\n`);
          } else {
            logger.warn(`File not found: ${filePath}`);
          }
        } catch (e) {
          logger.warn(`Could not read file for context: ${filePath}`);
        }
      }
    }

    logger.topic('Handling Task', input);

    const stepSpinner = ora('Thinking...').start();
    const startTime = Date.now();

    try {
      const response = await agent.handle(finalInput);
      stepSpinner.stop();
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      logger.divider();
      console.log(logger.renderMarkdown(response));
      logger.divider();
      console.log(chalk.dim(`Completed in ${elapsed}s\n`));
      
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
