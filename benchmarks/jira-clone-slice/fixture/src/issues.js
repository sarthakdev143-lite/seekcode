const issues = [];
function createIssue(title) {
  const issue = { id: String(issues.length + 1), title, status: 'todo' };
  issues.push(issue);
  return issue;
}
module.exports = { createIssue };
