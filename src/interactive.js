const { SeekCodeAgent } = require('./agent/SeekCodeAgent');
const logger = require('./logger');
const { AutoComplete } = require('enquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');

// ... marked setup ...

async function interactiveMode(projectPath) {
  const agent = new SeekCodeAgent(projectPath);

  // Banner...

  const spinner = ora('Agent initializing...').start();
  try {
    await agent.init();
    spinner.succeed('Agent ready. Project: ' + agent.analyzer.getSummary().project);
  } catch (err) {
    spinner.fail('Agent initialization failed');
    logger.error(err.message);
    process.exit(1);
  }

  // Get file list for @-completion
  const files = agent.analyzer.getDependencyGraph().getAllFiles();

  console.log(chalk.dim('\nType your task. Use @ to reference files.\n'));

  while (true) {
    const prompt = new AutoComplete({
      name: 'task',
      message: chalk.cyan('❯'),
      limit: 10,
      choices: files.map(f => ({ name: `@${f}`, message: f })),
      suggest(input, choices) {
        if (input.startsWith('@')) {
          const search = input.slice(1);
          return choices.filter(c => c.message.includes(search));
        }
        return [];
      },
      format(value) {
        return value || '';
      }
    });

    let input;
    try {
      input = await prompt.run();
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
          const absPath = path.join(projectPath, filePath);
          const content = fs.readFileSync(absPath, 'utf8');
          finalInput = finalInput.replace(match, `\nFILE: ${filePath}\n${content}\n`);
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

  await agent.shutdown();
  console.log(chalk.cyan.bold('\nGoodbye! 👋\n'));
}

module.exports = { interactiveMode };
