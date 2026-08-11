import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { confirmRepairs } from '../src/scripts/confirm_repairs.js';
import {
  RepairRecord, failedStrategiesFor, pendingRecordFor, trimRepairHistory,
  REVERT_AFTER_FAILURES, MAX_SETTLED_PER_SCRAPER
} from '../src/healing/history.js';

const PREVIOUS_CONFIG = {
  id: 'artist-example',
  domain: 'example.com',
  url: 'https://example.com/old-tour',
  type: 'static_selectors',
  selectors: {
    eventBlock: '.old-event',
    date: '.old-date',
    venueNameFallback: '',
    cityNameFallback: '',
    countryNameFallback: 'US'
  }
};

function record(over: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: 'artist-example',
    strategy: 'url_moved',
    repairedAt: '2026-07-28T00:00:00.000Z',
    previousConfig: PREVIOUS_CONFIG,
    status: 'pending',
    failuresSinceRepair: 0,
    note: 'moved to /shows',
    verification: 'PASS (12 events, 6 checks)',
    ...over
  };
}

async function tempScrapersDir(withConfig = true): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'confirm-repairs-'));
  if (withConfig) {
    await fs.writeFile(
      path.join(dir, 'artist-example.json'),
      JSON.stringify({ ...PREVIOUS_CONFIG, url: 'https://example.com/shows' }, null, 2),
      'utf-8'
    );
  }
  return dir;
}

test('confirmRepairs - a repair that stops failing is confirmed', async () => {
  const dir = await tempScrapersDir();
  const records = [record()];

  const result = await confirmRepairs(records, new Set(), dir, '2026-07-29T00:00:00.000Z');

  assert.deepStrictEqual(result.confirmed, ['artist-example']);
  assert.strictEqual(records[0].status, 'confirmed');
  // The repaired config is untouched.
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'artist-example.json'), 'utf-8'));
  assert.strictEqual(onDisk.url, 'https://example.com/shows');
});

test('confirmRepairs - one post-repair failure is not enough to roll back', async () => {
  const dir = await tempScrapersDir();
  const records = [record()];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-29T00:00:00.000Z');

  assert.deepStrictEqual(result.stillPending, ['artist-example']);
  assert.strictEqual(records[0].status, 'pending');
  assert.strictEqual(records[0].failuresSinceRepair, 1);
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'artist-example.json'), 'utf-8'));
  assert.strictEqual(onDisk.url, 'https://example.com/shows');
});

test('confirmRepairs - the second consecutive failure restores the previous config', async () => {
  const dir = await tempScrapersDir();
  const records = [record({ failuresSinceRepair: REVERT_AFTER_FAILURES - 1 })];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-30T00:00:00.000Z');

  assert.deepStrictEqual(result.reverted, ['artist-example']);
  assert.strictEqual(records[0].status, 'reverted');
  assert.strictEqual(records[0].revertedAt, '2026-07-30T00:00:00.000Z');

  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'artist-example.json'), 'utf-8'));
  assert.deepStrictEqual(onDisk, PREVIOUS_CONFIG);
});

test('confirmRepairs - does not resurrect a config that was pruned meanwhile', async () => {
  const dir = await tempScrapersDir(false);
  const records = [record({ failuresSinceRepair: REVERT_AFTER_FAILURES - 1 })];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-30T00:00:00.000Z');

  assert.deepStrictEqual(result.reverted, ['artist-example']);
  await assert.rejects(fs.access(path.join(dir, 'artist-example.json')));
});

test('confirmRepairs - already-settled records are left alone', async () => {
  const dir = await tempScrapersDir();
  const records = [record({ status: 'confirmed' }), record({ status: 'reverted' })];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-30T00:00:00.000Z');

  assert.deepStrictEqual(result, { confirmed: [], reverted: [], stillPending: [] });
  assert.strictEqual(records[0].failuresSinceRepair, 0);
});

test('history - a rolled-back strategy is remembered so it is not retried', () => {
  const records = [
    record({ status: 'reverted', strategy: 'url_moved' }),
    record({ status: 'confirmed', strategy: 'anti_bot' }),
    record({ status: 'pending', strategy: 'transient' })
  ];

  const failed = failedStrategiesFor(records, 'artist-example');
  assert.ok(failed.has('url_moved'));
  assert.ok(!failed.has('anti_bot'), 'a confirmed strategy must stay available');
  assert.ok(!failed.has('transient'), 'an unproven strategy is not yet known-bad');

  assert.strictEqual(pendingRecordFor(records, 'artist-example')?.strategy, 'transient');
  assert.strictEqual(pendingRecordFor(records, 'artist-other'), undefined);
});

test('history - trimming keeps every pending record and the newest settled ones', () => {
  // This file is committed and rewritten daily; unbounded growth would bloat the
  // repo and every self-heal PR diff.
  const settled: RepairRecord[] = Array.from({ length: MAX_SETTLED_PER_SCRAPER + 5 }, (_, i) =>
    record({ status: 'confirmed', repairedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
  );
  const other = record({ id: 'artist-other', status: 'reverted' });
  const stillPending = record({ status: 'pending', repairedAt: '2026-08-01T00:00:00.000Z' });

  const trimmed = trimRepairHistory([...settled, other, stillPending]);

  assert.strictEqual(trimmed.filter((r) => r.id === 'artist-example' && r.status !== 'pending').length, MAX_SETTLED_PER_SCRAPER);
  assert.strictEqual(trimmed.filter((r) => r.status === 'pending').length, 1);
  // Per-scraper cap, so a busy scraper cannot evict another scraper's history.
  assert.strictEqual(trimmed.filter((r) => r.id === 'artist-other').length, 1);
  // Chronological order is preserved, and the oldest entries are the ones dropped.
  const kept = trimmed.filter((r) => r.id === 'artist-example' && r.status === 'confirmed');
  assert.strictEqual(kept[0].repairedAt, '2026-07-06T00:00:00.000Z');
  assert.strictEqual(kept[kept.length - 1].repairedAt, '2026-07-15T00:00:00.000Z');
});
