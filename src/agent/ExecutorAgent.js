'use strict';

class ExecutorAgent {
  constructor(gateway) {
    this.gateway = gateway;
  }

  async execute(prompt) {
    return this.gateway.chat(prompt);
  }
}

module.exports = { ExecutorAgent };
