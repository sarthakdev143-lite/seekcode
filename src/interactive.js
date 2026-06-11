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
    completer: completer
  });

  const ask = () => new Promise(resolve => {
    rl.question(chalk.cyan('\n❯ ') + chalk.dim('Task: '), resolve);
  });

  console.log(chalk.dim('\nType your task. Use @ to reference files (press Tab to autocomplete).\n'));

  while (true) {
    let input;
    try {
      input = await ask();
    } catch (err) {
      break; 
    }

    input = input.trim();
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
