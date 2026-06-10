const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * TraceLogger - writes JSONL trace logs to .seekcode/traces/{sessionId}.jsonl
 * Also handles global logging in ~/.seekcode/
 */
class TraceLogger {
  constructor(sessionId, projectPath = process.cwd()) {
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    this.projectLogPath = null;
    this.globalLogPath = null;
    this.projectWriteStream = null;
    this.globalWriteStream = null;
    this._init();
  }

  _init() {
    try {
      // 1. Project-specific logs
      const tracesDir = path.join(this.projectPath, '.seekcode', 'traces');
      if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, { recursive: true });
      }
      this.projectLogPath = path.join(tracesDir, `${this.sessionId}.jsonl`);
      this.projectWriteStream = fs.createWriteStream(this.projectLogPath, { flags: 'a' });

      // 2. Global logs
      const globalDir = path.join(os.homedir(), '.seekcode', 'logs');
      if (!fs.existsSync(globalDir)) {
        fs.mkdirSync(globalDir, { recursive: true });
      }
      this.globalLogPath = path.join(globalDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
      this.globalWriteStream = fs.createWriteStream(this.globalLogPath, { flags: 'a' });

      // Log session start to both
      this._write({
        type: 'session_start',
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        cwd: this.projectPath
      });
    } catch (err) {
      console.error('Failed to initialize trace logger:', err);
    }
  }

  _write(data) {
    const line = JSON.stringify(data) + '\n';
    
    if (this.projectWriteStream) {
      try {
        this.projectWriteStream.write(line);
        // Requirement: flush after every write
        if (typeof this.projectWriteStream.fd === 'number') {
          fs.fsyncSync(this.projectWriteStream.fd);
        }
      } catch (err) {
        console.error('Failed to write project trace log:', err);
      }
    }

    if (this.globalWriteStream) {
      try {
        this.globalWriteStream.write(line);
        if (typeof this.globalWriteStream.fd === 'number') {
          fs.fsyncSync(this.globalWriteStream.fd);
        }
      } catch (err) {
        console.error('Failed to write global trace log:', err);
      }
    }
  }

  /**
   * Log a generic event
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
   * Log an LLM turn
   */
  logLLMTurn(turnId, prompt, response, durationMs, metadata = {}) {
    this._write({
      type: 'llm_turn',
      turnId,
      timestamp: new Date().toISOString(),
      durationMs,
      prompt: prompt.substring(0, 10000),
      response: response.substring(0, 10000),
      promptLength: prompt.length,
      responseLength: response.length,
      ...metadata
    });
  }

  /**
   * Log a step in orchestration
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
   * Log a tool call
   */
  logToolCall(tool, args, result = null, error = null) {
    this._write({
      type: 'tool_call',
      tool,
      args,
      result: result ? (typeof result === 'string' ? result.substring(0, 1000) : result) : null,
      error,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Close the log files
   */
  close() {
    const endEvent = {
      type: 'session_end',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString()
    };
    
    this._write(endEvent);

    if (this.projectWriteStream) {
      this.projectWriteStream.end();
      this.projectWriteStream = null;
    }
    if (this.globalWriteStream) {
      this.globalWriteStream.end();
      this.globalWriteStream = null;
    }
  }

  /**
   * Static method to log crashes to ~/.seekcode/crashes/
   */
  static logCrash(error, metadata = {}) {
    try {
      const crashDir = path.join(os.homedir(), '.seekcode', 'crashes');
      if (!fs.existsSync(crashDir)) {
        fs.mkdirSync(crashDir, { recursive: true });
      }
      
      const crashFile = path.join(crashDir, `crash-${Date.now()}.json`);
      const report = {
        timestamp: new Date().toISOString(),
        error: error.message,
        stack: error.stack,
        pid: process.pid,
        ...metadata
      };
      
      fs.writeFileSync(crashFile, JSON.stringify(report, null, 2));
      return crashFile;
    } catch (err) {
      console.error('Failed to log crash:', err);
      return null;
    }
  }
}

module.exports = { TraceLogger };
