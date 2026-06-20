const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { ProjectAnalyzer } = require('./analyzer/ProjectAnalyzer');
const { TaskPlanner } = require('./planner/TaskPlanner');

async function main() {
  const projectPath = process.argv[2] || config.WORKING_DIR;
  const task = process.argv.slice(3).join(' ');
  if (!task) {
    logger.error('Usage: node src/plan.js <project-path> <task description>');
    process.exit(1);
  }

  const absPath = path.resolve(projectPath);
  logger.header('SeekCode - Task Planner');
  logger.info('Project: ' + absPath);
  
  const analyzer = new ProjectAnalyzer(absPath);
  await analyzer.analyze();

  const planner = new TaskPlanner(analyzer);
  const plan = planner.plan(task);

  logger.success('Plan generated');
  console.log('\n' + JSON.stringify(plan, null, 2));
}

main().catch(err => {
  logger.error(err.message);
  console.error(err);
  process.exit(1);
});
