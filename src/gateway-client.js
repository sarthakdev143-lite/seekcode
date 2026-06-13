const fetch = require('node-fetch');
const config = require('./config');
const logger = require('./logger');

class GatewayClient {
  constructor(projectPath) {
    this.baseUrl = config.GATEWAY_URL;
    this.sessionId = null;
    this.projectPath = projectPath || null;
    this.readOnly = false;
  }

  /** Activate read-only mode for all subsequent chat() calls */
  setReadOnly(val) { this.readOnly = Boolean(val); }

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

  async chat(prompt, tab, model, readOnly) {
    if (!this.sessionId) throw new Error('No active session. Call createSession() first.');
    // Use argument override if provided, else fall back to instance default
    const effectiveReadOnly = readOnly !== undefined ? readOnly : this.readOnly;

    const frames = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
    let i = 0;
    const interval = setInterval(() => {
      const label = tab ? `Thinking (${tab})...` : 'Thinking...';
      process.stdout.write(`\r${frames[i++ % frames.length]} ${label}`);
    }, 80);

    try {
      const res = await fetch(this.baseUrl + '/session/' + this.sessionId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tab, model, readOnly: effectiveReadOnly })
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