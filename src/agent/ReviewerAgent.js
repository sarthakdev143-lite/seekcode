'use strict';

class ReviewerAgent {
  constructor(gateway, semanticSearch = null) {
    this.gateway = gateway;
    this.semanticSearch = semanticSearch;
  }

  async review(task, baseContext, changedFiles = []) {
    const related = this.semanticSearch ? this.semanticSearch.search(task, 8).map(r => r.path) : [];
    const prompt = [
      'You are the Reviewer Agent for SeekCode.',
      'Review the completed implementation before task completion.',
      'Look for bugs, missing imports, dead code, race conditions, and security issues.',
      'Do not make code changes. Return JSON only: {"passed": true|false, "findings": ["..."]}.',
      '',
      'TASK:',
      task,
      '',
      'CHANGED FILES:',
      JSON.stringify(changedFiles, null, 2),
      '',
      'SEMANTICALLY RELATED FILES:',
      JSON.stringify(related, null, 2),
      '',
      'PROJECT CONTEXT:',
      baseContext
    ].join('\n');

    const response = await this.gateway.chat(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { passed: false, findings: ['Reviewer returned invalid JSON'] };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { passed: Boolean(parsed.passed), findings: Array.isArray(parsed.findings) ? parsed.findings : [] };
    } catch (err) {
      return { passed: false, findings: ['Reviewer returned malformed JSON: ' + err.message] };
    }
  }
}

module.exports = { ReviewerAgent };
