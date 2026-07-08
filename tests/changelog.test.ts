import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { publishChangelog, concertKey, ChangelogCache } from '../src/generator/changelog.js';
import { Concert } from '../src/schemas/concert.js';

function makeConcert(overrides: Partial<Concert>): Concert {
  return {
    artist: 'The Cure',
    date: '2026-10-12',
    venue: 'Club Arena',
    city: 'Berlin',
    country: 'DE',
    originalSource: 'club-arena.de',
    scrapedAt: new Date().toISOString(),
    ...overrides
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('concertKey - matches processConcerts\' own dedupe identity (artist+date+city, slugified)', () => {
  const a = makeConcert({ artist: 'The Cure', date: '2026-10-12', city: 'Berlin' });
  const b = makeConcert({ artist: 'the cure', date: '2026-10-12', city: 'BERLIN' });
  assert.strictEqual(concertKey(a), concertKey(b));
});

test('publishChangelog - cold start (empty cache) reports zero changes but seeds the cache', async () => {
  await withTempDir(async (dir) => {
    const cache: ChangelogCache = { knownKeys: [] };
    const concerts = [makeConcert({ artist: 'The Cure' }), makeConcert({ artist: 'Muse' })];

    const result = await publishChangelog(concerts, dir, cache);

    assert.strictEqual(result.coldStart, true);
    assert.strictEqual(result.newCount, 0);
    assert.strictEqual(cache.knownKeys.length, 2, 'cache is seeded with the current concerts for next run\'s diff');

    const changes = JSON.parse(await fs.readFile(path.join(dir, 'changes.json'), 'utf-8'));
    assert.deepStrictEqual(changes, []);
  });
});

test('publishChangelog - reports only concerts not in the prior known set', async () => {
  await withTempDir(async (dir) => {
    const existing = makeConcert({ artist: 'The Cure' });
    const cache: ChangelogCache = { knownKeys: [concertKey(existing)] };
    const newOne = makeConcert({ artist: 'Muse', city: 'Amsterdam' });

    const result = await publishChangelog([existing, newOne], dir, cache);

    assert.strictEqual(result.coldStart, false);
    assert.strictEqual(result.newCount, 1);
    const changes = JSON.parse(await fs.readFile(path.join(dir, 'changes.json'), 'utf-8'));
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].artist, 'Muse');
    assert.strictEqual(changes[0].concertId, concertKey(newOne));
  });
});

test('publishChangelog - a concert that stops appearing (cancelled/pruned) is just not reported again, no error', async () => {
  await withTempDir(async (dir) => {
    const gone = makeConcert({ artist: 'Gone Band' });
    const cache: ChangelogCache = { knownKeys: [concertKey(gone)] };

    const result = await publishChangelog([], dir, cache);
    assert.strictEqual(result.newCount, 0);
    assert.strictEqual(cache.knownKeys.length, 0, 'cache reflects the now-empty current set');
  });
});

test('publishChangelog - accumulates across multiple runs and prunes entries past the retention window', async () => {
  await withTempDir(async (dir) => {
    // Pre-seed changes.json with one stale (31 days old) and one fresh entry.
    const stale = { concertId: 'old_2026-01-01_old', artist: 'Old Band', date: '2026-01-01', venue: 'V', city: 'C', country: 'DE', detectedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() };
    const fresh = { concertId: 'fresh_2026-06-01_fresh', artist: 'Fresh Band', date: '2026-06-01', venue: 'V', city: 'C', country: 'DE', detectedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'changes.json'), JSON.stringify([stale, fresh]), 'utf-8');

    const cache: ChangelogCache = { knownKeys: ['fresh_2026-06-01_fresh'] };
    const brandNew = makeConcert({ artist: 'Brand New Band' });

    await publishChangelog([brandNew], dir, cache);

    const changes = JSON.parse(await fs.readFile(path.join(dir, 'changes.json'), 'utf-8'));
    const ids = changes.map((c: any) => c.concertId);
    assert.ok(!ids.includes('old_2026-01-01_old'), 'stale (>30 day) entry pruned');
    assert.ok(ids.includes('fresh_2026-06-01_fresh'), 'still-fresh entry kept');
    assert.ok(ids.includes(concertKey(brandNew)), 'newly detected concert added');
  });
});
