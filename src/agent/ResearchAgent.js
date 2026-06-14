'use strict';

class ResearchAgent {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async research(task, step, baseContext, semanticFiles = [], options = {}) {
    const prompt = [
      'You are the Research Agent for SeekCode.',
      'Your job is to thoroughly research the codebase and gather all necessary details for the execution step.',
      'Use tools like `read_file`, `find_files`, `grep_search`, `list_directory` to explore.',
      'DO NOT make any changes to files. DO NOT write or run test scripts.',
      'Format your final output as a clear technical research summary including:',
      '- Relevant files, symbols, and current implementation details.',
      '- Precise line ranges or functions that need to be changed.',
      '- Specific files/imports/constructors to look out for.',
      '',
      'OVERALL TASK:',
      task,
      '',
      'CURRENT STEP TO IMPLEMENT:',
      step,
      '',
      'SEMANTICALLY RELATED FILES:',
      JSON.stringify(semanticFiles, null, 2),
      '',
      'PROJECT CONTEXT:',
      baseContext
    ].join('\n');

    const tab = options.tab || 'researcher';
    return this.gateway.chat(prompt, tab, 'V3');
  }
}

module.exports = { ResearchAgent };
