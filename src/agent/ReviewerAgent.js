'use strict';

class ReviewerAgent {
  constructor(gateway, semanticSearch = null) {
    this.gateway = gateway;
    this.semanticSearch = semanticSearch;
  }

  async review(task, baseContext, changedFiles = [], options = {}) {
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

    const tab = options.tab || 'reviewer';
    const response = await this.gateway.chat(prompt, tab, 'R1');
    try {
      const parsed = JSON.parse(this._extractJsonObject(response));
      return { passed: Boolean(parsed.passed), findings: Array.isArray(parsed.findings) ? parsed.findings : [] };
    } catch (err) {
      return { passed: false, findings: ['Reviewer returned malformed JSON: ' + err.message] };
    }
  }

  _extractJsonObject(text) {
    const cleaned = String(text || '')
      .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = cleaned.indexOf('{');
    if (start === -1) throw new Error('No JSON object found');
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return cleaned.slice(start, i + 1);
      }
    }
    throw new Error('Unbalanced JSON object');
  }
}

module.exports = { ReviewerAgent };
