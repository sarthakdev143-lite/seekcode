const { Input } = require('enquirer');
const chalk = require('chalk');

async function test() {
  try {
    const prompt = new Input({
      name: 'task',
      message: chalk.cyan('❯'),
      hint: chalk.dim('What should I do?'),
      prefix: '',
      validate(value) {
        return value.length > 0;
      }
    });

    console.log('Testing prompt...');
    // We can't really run it interactively here easily without hanging the agent, 
    // but we can check if the constructor works.
    console.log('Prompt instance created:', prompt.constructor.name);
  } catch (err) {
    console.error('Prompt creation failed:', err);
  }
}

test();
