const fetch = require('node-fetch');
const config = require('./config');
const logger = require('./logger');

class GatewayClient {
  constructor() { this.baseUrl = config.GATEWAY_URL; this.sessionId = null; }

  async createSession() {
    const res = await fetch(this.baseUrl + '/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.sessionId) {
      this.sessionId = data.sessionId;
      logger.success('Gateway session created: ' + this.sessionId);
    } else {
      throw new Error('Failed to create gateway session');
    }
  }

  async chat(prompt) {
    if (!this.sessionId) throw new Error('No active session. Call createSession() first.');
    const res = await fetch(this.baseUrl + '/session/' + this.sessionId + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error('Gateway error ' + res.status + ': ' + error);
    }
    const data = await res.json();
    return data.text;
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
