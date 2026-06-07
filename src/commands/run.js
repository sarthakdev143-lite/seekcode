const path = require('path');
const logger = require('../logger');
const { EnhancedOrchestrator } = require('../orchestrator/EnhancedOrchestrator');

async function runCommand(projectPath, task) {
  const absPath = path.resolve(projectPath || process.cwd());
  logger.header('SeekCode - Task Execution');
  const orchestrator = new EnhancedOrchestrator(absPath);
  await orchestrator.init();
  const result = await orchestrator.run(task);
  console.log(result);
}
module.exports = { runCommand };
