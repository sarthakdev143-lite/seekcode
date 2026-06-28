// test/gitignore.test.js
// Zero-dependency tests for GitManager.ensureIgnored('.seekcode').
//
// Runs with plain `node`. Requires git on PATH (the feature is a git feature,
// so testing against a real throwaway repo is the only honest way). Creates a
// fresh temp git repo per case and cleans it up.
//
// Covers:
//   1. Not a git repo → no-op, returns false, no crash.
//   2. Fresh repo (no .gitignore) → creates .gitignore with the entry.
//   3. Existing .gitignore without trailing newline → appends cleanly.
//   4. Already covered by a glob → no duplicate line added.
//   5. Already listed literally → no duplicate line added.
//   6. Idempotency → second call adds nothing.
//   7. Comment header is present so the entry is self-documenting.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { GitManager } = require('../src/git/GitManager');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function git(args, cwd) {
  return execSync(args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Create a throwaway git repo and return its path. */
function freshRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seekcode-git-'));
  git('git init -q', dir);
  // git needs an identity to be usable; set locally for the test repo.
  git('git config user.email test@test.test', dir);
  git('git config user.name Test', dir);
  return dir;
}

function readGitignore(dir) {
  const p = path.join(dir, '.gitignore');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

async function main() {
  console.log('\nGitManager.ensureIgnored — tests\n');

  // ── 1. Not a git repo → safe no-op ────────────────────────────────────────
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seekcode-nogit-'));
    const gm = new GitManager(dir);
    const out = gm.ensureIgnored('.seekcode');
    assert(out === false, 'non-repo returns false (no-op)');
    assert(readGitignore(dir) === null, 'no .gitignore created outside a repo');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── 2. Fresh repo, no .gitignore → creates it ─────────────────────────────
  {
    const dir = freshRepo();
    const gm = new GitManager(dir);
    const out = gm.ensureIgnored('.seekcode');
    const gi = readGitignore(dir);
    assert(out === true, 'fresh repo returns true');
    assert(gi !== null, '.gitignore was created');
    assert(gi && gi.includes('.seekcode'), '.gitignore contains .seekcode');
    assert(gi && gi.includes('SeekCode'), 'entry has the self-documenting comment header');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── 3. Existing .gitignore without trailing newline → appends cleanly ─────
  {
    const dir = freshRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules', 'utf8'); // no \n
    new GitManager(dir).ensureIgnored('.seekcode');
    const gi = readGitignore(dir);
    assert(gi && gi.startsWith('node_modules\n'), 'existing "node_modules" line preserved intact');
    assert(gi && gi.includes('.seekcode'), '.seekcode appended');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── 4. Already covered by a glob → no duplicate literal line ──────────────
  {
    const dir = freshRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), '.*\n', 'utf8'); // glob covers .seekcode
    const before = readGitignore(dir);
    new GitManager(dir).ensureIgnored('.seekcode');
    const after = readGitignore(dir);
    assert(before === after, 'glob already ignores it → file unchanged (no duplicate)');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── 5. Already listed literally → no duplicate ────────────────────────────
  {
    const dir = freshRepo();
    fs.writeFileSync(path.join(dir, '.gitignore'), '.seekcode\n', 'utf8');
    new GitManager(dir).ensureIgnored('.seekcode');
    const occurrences = (readGitignore(dir).match(/\.seekcode/g) || []).length;
    assert(occurrences === 1, 'literal entry already present → not duplicated');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── 6. Idempotency: calling twice adds nothing the second time ────────────
  {
    const dir = freshRepo();
    const gm = new GitManager(dir);
    gm.ensureIgnored('.seekcode');
    const afterFirst = readGitignore(dir);
    gm.ensureIgnored('.seekcode');
    const afterSecond = readGitignore(dir);
    assert(afterFirst === afterSecond, 'second call is a true no-op (idempotent)');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── 7. Works from a subdirectory of the repo ──────────────────────────────
  {
    const dir = freshRepo();
    const sub = path.join(dir, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    new GitManager(sub).ensureIgnored('.seekcode');
    const gi = readGitignore(dir); // should land at repo root, not the subdir
    assert(gi && gi.includes('.seekcode'), 'entry written to repo root even when run from a subdir');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest harness crashed:', err);
  process.exit(2);
});
