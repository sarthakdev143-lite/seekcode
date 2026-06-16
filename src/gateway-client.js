const fetch = require('node-fetch');
const config = require('./config');
const logger = require('./logger');

class GatewayClient {
  constructor(projectPath) {
    this.baseUrl = config.GATEWAY_URL;
    this.sessionId = null;
    this.sessionLogPath = null; // rich per-iteration log written by the gateway
    this.projectPath = projectPath || null;
    this.readOnly = false;
  }

  /** Activate read-only mode for all subsequent chat() calls */
  setReadOnly(val) { this.readOnly = Boolean(val); }

  async _fetchJson(url, options = {}, timeoutMs = config.GATEWAY_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Gateway request timed out after ${timeoutMs}ms: ${url}`);
      }
      throw new Error(`Could not reach gateway at ${this.baseUrl}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Gateway returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
      }
    }

    if (!res.ok) {
      const detail = data.error || data.message || res.statusText || text || 'unknown error';
      throw new Error(`Gateway error ${res.status}: ${detail}`);
    }

    return data;
  }

  async createSession() {
    const body = {};
    if (this.projectPath) body.workingDir = this.projectPath;
    let data;
    try {
      data = await this._fetchJson(this.baseUrl + '/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, config.GATEWAY_CREATE_TIMEOUT_MS);
    } catch (err) {
      const detail = err.message || String(err);
      if (/existing browser session|profile is already in use/i.test(detail)) {
        throw new Error(
          'Failed to create gateway session: browser profile is locked. '
          + 'Stop other SeekCode/gateway instances, close the DeepSeek browser window, '
          + 'then retry. Detail: ' + detail
        );
      }
      throw err;
    }
    if (data.sessionId) {
      this.sessionId = data.sessionId;
      // Store gateway session log path so callers can record it for debugging
      this.sessionLogPath = data.sessionLogPath || null;
      logger.success('Gateway session created: ' + this.sessionId);
      if (this.sessionLogPath) {
        logger.dim('Gateway session log: ' + this.sessionLogPath);
      }
    } else {
      const detail = data.error || 'unknown error';
      if (/existing browser session|profile is already in use/i.test(detail)) {
        throw new Error(
          'Failed to create gateway session: browser profile is locked. '
          + 'Stop other SeekCode/gateway instances, close the DeepSeek browser window, '
          + 'then retry. Detail: ' + detail
        );
      }
      throw new Error('Failed to create gateway session: ' + detail);
    }
    return data; // return full response so callers get sessionLogPath etc.
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
      const data = await this._fetchJson(this.baseUrl + '/session/' + this.sessionId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tab, model, readOnly: effectiveReadOnly })
      }, config.GATEWAY_REQUEST_TIMEOUT_MS);
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      return data.text;
    } catch (err) {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(40) + '\r');
      throw err;
    }
  }

  async closeSession() {
    if (this.sessionId) {
      try {
        await this._fetchJson(this.baseUrl + '/session/' + this.sessionId + '/close', { method: 'POST' }, 30000);
      } catch (err) {
        logger.warn('Gateway session close failed: ' + err.message);
      }
      logger.info('Gateway session closed');
      this.sessionId = null;
      this.sessionLogPath = null;
    }
  }
}

module.exports = { GatewayClient };
