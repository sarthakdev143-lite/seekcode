const { createIssue, transitionIssue, getBoard } = require('./src/issues');
const issue = createIssue('Login bug');
transitionIssue(issue.id, 'in-progress');
const board = getBoard();
if (!board['in-progress'].some(item => item.id === issue.id)) throw new Error('transition/grouping failed');
if (!Array.isArray(board.todo) || !Array.isArray(board.done)) throw new Error('missing board columns');
