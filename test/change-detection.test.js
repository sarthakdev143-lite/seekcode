// test/change-detection.test.js
// Zero-dependency tests for the content-hash change-detection fix.
//
// The OLD code hashed `${size}:${mtimeMs}` per file. That had two failure
// modes this test pins down as fixed:
//   1. A file re-saved with identical bytes (same content, new mtime) was
//      reported as "changed" → false positives, spurious diff entries.
//   2. A file rewritten to different bytes at the same mtime granularity was
//      reported as "unchanged" → false negatives, missed edits.
//
// Content hashing fixes both: signature is a pure function of bytes.
//
// Two implementations share this contract:
//   - seekcode/src/orchestrator/EnhancedOrchestrator._snapshotWorkspace (per-file Map)
//   - deepseek-web-gateway/src/agent.js._workspaceSignature            (aggregate hash)
// We test the orchestrator's per-file Map directly (it drives the step diff),
// and exercise the gateway's aggregate hash by importing the class and pointing
// WORKING_DIR at a temp tree.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

// ── Orchestrator: per-file content snapshot ────────────────────────────────
async function testOrchestrator() {
  console.log('EnhancedOrchestrator._snapshotWorkspace — content-hash\n');
  const { EnhancedOrchestrator } = require('../src/orchestrator/EnhancedOrchestrator');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seekcode-cd-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'aaa');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'bbb');

  // Construct without running init() (which talks to the gateway/DeepSeek).
  // We only exercise the pure snapshot/diff helpers, so we instantiate the
  // class and call the method directly — it needs only this.projectPath set.
  const orch = Object.create(EnhancedOrchestrator.prototype);
  orch.projectPath = dir;

  // 1. Identical content + new mtime → NOT changed.
  const before = orch._snapshotWorkspace();
  // Re-write b.txt with identical bytes, forcing a fresh mtime.
  const b = path.join(dir, 'b.txt');
  const t0 = fs.statSync(b).mtimeMs;
  await new Promise(r => setTimeout(r, 20)); // ensure mtime advances
  fs.writeFileSync(b, 'bbb'); // same content
  fs.utimesSync(b, new Date(), new Date(Date.now() + 1000)); // bump mtime explicitly
  const afterTouch = orch._snapshotWorkspace();
  assert(before.get('b.txt') === afterTouch.get('b.txt'),
    'identical bytes + bumped mtime → same signature (no false positive)');

  // 2. Different bytes → signature changes even if size is identical.
  fs.writeFileSync(b, 'ccc'); // same length, different content
  const afterEdit = orch._snapshotWorkspace();
  assert(before.get('b.txt') !== afterEdit.get('b.txt'),
    'different content, same size → signature changes (no false negative)');
  assert(hash(b) === afterEdit.get('b.txt'),
    'signature equals the raw content hash');

  // 3. Diff reports only the file that actually changed.
  const diff = orch._diffSnapshot(before, afterEdit);
  assert(JSON.stringify(diff) === JSON.stringify(['b.txt']),
    'diff lists exactly the changed file');

  // 4. Newly created file appears in the diff.
  fs.writeFileSync(path.join(dir, 'c.txt'), 'ccc');
  const afterAdd = orch._snapshotWorkspace();
  const diffAdd = orch._diffSnapshot(before, afterAdd);
  assert(afterAdd.has('c.txt'), 'new file appears in the snapshot');
  assert(diffAdd.includes('c.txt'), 'new file appears in the diff');
  assert(diffAdd.includes('b.txt'), 'changed file still in the diff');

  // 5. Deleted file appears in the diff (as a removal).
  fs.unlinkSync(path.join(dir, 'a.txt'));
  const afterDel = orch._snapshotWorkspace();
  const diffDel = orch._diffSnapshot(before, afterDel);
  assert(!afterDel.has('a.txt') && diffDel.includes('a.txt'),
    'deleted file appears in the diff');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Gateway agent: aggregate content signature ────────────────────────────
async function testGateway() {
  console.log('\nAgent._workspaceSignature — aggregate content-hash\n');
  // Point WORKING_DIR at a temp tree before importing config (config reads
  // process.cwd() at import time; we instead set the field directly).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seekcode-gw-'));
  fs.writeFileSync(path.join(dir, 'x.txt'), 'xxx');

  const DeepSeekAgent = require(path.join(__dirname, '..', '..', 'deepseek-web-gateway', 'src', 'agent.js'));
  // config is a module-level singleton; override WORKING_DIR on the instance's
  // require'd copy by constructing then monkey-patching. The method reads
  // config.WORKING_DIR each call, so a direct field set is sufficient.
  const config = require(path.join(__dirname, '..', '..', 'deepseek-web-gateway', 'src', 'config.js'));
  const originalWd = config.WORKING_DIR;
  config.WORKING_DIR = dir;

  const agent = Object.create(DeepSeekAgent.prototype);

  // 1. Identical content + bumped mtime → aggregate signature unchanged.
  const before = agent._workspaceSignature();
  const x = path.join(dir, 'x.txt');
  await new Promise(r => setTimeout(r, 20));
  fs.writeFileSync(x, 'xxx'); // same content
  fs.utimesSync(x, new Date(), new Date(Date.now() + 1000));
  const afterTouch = agent._workspaceSignature();
  assert(before === afterTouch,
    'aggregate: identical bytes + bumped mtime → same signature');

  // 2. Different bytes → aggregate signature changes.
  fs.writeFileSync(x, 'yyy');
  const afterEdit = agent._workspaceSignature();
  assert(before !== afterEdit,
    'aggregate: content change → aggregate signature changes');

  config.WORKING_DIR = originalWd;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  try { await testOrchestrator(); } catch (err) {
    console.error('  orchestrator test crashed:', err); failed++;
  }
  try { await testGateway(); } catch (err) {
    console.error('  gateway test crashed:', err); failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest harness crashed:', err);
  process.exit(2);
});
