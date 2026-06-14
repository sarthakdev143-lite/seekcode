'use strict';

class ExecutorAgent {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async execute(prompt, options = {}) {
    const tab = options.tab || 'coder';
    return this.gateway.chat(prompt, tab, 'R1');
  }
}

module.exports = { ExecutorAgent };
