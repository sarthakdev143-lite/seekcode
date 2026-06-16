const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const { EnhancedOrchestrator } = require('../orchestrator/EnhancedOrchestrator');
const { TaskManager } = require('../orchestrator/TaskManager');
const { CheckpointManager } = require('../orchestrator/CheckpointManager');

function readTaskFromJournal(projectDir, taskId) {
  const journalFile = path.join(projectDir, '.seekcode', 'journal', `${taskId}.json`);
  if (!fs.existsSync(journalFile)) return null;

  try {
    const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    const startEntry = (journal.entries || []).find(e => e.type === 'task-start');
    return startEntry?.task || null;
  } catch {
    return null;
  }
}

function resolveTaskDescription(projectDir, taskManager) {
  if (taskManager.state.taskDescription) return taskManager.state.taskDescription;

  const fromJournal = readTaskFromJournal(projectDir, taskManager.taskId);
  if (fromJournal) return fromJournal;

  const steps = taskManager.state.steps || [];
  if (steps.length > 0) {
    return steps.map(s => s.description).join('; ');
  }

  return null;
}

async function resumeCommand(projectPath, options = {}) {
  const absPath = path.resolve(projectPath || process.cwd());
  const pendingTaskId = TaskManager.findPendingTask(absPath, process.env.SEEKCODE_TASK_ID || null);

  if (!pendingTaskId) {
    logger.error('No interrupted task found to resume.');
    process.exit(1);
  }

  const taskManager = new TaskManager(absPath, pendingTaskId);
  const task = resolveTaskDescription(absPath, taskManager);
  if (!task) {
    logger.error(`Could not determine task description for ${pendingTaskId}.`);
    process.exit(1);
  }

  logger.header('SeekCode - Resume Interrupted Task');
  logger.info(`Task ID: ${pendingTaskId}`);
  logger.info(`Description: ${task}`);

  if (options.listCheckpoints) {
    const checkpoints = new CheckpointManager(absPath, pendingTaskId);
    const list = checkpoints.listCheckpoints(pendingTaskId);
    if (list.length === 0) {
      logger.info('No workspace checkpoints found for this task.');
    } else {
      logger.info('Available checkpoints:');
      list.forEach(cp => {
        console.log(`  - ${cp.id} (${cp.reason}, ${cp.createdAt})`);
      });
    }
    return;
  }

  const orchestrator = new EnhancedOrchestrator(absPath);
  await orchestrator.init();
  const result = await orchestrator.run(task, {
    ...options,
    restoreCheckpoint: options.noRestore ? false : true,
  });

  logger.divider();
  console.log(logger.renderMarkdown(result));
  logger.divider();
}

module.exports = { resumeCommand };
