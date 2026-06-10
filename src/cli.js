const { program } = require('commander');
const { analyzeCommand } = require('./commands/analyze');
const { planCommand } = require('./commands/plan');
const { runCommand } = require('./commands/run');
const { benchmarkCommand } = require('./commands/benchmark');

program
  .name('seekcode')
  .description('AI Coding Orchestrator powered by DeepSeek')
  .version('0.1.0');

program
  .command('analyze [project]')
  .description('Analyze project structure')
  .action(async (project) => {
    await analyzeCommand(project);
  });

program
  .command('plan [project] [task]')
  .description('Generate a task plan')
  .action(async (project, task) => {
    if (!task) { console.error('Error: task argument required'); process.exit(1); }
    await planCommand(project, task);
  });

program
  .command('run [project] [task]')
  .description('Execute a task using the AI orchestrator')
  .action(async (project, task) => {
    if (!task) { console.error('Error: task argument required'); process.exit(1); }
    await runCommand(project, task);
  });

program
  .command('benchmark <action> [project]')
  .description('Run SeekCode capability benchmarks')
  .option('--agent', 'Execute SeekCode against each benchmark before validation')
  .option('--timeout-ms <ms>', 'Per-command timeout')
  .action(async (action, project, options) => {
    if (action !== 'run') { console.error('Only "benchmark run" is supported'); process.exit(1); }
    await benchmarkCommand(project || process.cwd(), options);
  });

program.parse();
