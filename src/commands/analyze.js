const path = require('path');
const logger = require('../logger');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');

async function analyzeCommand(projectPath) {
  const absPath = path.resolve(projectPath || process.cwd());
  logger.header('SeekCode - Project Analysis');
  logger.info('Analyzing: ' + absPath);
  const analyzer = new ProjectAnalyzer(absPath);
  await analyzer.analyze();
  const summary = analyzer.getSummary();
  console.log(JSON.stringify(summary, null, 2));
}
module.exports = { analyzeCommand };
