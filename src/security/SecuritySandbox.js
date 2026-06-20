// seekcode/src/security/SecuritySandbox.js
// Docker-based command isolation & file access control
'use strict';

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../logger');

const DEFAULT_POLICY = {
  allowRead: ['*'],
  allowWrite: ['*'],
  blockPaths: [],
  allowNetwork: false,
  allowLocalhost: true,
  maxCpuTime: 60,
  maxMemory: '512m',
  maxProcesses: 100,
  forbiddenCommands: [
    'rm -rf /',
    'rm -rf /*',
    '> /dev/sda',
    'dd if=/dev/zero of=/dev/sda',
    ':(){ :|:& };:',
    'chmod -R 777 /',
  ],
  approvalRequired: {
    delete: true,
    writeOutsideProject: true,
    network: true,
    shell: true,
    install: true,
  },
};

class CommandRiskAnalyzer {
  constructor(policy = DEFAULT_POLICY) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  analyze(command) {
    const lower = command.toLowerCase().trim();
    
    // Prevent agent suicide commands (terminating node.exe / node globally)
    const suicidePatterns = [
      /taskkill.*\bnode(\.exe)?\b/i,
      /\b(killall|pkill|pkill\.exe|kill)\b.*\bnode(\.exe)?\b/i,
    ];
    if (suicidePatterns.some(regex => regex.test(command))) {
      return {
        level: 'critical',
        reason: 'Suicide Command: Attempt to kill Node.js processes globally. This would terminate the SeekCode agent and gateway.',
        requiresApproval: true
      };
    }

    for (const pattern of this.policy.forbiddenCommands) {
      if (lower.includes(pattern.toLowerCase())) {
        return { level: 'critical', reason: `Forbidden pattern: "${pattern}"`, requiresApproval: true };
      }
    }
    if (/rm\s+-rf?\s+\//.test(lower) || /rm\s+-rf?\s+\*\//.test(lower)) {
      return { level: 'critical', reason: 'System-wide deletion', requiresApproval: true };
    }
    if (/^rm\s+/.test(lower) || /^del\s+/.test(lower) || /^rmdir\s+/.test(lower)) {
      const target = command.slice(command.indexOf(' ') + 1).trim();
      const cwd = this.policy.workDir || process.cwd();
      const resolved = path.isAbsolute(target) ? target : path.resolve(cwd, target);
      if (!resolved.startsWith(cwd)) {
        return { level: 'high', reason: `Deleting outside project: ${resolved}`, requiresApproval: this.policy.approvalRequired.delete };
      }
      return { level: 'medium', reason: 'File deletion', requiresApproval: this.policy.approvalRequired.delete };
    }
    if (!this.policy.allowNetwork) {
      const netCmds = ['curl', 'wget', 'fetch', 'nc ', 'netcat', 'ssh', 'scp'];
      if (netCmds.some(cmd => lower.startsWith(cmd))) {
        return { level: 'high', reason: 'Network command but network disabled', requiresApproval: true };
      }
    }
    const installCmds = ['npm install', 'npm i ', 'yarn add', 'pip install', 'pip3 install', 'gem install', 'cargo add'];
    if (installCmds.some(cmd => lower.includes(cmd))) {
      return { level: 'medium', reason: 'Package installation', requiresApproval: this.policy.approvalRequired.install };
    }
    if (/git\s+push/.test(lower) && (/--force/.test(lower) || /-f/.test(lower))) {
      return { level: 'medium', reason: 'Force git push', requiresApproval: true };
    }
    const safePatterns = [
      /^ls\s/, /^dir\s/, /^cat\s/, /^type\s/, /^echo\s/,
      /^git\s+status/, /^git\s+log/, /^git\s+diff/, /^git\s+branch/,
      /^node\s+.*\.js$/, /^npm\s+run\s+test/, /^npm\s+run\s+build/,
      /^python\s+.*\.py$/, /^pytest/, /^jest/,
    ];
    if (safePatterns.some(p => p.test(lower))) {
      return { level: 'safe', reason: 'Common safe command', requiresApproval: false };
    }
    return { level: 'low', reason: 'Unrecognized command — review', requiresApproval: this.policy.approvalRequired.shell };
  }

  checkFileAccess(filePath, operation = 'read') {
    const cwd = this.policy.workDir || process.cwd();
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    for (const blocked of this.policy.blockPaths) {
      if (resolved.startsWith(path.isAbsolute(blocked) ? blocked : path.resolve(cwd, blocked))) {
        return { allowed: false, reason: `Path blocked: ${blocked}` };
      }
    }
    if (operation === 'write' && !resolved.startsWith(cwd)) {
      return { allowed: !this.policy.approvalRequired.writeOutsideProject, reason: `Writing outside project: ${resolved}`, requiresApproval: this.policy.approvalRequired.writeOutsideProject };
    }
    return { allowed: true };
  }
}

class DockerSandbox {
  constructor(options = {}) {
    this.image = options.image || 'node:20-alpine';
    this.workDir = options.workDir || process.cwd();
    this.memory = options.memory || '512m';
    this.cpuQuota = options.cpuQuota || 100000;
    this.timeout = options.timeout || 60000;
    this.network = options.network || 'none';
    this.containerName = `seekcode-${crypto.randomBytes(4).toString('hex')}`;
    this._dockerAvailable = null;
  }

  async _checkDocker() {
    if (this._dockerAvailable !== null) return this._dockerAvailable;
    try {
      execSync('docker --version', { stdio: 'pipe' });
      this._dockerAvailable = true;
    } catch {
      this._dockerAvailable = false;
    }
    return this._dockerAvailable;
  }

  async run(command, options = {}) {
    const hasDocker = await this._checkDocker();
    if (!hasDocker) {
      logger.warn('Docker not available — running on host (unsandboxed)');
      return this._runOnHost(command, options);
    }
    return this._runInDocker(command, options);
  }

  async _runInDocker(command, options = {}) {
    const { cwd = this.workDir, env = {}, timeout = this.timeout } = options;
    const args = [
      'run', '--rm', '--name', this.containerName,
      '--memory', this.memory, '--memory-swap', this.memory,
      '--cpu-quota', String(this.cpuQuota),
      '--pids-limit', '100',
      '--network', this.network,
      '-v', `${cwd}:/workspace`, '-w', '/workspace',
      '-e', 'NODE_ENV=development',
      ...Object.entries(env).flatMap(([k,v]) => ['-e', `${k}=${v}`]),
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--user', '1000:1000',
      this.image, 'sh', '-c', command
    ];
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      let killed = false;
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 2000);
      }, timeout);
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', code => {
        clearTimeout(timer);
        if (killed) reject(new Error(`Command timed out after ${timeout}ms`));
        else resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, sandboxed: true });
      });
    });
  }

  async _runOnHost(command, options = {}) {
    const { cwd = this.workDir, env = {}, timeout = this.timeout } = options;
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '';
      let killed = false;
      const child = process.platform === 'win32'
        ? spawn(command, [], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], shell: true })
        : spawn('sh', ['-c', command], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { killed = true; child.kill('SIGTERM'); }, timeout);
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', code => {
        clearTimeout(timer);
        if (killed) reject(new Error(`Command timed out after ${timeout}ms`));
        else resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, sandboxed: false });
      });
    });
  }

  async cleanup() {
    try { execSync(`docker rm -f ${this.containerName} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
  }
}

class ApprovalManager {
  constructor(policy = DEFAULT_POLICY) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.approvalCache = new Map();
    this.autoApproveSafe = true;
  }

  async requestApproval(riskAssessment, details = {}) {
    const { level, reason } = riskAssessment;
    if (level === 'safe' && this.autoApproveSafe) return { approved: true, auto: true };
    const hash = crypto.createHash('sha256').update(details.command || reason).digest('hex');
    if (this.approvalCache.has(hash)) return { approved: this.approvalCache.get(hash), cached: true };
    if (!process.stdin.isTTY || process.env.CI) {
      if (level === 'critical' || level === 'high') {
        return { approved: false, reason: 'Non‑interactive: high‑risk requires manual approval' };
      }
      logger.warn(`Auto‑approved ${level} risk: ${reason}`);
      return { approved: true, auto: true, warning: reason };
    }
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question(
      `\n⚠️  ${level.toUpperCase()} RISK: ${reason}\nCommand: ${details.command || 'N/A'}\nAllow? (y/n/always/never): `, resolve));
    rl.close();
    const lower = answer.trim().toLowerCase();
    if (lower === 'y' || lower === 'yes') return { approved: true, interactive: true };
    if (lower === 'always') { this.approvalCache.set(hash, true); return { approved: true, interactive: true }; }
    if (lower === 'never') { this.approvalCache.set(hash, false); return { approved: false, interactive: true }; }
    return { approved: false, interactive: true };
  }
}

class SecuritySandbox {
  constructor(options = {}) {
    this.workDir = options.workDir || process.cwd();
    this.policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
    this.policy.workDir = this.workDir;
    this.analyzer = new CommandRiskAnalyzer(this.policy);
    this.docker = new DockerSandbox({ ...options.docker, workDir: this.workDir });
    this.approval = new ApprovalManager(this.policy);
    this.auditLog = [];
  }

  async execute(command, options = {}) {
    const { cwd, env, timeout, skipApproval } = options;
    const risk = this.analyzer.analyze(command);
    logger.info(`[Security] Risk: ${risk.level} — ${risk.reason}`);
    if (!skipApproval && risk.requiresApproval) {
      const approval = await this.approval.requestApproval(risk, { command });
      if (!approval.approved) {
        const msg = approval.reason || 'Denied by policy';
        this._audit('DENY', command, risk, msg);
        throw new Error(`Security: ${msg}`);
      }
    }
    const fileMatches = command.match(/(?:^|\s)([\w\-./]+(?:\.[\w]+))/g) || [];
    for (const match of fileMatches) {
      const filePath = match.trim();
      const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(this.workDir, filePath);
      if (fs.existsSync(absPath)) {
        const access = this.analyzer.checkFileAccess(absPath, 'read');
        if (!access.allowed) {
          this._audit('DENY_FILE', command, risk, access.reason);
          throw new Error(`Security: ${access.reason}`);
        }
      }
    }
    this._audit('EXECUTE', command, risk, null);
    return this.docker.run(command, { cwd, env, timeout });
  }

  checkFileOperation(filePath, operation) {
    return this.analyzer.checkFileAccess(filePath, operation);
  }

  getAuditLog() { return [...this.auditLog]; }

  _audit(action, command, risk, error, meta = {}) {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      action, command: command.slice(0, 500),
      riskLevel: risk.level, riskReason: risk.reason,
      error, ...meta,
    });
  }

  async cleanup() { await this.docker.cleanup(); }
}

module.exports = { SecuritySandbox, CommandRiskAnalyzer, DockerSandbox, ApprovalManager, DEFAULT_POLICY };