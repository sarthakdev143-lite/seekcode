'use strict';
// src/utils/platformCommands.js
// OS-aware command generator. The root cause of many Windows failures is that
// commands like `timeout /t 5 /nobreak >nul` fail when stdin is redirected
// (i.e. inside Node.js execSync/spawn with stdio: 'pipe').
//
// This module generates correct, platform-safe equivalents for common patterns.

const os = require('os');

const IS_WIN = os.platform() === 'win32';

/**
 * Generate a sleep/wait command appropriate for the current OS.
 * @param {number} seconds
 * @returns {string}
 */
function sleep(seconds) {
  if (IS_WIN) {
    // ping -n counts one extra (ping once = ~0s, so we add 1)
    // This works even with redirected stdin, unlike `timeout`
    return `ping -n ${seconds + 1} 127.0.0.1 >nul 2>&1`;
  }
  return `sleep ${seconds}`;
}

/**
 * Generate a command to check if a port is listening.
 * Note: prefers Node.js http approach in ValidationEngine.
 * This is for when the agent needs a shell command.
 * @param {number} port
 * @param {string} [host='localhost']
 * @returns {string}
 */
function checkPort(port, host = 'localhost') {
  if (IS_WIN) {
    return `powershell -NoProfile -Command "try { $t = New-Object System.Net.Sockets.TcpClient('${host}', ${port}); $t.Close(); exit 0 } catch { exit 1 }"`;
  }
  return `nc -z ${host} ${port} 2>/dev/null || (sleep 1 && nc -z ${host} ${port})`;
}

/**
 * Generate a curl-equivalent that works on all platforms.
 * Uses PowerShell's Invoke-WebRequest on Windows, curl on Linux/Mac.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout=5] seconds
 * @returns {string}
 */
function httpGet(url, { timeout = 5 } = {}) {
  if (IS_WIN) {
    return `powershell -NoProfile -Command "(Invoke-WebRequest -Uri '${url}' -TimeoutSec ${timeout} -UseBasicParsing).StatusCode"`;
  }
  return `curl -s -o /dev/null -w "%{http_code}" --max-time ${timeout} "${url}"`;
}

/**
 * Generate a command to kill a process listening on a port.
 * @param {number} port
 * @returns {string}
 */
function killPort(port) {
  if (IS_WIN) {
    return [
      `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${port} "') do taskkill /F /PID %a`,
    ].join(' & ');
  }
  return `lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`;
}

/**
 * Generate an npm install command.
 * @param {string} [packageName] If omitted, installs all deps from package.json
 * @param {boolean} [saveDev=false]
 * @returns {string}
 */
function npmInstall(packageName, saveDev = false) {
  if (!packageName) return 'npm install';
  return `npm install ${saveDev ? '--save-dev ' : ''}${packageName}`;
}

/**
 * Generate an npm run command.
 * @param {string} script
 * @param {string} [cwd] optional working directory prefix
 * @returns {string}
 */
function npmRun(script, cwd) {
  const cmd = `npm run ${script}`;
  if (cwd) {
    return IS_WIN ? `cd /d "${cwd}" && ${cmd}` : `cd "${cwd}" && ${cmd}`;
  }
  return cmd;
}

/**
 * Sanitize a command string that may contain Windows-incompatible patterns.
 * Used to auto-fix commands before sending them to execSync.
 * @param {string} cmd
 * @returns {string}
 */
function sanitizeCommand(cmd) {
  if (!IS_WIN) return cmd;
  let out = cmd;

  // Replace: timeout /t N /nobreak >nul  →  ping -n (N+1) 127.0.0.1 >nul 2>&1
  out = out.replace(/timeout\s+\/t\s+(\d+)\s*(?:\/nobreak)?\s*(?:>nul)?/gi, (_, n) => {
    return sleep(parseInt(n, 10));
  });

  // Replace: sleep N  →  ping equivalent
  out = out.replace(/\bsleep\s+(\d+)\b/gi, (_, n) => {
    return sleep(parseInt(n, 10));
  });

  // Replace: curl -s ... | ...  →  PowerShell equivalent (only for simple health checks)
  // We leave complex curl commands alone — the agent should use http_get tool instead
  out = out.replace(/\bcurl\s+-s\s+-o\s+\/dev\/null\s+-w\s+"[^"]*"\s+([^\s|&]+)/gi, (_, url) => {
    return httpGet(url);
  });

  return out;
}

module.exports = {
  IS_WIN,
  sleep,
  checkPort,
  httpGet,
  killPort,
  npmInstall,
  npmRun,
  sanitizeCommand,
};
