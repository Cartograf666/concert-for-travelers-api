import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

type Policy = { file: string; queue: string; cancelInProgress: string };
const workflowDir = join(process.cwd(), '.github', 'workflows');
const policies: Policy[] = readdirSync(workflowDir).filter(file => file.endsWith('.yml')).flatMap(file => {
  const source = readFileSync(join(workflowDir, file), 'utf8');
  // Read both workflow-level and job-level blocks, stopping at the next sibling.
  return [...source.matchAll(/^( *)concurrency:\s*\n((?:\1 +[^\n]*\n|\s*\n)+)/gm)]
    .filter(match => /^\s*group: artist-db-write[\t ]*(?:#[^\n]*)?$/m.test(match[2]))
    .map(match => ({
      file,
      queue: /^\s*queue: (\S+)[\t ]*(?:#[^\n]*)?$/m.exec(match[2])?.[1] ?? 'single',
      cancelInProgress: /^\s*cancel-in-progress: (\S+)[\t ]*(?:#[^\n]*)?$/m.exec(match[2])?.[1] ?? 'false',
    }));
});

const scheduledEnrichment = [
  'enrich-auto.yml', 'enrich-database.yml', 'enrich-metadata.yml',
  'enrich-similar.yml', 'enrich-images.yml',
];

/**
 * Deterministic model of the documented concurrency capacity, not a GitHub
 * runtime emulator: one running request; single replaces pending; max retains
 * up to 100 pending and cancels new arrivals at capacity. No rerun/dispatch is
 * part of the fix. Ordering is deliberately not asserted as a runtime promise.
 * https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
 */
class ConcurrencyModel {
  running: string | undefined;
  pending: string[] = [];
  cancelled: string[] = [];
  started: string[] = [];
  completed: string[] = [];

  submit(id: string, queue: string) {
    if (!this.running) {
      this.running = id;
      this.started.push(id);
    } else if (queue === 'max') {
      if (this.pending.length === 100) this.cancelled.push(id);
      else this.pending.push(id);
    } else {
      assert.ok(this.pending.length <= 1, 'mixed max/single semantics are outside this documented model');
      this.cancelled.push(...this.pending);
      this.pending = [id];
    }
  }

  finish() {
    assert.ok(this.running, 'only the running writer can complete');
    this.completed.push(this.running);
    this.running = this.pending.shift();
    if (this.running) this.started.push(this.running);
  }

  drain() {
    while (this.running) this.finish();
  }
}

test('every shared writer opts into max queue and preserves its single-writer lock', () => {
  assert.ok(policies.length >= scheduledEnrichment.length, 'group extraction must find shared writers');
  for (const file of scheduledEnrichment) {
    assert.equal(policies.filter(policy => policy.file === file).length, 1, `${file} must share the lock`);
    assert.match(readFileSync(join(workflowDir, file), 'utf8'), /^  schedule:/m);
  }
  assert.equal(policies.filter(policy => policy.file === 'daily-scrape.yml').length, 1);
  for (const policy of policies) {
    assert.equal(policy.queue, 'max', `${policy.file}: a single-queue arrival can preempt pending enrichment`);
    assert.equal(policy.cancelInProgress, 'false', `${policy.file}: an arriving request must not cancel the active writer`);
  }
});

test('old default queue reproduces a never-started scheduled slot being lost', () => {
  const model = new ConcurrencyModel();
  model.submit('active-writer', 'single');
  model.submit('scheduled-auto', 'single');
  model.submit('scheduled-metadata', 'single');
  assert.deepEqual(model.cancelled, ['scheduled-auto']);
  assert.deepEqual(model.started, ['active-writer']);
  model.drain();
  assert.deepEqual(model.completed, ['active-writer', 'scheduled-metadata']);
});

test('actual workflow policies retain all five scheduled slots alongside every other writer', () => {
  const model = new ConcurrencyModel();
  model.submit('active-writer', 'max');
  const arrivals = [...scheduledEnrichment, ...policies.map(policy => policy.file).filter(file => !scheduledEnrichment.includes(file))];
  for (const file of arrivals) {
    model.submit(file, policies.find(policy => policy.file === file)!.queue);
    assert.deepEqual(model.started, ['active-writer'], 'pending writers must not start while the lock is held');
  }
  assert.deepEqual(model.cancelled, [], 'scheduled requests must remain queued until the writer completes');
  assert.equal(model.pending.length, arrivals.length);
  model.drain();
  assert.deepEqual([...model.completed].sort(), ['active-writer', ...arrivals].sort());
  assert.equal(new Set(model.started).size, model.started.length, 'each request executes once without recovery dispatches');
  assert.deepEqual(model.started, model.completed);
});

test('max queue retains its first 100 pending requests and rejects the overflow request', () => {
  const model = new ConcurrencyModel();
  model.submit('active-writer', 'max');
  for (let i = 0; i < 101; i++) model.submit(`scheduled-${i}`, 'max');
  assert.equal(model.pending.length, 100);
  assert.deepEqual(model.cancelled, ['scheduled-100']);
  model.drain();
  assert.equal(model.completed.length, 101);
  assert.equal(new Set(model.completed).size, 101);
  assert.ok(!model.completed.includes('scheduled-100'));
});

test('importing the watchdog policy cannot call gh or mutate local drop history', () => {
  const isolatedDir = mkdtempSync(join(tmpdir(), 'artist-queue-import-'));
  try {
    const result = spawnSync(process.execPath, [
      '--import', require.resolve('tsx'), '-e',
      `require('node:child_process').execSync = () => { throw new Error('forbidden gh call'); };
       const watchdog = require(${JSON.stringify(join(process.cwd(), 'src/scripts/check_concurrency_drops.ts'))});
       if (!Array.isArray(watchdog.WORKFLOW_FILES)) process.exit(2);`,
    ], { cwd: isolatedDir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', 'import must not execute the watchdog');
    assert.equal(result.stderr, '', 'import must not attempt commands');
    assert.equal(existsSync(join(isolatedDir, 'data')), false, 'import must not create drop history');
  } finally {
    rmSync(isolatedDir, { recursive: true, force: true });
  }
});
