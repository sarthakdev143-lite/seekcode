const path = require('path');
const logger = require('../logger');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { TaskPlanner } = require('../planner/TaskPlanner');

async function planCommand(projectPath, task) {
  const absPath = path.resolve(projectPath || process.cwd());
  logger.header('SeekCode - Task Planning');
  const analyzer = new ProjectAnalyzer(absPath);
  await analyzer.analyze();
  const planner = new TaskPlanner(analyzer);
  const plan = await planner.plan(task);
  console.log(JSON.stringify(plan, null, 2));
}
module.exports = { planCommand };
