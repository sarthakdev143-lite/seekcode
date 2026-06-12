const fetch = require('node-fetch');
const config = require('./config');
const logger = require('./logger');

class GatewayClient {
  constructor(projectPath) {
    this.baseUrl = config.GATEWAY_URL;
    this.sessionId = null;
    this.projectPath = projectPath || null;
  }

  async createSession() {
    const body = {};
    if (this.projectPath) body.workingDir = this.projectPath;
    const res = await fetch(this.baseUrl + '/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.sessionId) {
      this.sessionId = data.sessionId;
      logger.success('Gateway session created: ' + this.sessionId);
    } else {
      throw new Error('Failed to create gateway session');
    }
  }

  async chat(prompt, tab, model) {
    if (!this.sessionId) throw new Error('No active session. Call createSession() first.');

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const interval = setInterval(() => {
      const label = tab ? `Thinking (${tab})...` : 'Thinking...';
      process.stdout.write(`\r${frames[i++ % frames.length]} ${label}`);
    }, 80);

    try {
      const res = await fetch(this.baseUrl + '/session/' + this.sessionId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tab, model })
      });
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      if (!res.ok) {
        const error = await res.text();
        throw new Error('Gateway error ' + res.status + ': ' + error);
      }
      const data = await res.json();
      return data.text;
    } catch (err) {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      throw err;
    }
  }

  async closeSession() {
    if (this.sessionId) {
      await fetch(this.baseUrl + '/session/' + this.sessionId + '/close', { method: 'POST' });
      logger.info('Gateway session closed');
      this.sessionId = null;
    }
  }
}

module.exports = { GatewayClient };