'use strict';

class ExecutorAgent {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async execute(prompt) {
    return this.gateway.chat(prompt, 'coder', 'R1');
  }
}

module.exports = { ExecutorAgent };
