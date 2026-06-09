const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * TraceLogger - writes JSONL trace logs to .seekcode/traces/{sessionId}.jsonl
 * Used for debugging and analyzing seekcode's behavior
 */
class TraceLogger {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.logPath = null;
    this.writeStream = null;
    this._init();
  }

  _init() {
    try {
      // Create .seekcode/traces directory in the user's home or current working directory
      const tracesDir = path.join(process.cwd(), '.seekcode', 'traces');
      if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, { recursive: true });
      }

      this.logPath = path.join(tracesDir, `${this.sessionId}.jsonl`);
      this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' });
      
      // Log session start
      this._write({
        type: 'session_start',
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        cwd: process.cwd()
      });
    } catch (err) {
      console.error('Failed to initialize trace logger:', err);
      this.writeStream = null;
    }
  }

  _write(data) {
    if (!this.writeStream) return;
    try {
      this.writeStream.write(JSON.stringify(data) + '\n');
    } catch (err) {
      console.error('Failed to write trace log:', err);
    }
  }

  /**
   * Log a generic event
   * @param {string} eventName - Name of the event
   * @param {object} data - Event data
   */
  logEvent(eventName, data = {}) {
    this._write({
      type: 'event',
      eventName,
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  /**
   * Log an LLM turn (prompt and response)
   * @param {string} turnId - Unique identifier for this turn
   * @param {string} prompt - The prompt sent to LLM
   * @param {string} response - The response from LLM
   * @param {number} durationMs - Duration of the LLM call in milliseconds
   * @param {object} metadata - Additional metadata (handler type, etc.)
   */
  logLLMTurn(turnId, prompt, response, durationMs, metadata = {}) {
    this._write({
      type: 'llm_turn',
      turnId,
      timestamp: new Date().toISOString(),
      durationMs,
      prompt: prompt.substring(0, 10000), // Limit size
      response: response.substring(0, 10000),
      promptLength: prompt.length,
      responseLength: response.length,
      ...metadata
    });
  }

  /**
   * Log a step in the orchestration process
   * @param {string} stepId - Step identifier
   * @param {string} stepName - Name/description of the step
   * @param {string} status - 'start', 'complete', or 'error'
   * @param {number} durationMs - Duration of the step
   * @param {object} data - Additional step data
   */
  logStep(stepId, stepName, status, durationMs = null, data = {}) {
    this._write({
      type: 'step',
      stepId,
      stepName,
      status,
      timestamp: new Date().toISOString(),
      durationMs,
      ...data
    });
  }

  /**
   * Close the log file
   */
  close() {
    if (this.writeStream) {
      // Log session end
      this._write({
        type: 'session_end',
        sessionId: this.sessionId,
        timestamp: new Date().toISOString()
      });
      
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

module.exports = { TraceLogger };
