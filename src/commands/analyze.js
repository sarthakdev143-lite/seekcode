const path = require('path');
const logger = require('../logger');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');

const { TraceLogger } = require('../trace-logger');

async function analyzeCommand(projectPath) {
  const absPath = path.resolve(projectPath || process.cwd());
  logger.header('SeekCode - Project Analysis');
  
  let traceLogger = null;
  if (process.env.SEEKCODE_TRACE === '1') {
    traceLogger = new TraceLogger(`analyze_${Date.now()}`, absPath);
    traceLogger.logEvent('analyze_start');
  }

  logger.info('Analyzing: ' + absPath);
  const analyzer = new ProjectAnalyzer(absPath);
  await analyzer.analyze();
  const summary = analyzer.getSummary();
  
  if (traceLogger) {
    traceLogger.logEvent('analyze_complete', { summary });
    traceLogger.close();
  }

  console.log(JSON.stringify(summary, null, 2));
}
module.exports = { analyzeCommand };
