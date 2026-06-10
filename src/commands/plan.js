const path = require('path');
const logger = require('../logger');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { TaskPlanner } = require('../planner/TaskPlanner');

const { TraceLogger } = require('../trace-logger');

async function planCommand(projectPath, task) {
  const absPath = path.resolve(projectPath || process.cwd());
  logger.header('SeekCode - Task Planning');
  
  let traceLogger = null;
  if (process.env.SEEKCODE_TRACE === '1') {
    traceLogger = new TraceLogger(`plan_${Date.now()}`, absPath);
    traceLogger.logEvent('plan_start', { task });
  }

  const analyzer = new ProjectAnalyzer(absPath);
  await analyzer.analyze();
  const planner = new TaskPlanner(analyzer);
  const plan = await planner.plan(task);
  
  if (traceLogger) {
    traceLogger.logEvent('plan_complete', { plan });
    traceLogger.close();
  }

  console.log(JSON.stringify(plan, null, 2));
}
module.exports = { planCommand };
