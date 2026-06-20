'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const chalk = require('chalk');

const END_MARKER = '---END---';

function readSingleLine(rl, prompt = chalk.bgCyan.black(' SEEKCODE ') + ' ' + chalk.cyan('❯ ')) {
  return new Promise((resolve, reject) => {
    const onLine = (line) => {
      cleanup();
      resolve(line);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('EOF'));
    };
    const cleanup = () => {
      rl.removeListener('line', onLine);
      rl.removeListener('close', onClose);
    };
    rl.on('line', onLine);
    rl.once('close', onClose);
    rl.setPrompt(prompt);
    rl.prompt();
  });
}

function readClipboard() {
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      return execSync(
        'powershell -NoProfile -Command "Get-Clipboard -Raw"',
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
    }
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      return execSync('pbpaste', { encoding: 'utf8' });
    }
    const { execSync } = require('child_process');
    return execSync('xclip -selection clipboard -o', { encoding: 'utf8' });
  } catch {
    return null;
  }
}

function resolveProjectPath(projectPath, filePath) {
  const expanded = filePath.replace(/^~(?=$|[/\\])/, os.homedir());
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(projectPath, expanded);
}

function loadFileContent(projectPath, filePath, maxChars = 500_000) {
  const absPath = resolveProjectPath(projectPath, filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory: ${filePath}`);
  }
  let content = fs.readFileSync(absPath, 'utf8');
  if (content.length > maxChars) {
    content = content.slice(-maxChars);
    content = `[... truncated to last ${maxChars.toLocaleString()} chars ...]\n\n${content}`;
  }
  return { absPath, content, filePath };
}

function expandFileReferences(text, projectPath) {
  let finalInput = text;
  const patterns = [
    /@"([^"]+)"/g,
    /@'([^']+)'/g,
    /@([\w/.\-\\:]+)/g,
  ];

  const seen = new Set();
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const token = match[0];
      if (seen.has(token)) continue;
      seen.add(token);
      const filePath = match[1];
      try {
        const { content, absPath } = loadFileContent(projectPath, filePath);
        finalInput = finalInput.replace(
          token,
          `\n--- FILE: ${filePath} (${absPath}) ---\n${content}\n------------------------\n`
        );
      } catch (err) {
        console.log(chalk.yellow('⚠') + ' ' + err.message);
      }
    }
  }
  return finalInput;
}

function listRecentLogs(projectPath, limit = 8) {
  const dirs = [
    path.join(projectPath, '.seekcode', 'traces'),
    path.join(projectPath, '.seekcode', 'sessions'),
  ];

  try {
    const gatewayRoot = path.dirname(require.resolve('deepseek-web-gateway/src/server.js'));
    dirs.push(path.join(gatewayRoot, '.seekcode', 'sessions'));
  } catch { /* gateway package not resolvable */ }

  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(jsonl?|log|txt)$/i.test(name)) continue;
      const abs = path.join(dir, name);
      try {
        const stat = fs.statSync(abs);
        if (stat.isFile()) {
          files.push({ abs, name, mtime: stat.mtimeMs, dir: path.basename(dir) });
        }
      } catch { /* skip */ }
    }
  }

  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

async function collectPasteMode(rl) {
  console.log('');
  console.log(chalk.cyan.bold('  Paste mode'));
  console.log(chalk.dim('  • Paste logs or multi-line text freely (blank lines are OK)'));
  console.log(chalk.dim(`  • Type ${chalk.white(END_MARKER)} on its own line when done`));
  console.log(chalk.dim('  • Ctrl+C to cancel\n'));

  const lines = [];
  while (true) {
    let line;
    try {
      line = await readSingleLine(rl, chalk.dim(`  ${lines.length + 1} │ `));
    } catch {
      if (lines.length > 0) return lines.join('\n');
      throw new Error('Input cancelled');
    }

    if (line.trim() === END_MARKER) break;
    lines.push(line);
  }

  const text = lines.join('\n').trim();
  if (!text) throw new Error('Empty input');
  console.log(chalk.dim(`  ✓ Captured ${lines.length} lines (${text.length.toLocaleString()} chars)\n`));

  const prefix = await readSingleLine(
    rl,
    chalk.cyan('  Task summary (optional, Enter to skip): ')
  );
  if (prefix.trim()) {
    return `${prefix.trim()}\n\n--- INPUT ---\n${text}`;
  }

  return text;
}

function openEditor(initialContent = '') {
  const tmpFile = path.join(os.tmpdir(), `seekcode-input-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, initialContent, 'utf8');

  const editor = process.env.SEEKCODE_EDITOR || process.env.EDITOR || process.env.VISUAL;
  let result = null;

  if (editor) {
    const parts = editor.split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), tmpFile];
    const proc = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (proc.error) throw proc.error;
    result = fs.readFileSync(tmpFile, 'utf8');
  } else if (process.platform === 'win32') {
    const proc = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Start-Process notepad.exe -ArgumentList '${tmpFile.replace(/'/g, "''")}' -Wait`],
      { stdio: 'inherit' }
    );
    if (proc.status !== 0) throw new Error('Editor failed to open');
    result = fs.readFileSync(tmpFile, 'utf8');
  } else {
    const proc = spawnSync('nano', [tmpFile], { stdio: 'inherit' });
    if (proc.error) throw proc.error;
    result = fs.readFileSync(tmpFile, 'utf8');
  }

  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

  const text = (result || '').trim();
  if (!text) throw new Error('Empty input');
  console.log(chalk.dim(`  ✓ Loaded ${text.length.toLocaleString()} chars from editor\n`));
  return text;
}

async function loadFromClipboard(rl) {
  const text = readClipboard();
  if (!text || !text.trim()) {
    throw new Error('Clipboard is empty or unavailable');
  }
  const trimmed = text.trim();
  console.log(chalk.dim(`  ✓ Loaded ${trimmed.length.toLocaleString()} chars from clipboard\n`));

  if (rl) {
    const prefix = await readSingleLine(
      rl,
      chalk.cyan('  Task summary (optional, Enter to skip): ')
    );
    if (prefix.trim()) {
      return `${prefix.trim()}\n\n--- CLIPBOARD ---\n${trimmed}`;
    }
  }

  return trimmed;
}

async function handleSlashCommand(commandLine, rl, projectPath) {
  const trimmed = commandLine.trim();
  const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch ((cmd || '').toLowerCase()) {
    case 'p':
    case 'paste':
      return collectPasteMode(rl);

    case 'e':
    case 'edit': {
      let seed = '';
      if (arg) {
        try {
          seed = loadFileContent(projectPath, arg).content;
        } catch (err) {
          console.log(chalk.yellow('⚠') + ' ' + err.message + ' — opening empty editor.');
        }
      }
      return openEditor(seed);
    }

    case 'c':
    case 'clip':
    case 'clipboard':
      return loadFromClipboard(rl);

    case 'l':
    case 'load':
      if (!arg) throw new Error('Usage: :load <file-path>');
      return loadFileContent(projectPath, arg).content;

    case 'logs': {
      const recent = listRecentLogs(projectPath);
      if (recent.length === 0) throw new Error('No log files found under .seekcode/');

      console.log('');
      console.log(chalk.cyan.bold('  Recent logs'));
      recent.forEach((f, i) => {
        const rel = path.relative(projectPath, f.abs);
        console.log(chalk.dim(`  ${i + 1}.`) + ` ${rel} ${chalk.dim(`(${f.dir})`)}`);
      });
      console.log('');

      if (/^\d+$/.test(arg)) {
        const pick = recent[parseInt(arg, 10) - 1];
        if (!pick) throw new Error(`Invalid log number: ${arg}`);
        return loadFileContent(projectPath, pick.abs).content;
      }

      const pickLine = await readSingleLine(rl, chalk.cyan('  Pick log # (or Enter to cancel): '));
      if (!pickLine.trim()) throw new Error('Cancelled');
      const pick = recent[parseInt(pickLine, 10) - 1];
      if (!pick) throw new Error(`Invalid selection: ${pickLine}`);
      return loadFileContent(projectPath, pick.abs).content;
    }

    case 'h':
    case 'help':
      printInputHelp();
      return null;

    case 'q':
    case 'quit':
    case 'exit':
      return { __exit: true };

    default:
      throw new Error(`Unknown command :${cmd}. Type :help for input commands.`);
  }
}

function printInputHelp() {
  console.log('');
  const lines = [
    chalk.bold('  Input Commands'),
    '',
    `  ${chalk.white(':paste')} or ${chalk.white(':p')}     Paste logs / multi-line text (${END_MARKER} to finish)`,
    `  ${chalk.white(':clip')}              Load directly from system clipboard`,
    `  ${chalk.white(':edit')} or ${chalk.white(':e')}      Compose in external editor (Notepad / $EDITOR)`,
    `  ${chalk.white(':load <path>')}       Load a file into context`,
    `  ${chalk.white(':logs [n]')}          Pick a recent trace/log file`,
    `  ${chalk.white('@file')}             Inline file reference (supports quotes: @"path with spaces")`,
    `  ${chalk.white(':help')}             Show this help`,
    `  ${chalk.white('exit')} or ${chalk.white('quit')} or ${chalk.white('q')}  Exit`,
    '',
    chalk.dim('  Tip: For pasted CI logs, use :clip or :paste — not plain Enter.'),
  ];
  lines.forEach(line => console.log(line));
}

function printInputBanner() {
  console.log(
    chalk.dim('  Input: ') +
    chalk.cyan('Enter') + chalk.dim('=send  │ ') +
    chalk.cyan(':paste') + chalk.dim('=logs  │ ') +
    chalk.cyan(':clip') + chalk.dim('=clipboard  │ ') +
    chalk.cyan(':edit') + chalk.dim('=editor  │ ') +
    chalk.cyan(':help')
  );
}

/**
 * Collect user input for the interactive agent loop.
 * @returns {Promise<string|null|{__exit: boolean}>}
 */
async function collectUserInput(rl, projectPath) {
  printInputBanner();

  let firstLine;
  try {
    firstLine = await readSingleLine(rl);
  } catch {
    return { __exit: true };
  }

  const trimmed = firstLine.trim();
  if (!trimmed) return null;

  if (['exit', 'quit', 'q'].includes(trimmed.toLowerCase())) {
    return { __exit: true };
  }

  if (trimmed.startsWith(':')) {
    return handleSlashCommand(trimmed, rl, projectPath);
  }

  return trimmed;
}

module.exports = {
  collectUserInput,
  expandFileReferences,
  printInputHelp,
  END_MARKER,
};
