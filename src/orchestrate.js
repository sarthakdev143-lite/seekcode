const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { EnhancedOrchestrator } = require('./orchestrator/EnhancedOrchestrator');

async function main() {
  const projectPath = process.argv[2] || config.WORKING_DIR;
  const task = process.argv.slice(3).join(' ');
  if (!task) { logger.error('Usage: node src/orchestrate.js <project-path> <task>'); process.exit(1); }

  const absPath = path.resolve(projectPath);
  logger.header('SeekCode - Full Orchestrator');
  logger.info('Project: ' + absPath);
  logger.info('Task: ' + task);

  const orchestrator = new EnhancedOrchestrator(absPath);
  await orchestrator.init();
  console.log('\nStarting execution...\n');
  const result = await orchestrator.run(task);
  console.log('\n' + '='.repeat(60));
  logger.header('FINAL RESULT');
  console.log(result);
}

main().catch(err => { logger.error(err.message); console.error(err); process.exit(1); });
