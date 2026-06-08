const { SeekCodeAgent } = require('./agent/SeekCodeAgent');
const logger = require('./logger');

async function interactiveMode(projectPath) {
  const agent = new SeekCodeAgent(projectPath);
  await agent.init();

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const ask = () => new Promise(resolve => rl.question('\n\x1b[96m❯ Task:\x1b[0m ', resolve));

  console.log('\nSeekCode is ready. Type your task or question.\n');

  while (true) {
    const input = (await ask()).trim();
    if (!input) continue;
    if (['exit', 'quit', 'q'].includes(input.toLowerCase())) break;

    try {
      const start = Date.now();
      const response = await agent.handle(input);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log('\n\x1b[90m(' + elapsed + 's)\x1b[0m');
    } catch (err) {
      logger.error('Error: ' + err.message);
    }
  }

  rl.close();
  await agent.shutdown();
  console.log('\nGoodbye!\n');
}

module.exports = { interactiveMode };
