'use strict';
// src/orchestrator/ProcessManager.js
// Manages background server processes during a SeekCode session.
// The agent can start a server, let seekcode health-check it, and stop it.
// This is critical for runtime validation: "does `nest start` actually work?"

const { spawn }    = require('child_process');
const http         = require('http');
const path         = require('path');
const logger       = require('../logger');
const { sanitizeCommand } = require('../utils/platformCommands');

class ProcessManager {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.processes   = new Map(); // name → { proc, port, startedAt }
  }

  /**
   * Start a background server process.
   * @param {string} name    A label for this process (e.g. 'api', 'frontend')
   * @param {string} command Shell command to run (e.g. 'npm run dev')
   * @param {object} opts
   * @param {string} [opts.cwd]      Working directory (default: projectPath)
   * @param {number} [opts.port]     Port to health-check
   * @param {number} [opts.readyMs]  How long to wait for the server to be ready (default: 30s)
   * @returns {Promise<{started: boolean, pid?: number, error?: string}>}
   */
  async start(name, command, { cwd, port, readyMs = 30_000, env = {} } = {}) {
    if (this.processes.has(name)) {
      logger.warn(`ProcessManager: '${name}' is already running. Stopping first.`);
      await this.stop(name);
    }

    const safeCmd = sanitizeCommand(command);
    const workDir = cwd ? path.resolve(cwd) : this.projectPath;

    logger.info(`ProcessManager: Starting '${name}': ${safeCmd}`);

    const proc = spawn(safeCmd, {
      cwd: workDir,
      shell: true,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    });

    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout?.on('data', chunk => {
      stdoutBuf += chunk.toString();
      // Trim buffer to last 4KB
      if (stdoutBuf.length > 4096) stdoutBuf = stdoutBuf.slice(-4096);
    });

    proc.stderr?.on('data', chunk => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
    });

    proc.on('error', err => {
      logger.error(`ProcessManager: '${name}' process error: ${err.message}`);
    });

    this.processes.set(name, { proc, port, startedAt: Date.now(), command: safeCmd, workDir, getOutput: () => ({ stdout: stdoutBuf, stderr: stderrBuf }) });

    // If a port is given, wait for it to be ready
    if (port) {
      const ready = await this._waitForPort(port, readyMs);
      if (!ready) {
        const entry = this.processes.get(name);
        const output = entry?.getOutput() || {};
        const errDetail = output.stderr?.slice(-500) || output.stdout?.slice(-500) || 'no output';
        logger.warn(`ProcessManager: '${name}' did not become ready on port ${port} within ${readyMs}ms`);
        logger.warn(`Server output:\n${errDetail}`);
        return { started: false, error: `Server not ready on port ${port}. Output: ${errDetail}` };
      }
      logger.success(`ProcessManager: '${name}' is ready on port ${port}`);
    } else {
      // Just wait 2s for a quick sanity
      await new Promise(r => setTimeout(r, 2000));
      if (proc.exitCode !== null && proc.exitCode !== 0) {
        const entry = this.processes.get(name);
        const output = entry?.getOutput() || {};
        return { started: false, error: `Process exited immediately with code ${proc.exitCode}. stderr: ${output.stderr?.slice(-400)}` };
      }
    }

    return { started: true, pid: proc.pid };
  }

  /**
   * Stop a named background process.
   */
  async stop(name) {
    const entry = this.processes.get(name);
    if (!entry) return;
    try {
      entry.proc.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 1000));
      if (!entry.proc.killed) entry.proc.kill('SIGKILL');
    } catch {}
    this.processes.delete(name);
    logger.info(`ProcessManager: Stopped '${name}'`);
  }

  /**
   * Stop all managed processes.
   */
  async stopAll() {
    const names = [...this.processes.keys()];
    for (const name of names) await this.stop(name);
  }

  /**
   * Get recent output from a process.
   */
  getOutput(name) {
    return this.processes.get(name)?.getOutput?.() || null;
  }

  /**
   * Check if a process is still running.
   */
  isRunning(name) {
    const entry = this.processes.get(name);
    if (!entry) return false;
    return entry.proc.exitCode === null && !entry.proc.killed;
  }

  /**
   * HTTP health check against a port (pure Node.js, no curl).
   * @param {number} port
   * @param {string} [healthPath='/']
   * @param {number} [timeoutMs=3000]
   * @returns {Promise<{ok: boolean, status?: number, body?: string, error?: string}>}
   */
  static async httpCheck(port, healthPath = '/', timeoutMs = 3000) {
    return new Promise(resolve => {
      const req = http.get({
        hostname: 'localhost',
        port,
        path: healthPath,
        timeout: timeoutMs,
      }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          resolve({ ok: res.statusCode < 500, status: res.statusCode, body: body.slice(0, 500) });
        });
      });
      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: `Timed out after ${timeoutMs}ms` }); });
    });
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Poll a port until it responds or timeout.
   */
  async _waitForPort(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const interval = 500;
    while (Date.now() < deadline) {
      const result = await ProcessManager.httpCheck(port, '/', 2000);
      if (result.ok) return true;
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }
}

module.exports = { ProcessManager };
