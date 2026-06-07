const path = require('path');
const config = require('./config');
const logger = require('./logger');
const { ProjectAnalyzer } = require('./analyzer/ProjectAnalyzer');

async function main() {
  const projectPath = process.argv[2] || config.WORKING_DIR;
  const absPath = path.resolve(projectPath);
  
  logger.header('SeekCode - Project Analyzer');
  logger.info('Analyzing: ' + absPath);
  
  const analyzer = new ProjectAnalyzer(absPath);
  await analyzer.analyze();
  
  const summary = analyzer.getSummary();
  logger.success('Analysis complete');
  console.log(JSON.stringify(summary, null, 2));
  
  if (process.argv.includes('--query')) {
    const file = process.argv[process.argv.indexOf('--query') + 1];
    if (file) {
      const deps = analyzer.getDependencyGraph().getDependents(file);
      console.log('\nFiles depending on "' + file + '":', deps);
    }
  }
}

main().catch(err => {
  logger.error(err.message);
  console.error(err);
  process.exit(1);
});