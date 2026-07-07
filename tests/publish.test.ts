import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { publishConcerts } from '../src/generator/publish.js';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('Publisher - writes concerts.json, per-artist/per-city files, and index.json', async () => {
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'The Cure', city: 'Berlin', date: '2026-10-12' }),
      makeConcert({ artist: 'Rammstein', city: 'Paris', date: '2026-11-01' })
    ];

    await publishConcerts(concerts, dir);

    const master = JSON.parse(await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8'));
    assert.strictEqual(master.length, 2);

    const theCure = JSON.parse(await fs.readFile(path.join(dir, 'artists', 'the-cure.json'), 'utf-8'));
    assert.strictEqual(theCure.length, 1);
    assert.strictEqual(theCure[0].artist, 'The Cure');

    const berlin = JSON.parse(await fs.readFile(path.join(dir, 'cities', 'berlin.json'), 'utf-8'));
    assert.strictEqual(berlin.length, 1);

    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    assert.strictEqual(index.stats.totalConcerts, 2);
    assert.strictEqual(index.stats.uniqueArtists, 2);
    assert.strictEqual(index.stats.uniqueCities, 2);
  });
});

test('Publisher - slugify collision merges distinct artists into one file (known limitation)', async () => {
  // "AC/DC" and "ACDC" both slugify to "acdc" -- this documents the current
  // behavior (both land in the same per-artist file) rather than asserting it's
  // desirable, so a future slugify change that silently reintroduces or changes
  // this collision is caught by a failing test either way.
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'AC/DC', date: '2026-10-12' }),
      makeConcert({ artist: 'ACDC', date: '2026-11-01' })
    ];

    await publishConcerts(concerts, dir);

    const files = await fs.readdir(path.join(dir, 'artists'));
    assert.deepStrictEqual(files, ['acdc.json']);
    const merged = JSON.parse(await fs.readFile(path.join(dir, 'artists', 'acdc.json'), 'utf-8'));
    assert.strictEqual(merged.length, 2);

    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    // uniqueArtists counts raw artist strings, not slugs, so this still reports 2
    // even though only one per-artist file was written -- a real discrepancy a
    // future fix should be aware of.
    assert.strictEqual(index.stats.uniqueArtists, 2);
  });
});

test('Publisher - pruneOrphans removes stale per-artist/city files no longer in the current run', async () => {
  await withTempDir(async (dir) => {
    await publishConcerts([makeConcert({ artist: 'The Cure', city: 'Berlin' })], dir);
    assert.ok(await fs.readFile(path.join(dir, 'artists', 'the-cure.json'), 'utf-8'));

    // Next run: The Cure stopped touring, only Rammstein remains.
    await publishConcerts([makeConcert({ artist: 'Rammstein', city: 'Paris', date: '2026-11-01' })], dir);

    const artistFiles = await fs.readdir(path.join(dir, 'artists'));
    assert.deepStrictEqual(artistFiles, ['rammstein.json']);
    const cityFiles = await fs.readdir(path.join(dir, 'cities'));
    assert.deepStrictEqual(cityFiles, ['paris.json']);
  });
});

test('Publisher - an empty concert list still produces a valid (zeroed) index.json', async () => {
  await withTempDir(async (dir) => {
    await publishConcerts([], dir);
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    assert.strictEqual(index.stats.totalConcerts, 0);
    const master = JSON.parse(await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8'));
    assert.deepStrictEqual(master, []);
  });
});

test('Publisher - sorts concerts by date, then artist, then city, and writes compact JSON', async () => {
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'Rammstein', city: 'Paris', date: '2026-11-01' }),
      makeConcert({ artist: 'The Cure', city: 'London', date: '2026-10-12' }),
      makeConcert({ artist: 'The Cure', city: 'Berlin', date: '2026-10-12' }),
      makeConcert({ artist: 'Aphex Twin', city: 'Berlin', date: '2026-10-12' })
    ];

    await publishConcerts(concerts, dir);

    const masterRaw = await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8');
    assert.strictEqual(masterRaw.includes('\n'), false);

    const master = JSON.parse(masterRaw);
    assert.strictEqual(master.length, 4);
    assert.strictEqual(master[0].artist, 'Aphex Twin');
    assert.strictEqual(master[1].artist, 'The Cure');
    assert.strictEqual(master[1].city, 'Berlin');
    assert.strictEqual(master[2].artist, 'The Cure');
    assert.strictEqual(master[2].city, 'London');
    assert.strictEqual(master[3].artist, 'Rammstein');
  });
});

