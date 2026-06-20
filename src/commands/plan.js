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

  // Render plan as Markdown
  let md = `## Execution Plan for: ${task}\n\n`;
  if (plan.quickAnswer) {
    md += `**Type:** Quick Answer (No changes needed)\n`;
  } else {
    md += `### Steps:\n`;
    plan.steps.forEach((step, i) => {
      md += `${i + 1}. ${step}\n`;
    });
  }
  
  logger.divider();
  console.log(logger.renderMarkdown(md));
  logger.divider();
}
module.exports = { planCommand };
