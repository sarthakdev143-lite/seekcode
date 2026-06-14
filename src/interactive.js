const { SeekCodeAgent } = require('./agent/SeekCodeAgent');
const logger = require('./logger');
const { Multiline } = require('enquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');

async function interactiveMode(projectPath) {
  // Clear the terminal for a fresh UI
  process.stdout.write('\x1Bc');

  const agent = new SeekCodeAgent(projectPath);

  // Compact Header
  console.log(chalk.cyan.bold('SeekCode') + ' | ' + chalk.white('Agentic CLI') + '\n');

  const spinner = ora('Initializing agent...').start();
  try {
    await agent.init();
    spinner.stop();
    console.log(chalk.green('✔') + ' Agent ready. Project: ' + chalk.bold(agent.analyzer.getSummary().project) + '\n');
  } catch (err) {
    spinner.fail('Agent initialization failed');
    logger.error(err.message);
    process.exit(1);
  }

  // Use Enquirer for robust multiline input
  const getTask = async () => {
    const prompt = new Multiline({
      name: 'task',
      message: chalk.cyan('❯'),
      hint: chalk.dim('Enter task (Ctrl+Enter to submit)'),
      validate(value) {
        return value.trim().length > 0 || 'Task cannot be empty.';
      }
    });

    try {
      const answer = await prompt.run();
      return answer.trim();
    } catch (err) {
      throw new Error('EOF');
    }
  };

  while (true) {
    let input;
    try {
      input = await getTask();
    } catch (err) {
      break;
    }
// ...

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

  await agent.shutdown();
  console.log(chalk.cyan.bold('\nGoodbye! 👋\n'));
}

module.exports = { interactiveMode };
