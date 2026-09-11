import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { confirmRepairs } from '../src/scripts/confirm_repairs.js';
import {
  RepairRecord, failedStrategiesFor, pendingRecordFor, trimRepairHistory,
  REVERT_AFTER_FAILURES, MAX_SETTLED_PER_SCRAPER, REJECTED_ATTEMPTS_BEFORE_SKIP
} from '../src/healing/history.js';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
const CURRENT_CONFIG = { ...PREVIOUS_CONFIG, url: 'https://example.com/shows' };
const CURRENT_RAW = JSON.stringify(CURRENT_CONFIG, null, 2);
const CURRENT_HASH = createHash('sha256').update(CURRENT_RAW).digest('hex');

function completeRun(status: 'succeeded' | 'failed' = 'succeeded', over: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-07-29T00:00:00.000Z',
    complete: true as const,
    run: { id: 'run-1', attempt: 1 },
    outcomes: [{
      id: 'artist-example', configPath: 'scrapers/artist-example.json',
      configHash: CURRENT_HASH, status
    }],
    ...over
  };
}

function record(over: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: 'artist-example',
    cohort: 'venue',
    configPath: 'scrapers/artist-example.json',
    repairedConfigHash: CURRENT_HASH,
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'confirm-repairs-'));
  const dir = path.join(root, 'scrapers');
  await fs.mkdir(dir);
  if (withConfig) {
    await fs.writeFile(
      path.join(dir, 'artist-example.json'),
      CURRENT_RAW,
      'utf-8'
    );
  }
  return dir;
}

test('confirmRepairs - a repair that stops failing is confirmed', async () => {
  const dir = await tempScrapersDir();
  const records = [record()];

  const result = await confirmRepairs(records, new Set(), dir, '2026-07-29T00:00:00.000Z', { cohort: 'venue', run: completeRun() });

  assert.deepStrictEqual(result.confirmed, ['artist-example']);
  assert.strictEqual(records[0].status, 'confirmed');
  // The repaired config is untouched.
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'artist-example.json'), 'utf-8'));
  assert.strictEqual(onDisk.url, 'https://example.com/shows');
});

test('confirmRepairs - one post-repair failure is not enough to roll back', async () => {
  const dir = await tempScrapersDir();
  const records = [record()];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-29T00:00:00.000Z', { cohort: 'venue', run: completeRun('failed') });

  assert.deepStrictEqual(result.stillPending, ['artist-example']);
  assert.strictEqual(records[0].status, 'pending');
  assert.strictEqual(records[0].failuresSinceRepair, 1);
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'artist-example.json'), 'utf-8'));
  assert.strictEqual(onDisk.url, 'https://example.com/shows');
});

test('confirmRepairs - the second consecutive failure restores the previous config', async () => {
  const dir = await tempScrapersDir();
  const records = [record({ failuresSinceRepair: REVERT_AFTER_FAILURES - 1 })];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-30T00:00:00.000Z', { cohort: 'venue', run: completeRun('failed') });

  assert.deepStrictEqual(result.reverted, ['artist-example']);
  assert.strictEqual(records[0].status, 'reverted');
  assert.strictEqual(records[0].revertedAt, '2026-07-30T00:00:00.000Z');

  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'artist-example.json'), 'utf-8'));
  assert.deepStrictEqual(onDisk, PREVIOUS_CONFIG);
});

test('confirmRepairs - does not resurrect a config that was pruned meanwhile', async () => {
  const dir = await tempScrapersDir(false);
  const records = [record({ failuresSinceRepair: REVERT_AFTER_FAILURES - 1 })];

  const result = await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-30T00:00:00.000Z', { cohort: 'venue', run: completeRun('failed') });

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

test('confirmRepairs - a venue fail-log cannot confirm an artist repair', async () => {
  const dir = await tempScrapersDir();
  const records = [record({ cohort: 'artist', configPath: 'scrapers/artists/artist-example.json' })];

  const result = await confirmRepairs(records, new Set(), dir, '2026-07-30T00:00:00.000Z', { cohort: 'venue', run: completeRun() });

  assert.deepStrictEqual(result, { confirmed: [], reverted: [], stillPending: [] });
  assert.strictEqual(records[0].status, 'pending');
});

test('confirmRepairs - arbitrary, incomplete, or pre-repair logs cannot confirm by absence', async () => {
  const dir = await tempScrapersDir();
  for (const run of [
    undefined,
    { ...completeRun(), complete: false as const },
    completeRun('succeeded', { generatedAt: '2026-07-27T00:00:00.000Z' })
  ]) {
    const records = [record()];
    const result = await confirmRepairs(records, new Set(), dir, '2026-07-30T00:00:00.000Z', { cohort: 'venue', run });
    assert.deepStrictEqual(result.confirmed, []);
    assert.deepStrictEqual(result.stillPending, ['artist-example']);
    assert.strictEqual(records[0].status, 'pending');
  }
});

test('confirmRepairs - absence or a different config hash never confirms a repair', async () => {
  const dir = await tempScrapersDir();
  for (const outcomes of [[], [{
    id: 'artist-example', configPath: 'scrapers/artist-example.json',
    configHash: 'f'.repeat(64), status: 'succeeded' as const
  }]]) {
    const records = [record()];
    const result = await confirmRepairs(records, new Set(), dir, '2026-07-30T00:00:00.000Z', {
      cohort: 'venue', run: completeRun('succeeded', { outcomes })
    });
    assert.deepStrictEqual(result.confirmed, []);
    assert.deepStrictEqual(result.stillPending, ['artist-example']);
    assert.strictEqual(records[0].status, 'pending');
  }
});

test('confirmRepairs - replayed and stale runs do not increment failure counters', async () => {
  const dir = await tempScrapersDir();
  const records = [record()];
  const first = completeRun('failed');
  await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-29T00:00:00.000Z', { cohort: 'venue', run: first });
  await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-29T01:00:00.000Z', { cohort: 'venue', run: first });
  await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-29T02:00:00.000Z', {
    cohort: 'venue',
    run: completeRun('failed', { generatedAt: '2026-07-28T12:00:00.000Z', run: { id: 'older', attempt: 1 } })
  });
  assert.strictEqual(records[0].failuresSinceRepair, 1);
  assert.strictEqual(records[0].status, 'pending');
});

test('confirmRepairs - dry-run leaves counters and replay state untouched', async () => {
  const dir = await tempScrapersDir();
  const records = [record()];
  await confirmRepairs(records, new Set(['artist-example']), dir, '2026-07-29T00:00:00.000Z', {
    cohort: 'venue', run: completeRun('failed'), dryRun: true
  });
  assert.strictEqual(records[0].failuresSinceRepair, 0);
  assert.strictEqual(records[0].lastProcessedRun, undefined);
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

test('history - retention does not let an artist and venue with the same id evict one another', () => {
  const venue = Array.from({ length: MAX_SETTLED_PER_SCRAPER + 2 }, (_, i) => record({
    id: 'shared-id',
    cohort: 'venue',
    configPath: 'scrapers/shared-id.json',
    status: 'confirmed',
    repairedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  const artist = Array.from({ length: MAX_SETTLED_PER_SCRAPER + 2 }, (_, i) => record({
    id: 'shared-id',
    cohort: 'artist',
    configPath: 'scrapers/artists/shared-id.json',
    status: 'confirmed',
    repairedAt: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
  const legacy = record({ id: 'shared-id', cohort: undefined, configPath: undefined, status: 'confirmed' });

  const trimmed = trimRepairHistory([...venue, ...artist, legacy]);

  assert.strictEqual(trimmed.filter((r) => r.configPath === 'scrapers/shared-id.json').length, MAX_SETTLED_PER_SCRAPER);
  assert.strictEqual(trimmed.filter((r) => r.configPath === 'scrapers/artists/shared-id.json').length, MAX_SETTLED_PER_SCRAPER);
  assert.ok(trimmed.includes(legacy), 'a cohort-less legacy record must remain in its own retention bucket');
});

// --- Rejected repairs must leave durable state ---
//
// A candidate that fails verification writes no config, so before it was
// recorded the attempt vanished with the run's ephemeral report. The scraper
// reappeared in the next day's fail-log, was classified identically, and the
// same Gemini cascade ran and failed the same way. Every night, billed.

test('failedStrategiesFor skips a strategy only after repeated rejections', () => {
  const rejected = (n: number) =>
    Array.from({ length: n }, () => record({ id: 'v1', strategy: 'llm_reselect', status: 'rejected' }));

  // One or two rejections can be a transient site outage, not a hopeless
  // strategy -- banning on a fluke would retire one that works tomorrow.
  assert.strictEqual(
    failedStrategiesFor(rejected(REJECTED_ATTEMPTS_BEFORE_SKIP - 1), 'v1').has('llm_reselect'),
    false
  );
  assert.strictEqual(
    failedStrategiesFor(rejected(REJECTED_ATTEMPTS_BEFORE_SKIP), 'v1').has('llm_reselect'),
    true
  );
});

test('failedStrategiesFor preserves legacy rejection state during cohort migration', () => {
  const legacy = Array.from({ length: REJECTED_ATTEMPTS_BEFORE_SKIP }, () =>
    record({ id: 'artist-legacy', cohort: undefined, configPath: undefined, strategy: 'llm_reselect', status: 'rejected' })
  );
  assert.strictEqual(failedStrategiesFor(legacy, 'artist-legacy', 'artist').has('llm_reselect'), true);
});

test('failedStrategiesFor still blacklists a reverted repair immediately', () => {
  // A rolled-back repair landed, verified, and broke anyway -- strong evidence.
  const records = [record({ id: 'v1', strategy: 'llm_reselect', status: 'reverted' })];
  assert.strictEqual(failedStrategiesFor(records, 'v1').has('llm_reselect'), true);
});

test('trimRepairHistory never drops a reverted record', () => {
  // Rejected records are far more numerous; letting them evict the reverted one
  // would silently un-blacklist a strategy already proven bad.
  const reverted = record({ id: 'v1', strategy: 'llm_reselect', status: 'reverted' });
  const noise = Array.from({ length: MAX_SETTLED_PER_SCRAPER + 10 }, () =>
    record({ id: 'v1', strategy: 'chain_probe', status: 'rejected' })
  );

  const trimmed = trimRepairHistory([reverted, ...noise]);
  assert.ok(
    trimmed.some((r) => r.status === 'reverted' && r.strategy === 'llm_reselect'),
    'the reverted record must survive trimming'
  );
  assert.strictEqual(failedStrategiesFor(trimmed, 'v1').has('llm_reselect'), true);
});

test('heal - an unexpected per-scraper error still persists a rejected repair attempt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'heal-rejected-history-'));
  const reportsDir = path.join(root, 'reports');
  const scrapersDir = path.join(root, 'scrapers');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.mkdir(scrapersDir);
  await fs.mkdir(dataDir);

  const config = { id: 'broken-venue', domain: 'example.com', url: 'https://example.com/shows', type: 'jsonld' };
  const configRaw = JSON.stringify(config, null, 2) + '\n';
  const configPath = path.join(scrapersDir, 'broken-venue.json');
  await fs.writeFile(configPath, configRaw, 'utf-8');
  const configHash = createHash('sha256').update(configRaw).digest('hex');
  const failure = {
    id: 'broken-venue',
    configPath: 'scrapers/broken-venue.json',
    reason: 'selectors_stale',
    error: 'selector no longer matches',
    htmlSample: '<main></main>'
  };
  const manifest = {
    schemaVersion: 1,
    cohort: 'venue',
    generatedAt: '2026-08-01T00:00:00.000Z',
    complete: true,
    run: { id: 'fixture-run', attempt: 1 },
    scrapers: { total: 1, succeeded: 0, failed: 1, changed: 0, unchanged: 0, staleIds: [] },
    outcomes: [{ ...failure, configHash, status: 'failed' }],
    failures: [{
      id: failure.id,
      configPath: failure.configPath,
      reason: failure.reason,
      error: failure.error
    }]
  };
  await fs.writeFile(path.join(reportsDir, 'fail-log.json'), JSON.stringify([failure]), 'utf-8');
  await fs.writeFile(path.join(reportsDir, 'venue-run-manifest.json'), JSON.stringify(manifest), 'utf-8');

  // repairScraperConfig immediately rejects this non-selector config. Making the
  // original config read-only then makes the in-place restoration throw, which
  // exercises the outer per-scraper catch rather than the normal rejected path.
  await fs.chmod(configPath, 0o444);
  try {
    await execFile(process.execPath, [
      '--import', path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs'),
      path.join(repoRoot, 'src', 'heal.ts'), '--cohort', 'venue'
    ], {
      cwd: root,
      env: { ...process.env, GEMINI_API_KEY: 'fixture-key', HEAL_BUDGET_MS: '60000' }
    });
  } finally {
    await fs.chmod(configPath, 0o644);
  }

  const history = JSON.parse(await fs.readFile(path.join(dataDir, 'repair-history.json'), 'utf-8')) as RepairRecord[];
  assert.strictEqual(history.length, 1);
  assert.deepStrictEqual(history[0], {
    id: 'broken-venue',
    cohort: 'venue',
    configPath: 'scrapers/broken-venue.json',
    strategy: 'selectors',
    repairedAt: history[0].repairedAt,
    previousConfig: config,
    status: 'rejected',
    failuresSinceRepair: 0,
    note: history[0].note,
    verification: ''
  });
  assert.match(history[0].note, /^unexpected error: /);
  assert.match(history[0].note, /could not restore original config/);

  const summary = JSON.parse(await fs.readFile(path.join(reportsDir, 'repair-summary.json'), 'utf-8'));
  assert.deepStrictEqual(summary, { healed: [], historyChanged: true });
});
