'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const { sanitizeCommand } = require('../utils/platformCommands');
const { ProcessManager } = require('./ProcessManager');

class ValidationEngine {
  constructor(projectDir, options = {}) {
    this.projectDir = projectDir;
    this.buildCommand = options.buildCommand || this._detectBuildCommand();
    this.testCommand = options.testCommand || this._detectTestCommand();
    this.startCommand = options.startCommand || this._detectStartCommand();
    this.timeoutMs = options.timeoutMs || 300_000;
    this.active = new Set();
  }

  _detectStartCommand() {
    const pkg = this._readPackage();
    if (pkg?.scripts?.start) return 'npm start';
    if (pkg?.scripts?.dev) return 'npm run dev';
    return null;
  }

  _detectBuildCommand() {
    const pkg = this._readPackage();
    if (pkg?.scripts?.build) return 'npm run build';
    if (pkg?.scripts?.compile) return 'npm run compile';
    if (fs.existsSync(path.join(this.projectDir, 'tsconfig.json'))) return 'npx tsc';
    return null;
  }

  _detectTestCommand() {
    const pkg = this._readPackage();
    if (pkg?.scripts?.test) return 'npm test';
    if (pkg?.scripts?.['test:unit']) return 'npm run test:unit';
    if (fs.existsSync(path.join(this.projectDir, 'node_modules', '.bin', 'jest'))) {
      return 'npx jest --passWithNoTests';
    }
    return null;
  }

  _readPackage() {
    try {
      const pkgPath = path.join(this.projectDir, 'package.json');
      if (fs.existsSync(pkgPath)) return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {}
    return null;
  }

  cancelAll(signal = 'SIGTERM') {
    for (const child of this.active) child.kill(signal);
  }

  runCommand(command, options = {}) {
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const controller = options.controller;
    const quiet = Boolean(options.quiet);
    // Fix Windows-incompatible commands (e.g. `timeout /t 5 >nul`)
    const safeCommand = sanitizeCommand(command);

    return new Promise((resolve) => {
      const child = spawn(safeCommand, {
        cwd: this.projectDir,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.active.add(child);
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 2000).unref?.();
      }, timeoutMs);

      if (controller?.signal) {
        if (controller.signal.aborted) child.kill('SIGTERM');
        controller.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      }

      child.stdout.on('data', chunk => {
        const text = chunk.toString();
        stdout += text;
        if (!quiet) process.stdout.write(text);
      });

      child.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        if (!quiet) process.stderr.write(text);
      });

      child.on('error', err => {
        clearTimeout(timer);
        this.active.delete(child);
        resolve({
          success: false,
          command,
          output: `${stdout}\n${stderr}`.trim(),
          error: err.message,
          exitCode: null,
          timedOut
        });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        this.active.delete(child);
        const output = `${stdout}\n${stderr}`.trim();
        resolve({
          success: code === 0 && !timedOut,
          command,
          output,
          exitCode: code,
          signal,
          timedOut,
          error: code === 0 && !timedOut ? null : this._parseError(output)
        });
      });
    });
  }

  async runBuild(options = {}) {
    if (!this.buildCommand) return { success: true, skipped: true, phase: 'build', message: 'No build command detected' };
    logger.info('Validating build: ' + this.buildCommand);
    return { phase: 'build', ...(await this.runCommand(this.buildCommand, options)) };
  }

  async runTests(options = {}) {
    if (!this.testCommand) return { success: true, skipped: true, phase: 'test', message: 'No test command detected' };
    logger.info('Validating tests: ' + this.testCommand);
    return { phase: 'test', ...(await this.runCommand(this.testCommand, options)) };
  }

  _parseError(output) {
    const lines = output.split('\n');
    const relevant = lines.filter(line =>
      line.includes('Error:') ||
      line.includes('ERR!') ||
      (line.includes('TS') && line.includes(': error')) ||
      line.toLowerCase().includes('cannot find module')
    );
    return (relevant.length ? relevant.slice(0, 5).join('\n') : output.substring(0, 1000)).trim();
  }

  async validate(options = {}) {
    const runs = [];
    const buildResult = await this.runBuild(options);
    runs.push(buildResult);
    if (!buildResult.success) {
      return { success: false, phase: 'build', output: buildResult.output, error: buildResult.error, runs };
    }

    const testResult = await this.runTests(options);
    runs.push(testResult);
    if (!testResult.success) {
      return { success: false, phase: 'test', output: testResult.output, error: testResult.error, runs };
    }

    // Run runtime validation if port is specified
    const port = options.port;
    const startCmd = options.startCommand || this.startCommand;
    if (port && startCmd) {
      const runtimeResult = await this.validateRuntime(startCmd, {
        port,
        healthPath: options.healthPath || '/',
        readyMs: options.readyMs || 30000,
        cwd: options.cwd,
      });
      runs.push(runtimeResult);
      if (!runtimeResult.success) {
        return { success: false, phase: 'runtime', output: runtimeResult.output, error: runtimeResult.error, runs };
      }
    }

    return { success: true, runs };
  }

  /**
   * Runtime validation — start a server and verify it responds on the given port.
   * This catches errors that build/test miss (e.g. missing .env, fabric not installed,
   * wrong port config, startup crash after compilation succeeds).
   *
   * @param {string} startCommand  Command to start the server (e.g. 'npm run dev')
   * @param {object} opts
   * @param {number}  opts.port          Port to health-check (required)
   * @param {string}  [opts.healthPath='/'] HTTP path to check
   * @param {number}  [opts.readyMs=30000]  How long to wait for the server (ms)
   * @param {string}  [opts.cwd]           Working directory (default: projectDir)
   * @param {string}  [opts.name='runtime-check'] Process name label
   * @returns {Promise<{success: boolean, phase: string, output?: string, error?: string, status?: number}>}
   */
  async validateRuntime(startCommand, opts = {}) {
    const { port, healthPath = '/', readyMs = 30_000, cwd, name = 'runtime-check' } = opts;
    if (!port) {
      return { success: false, phase: 'runtime', error: 'validateRuntime requires a port number' };
    }

    logger.info(`Runtime validation: starting '${startCommand}' on port ${port}...`);
    const pm = new ProcessManager(cwd || this.projectDir);

    try {
      const startResult = await pm.start(name, startCommand, {
        cwd: cwd || this.projectDir,
        port,
        readyMs,
      });

      if (!startResult.started) {
        return {
          success: false,
          phase: 'runtime',
          error: startResult.error || 'Server failed to start',
          output: pm.getOutput(name)?.stderr || '',
        };
      }

      // Do a more thorough HTTP check at the health path
      const check = await ProcessManager.httpCheck(port, healthPath, 5000);
      const output = pm.getOutput(name);

      if (check.ok) {
        logger.success(`Runtime validation passed: HTTP ${check.status} at localhost:${port}${healthPath}`);
        return { success: true, phase: 'runtime', status: check.status };
      } else {
        const errDetail = check.error || `HTTP ${check.status} — server responded but with error`;
        logger.warn(`Runtime validation failed: ${errDetail}`);
        return {
          success: false,
          phase: 'runtime',
          error: errDetail,
          output: (output?.stdout || '') + '\n' + (output?.stderr || ''),
        };
      }
    } finally {
      // Always stop the test server
      await pm.stop(name).catch(() => {});
    }
  }
}

module.exports = { ValidationEngine };
