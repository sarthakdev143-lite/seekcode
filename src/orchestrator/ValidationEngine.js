'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../logger');

class ValidationEngine {
  constructor(projectDir, options = {}) {
    this.projectDir = projectDir;
    this.buildCommand = options.buildCommand || this._detectBuildCommand();
    this.testCommand = options.testCommand || this._detectTestCommand();
    this.timeoutMs = options.timeoutMs || 300_000;
    this.active = new Set();
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

    return new Promise((resolve) => {
      const child = spawn(command, {
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

    return { success: true, runs };
  }
}

module.exports = { ValidationEngine };
