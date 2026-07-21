import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { saveApprovedArtists, loadApprovedArtists } from '../src/pipeline/artistDb.js';
import { updateScraperHealth, pruneDeadScrapers } from '../src/scripts/prune_dead_scrapers.js';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('updateScraperHealth: tracks a consecutive-failure streak, ignores non-prunable reasons and non-artist ids', async () => {
  const root = await tmpDir('scraper-health-');
  try {
    const healthPath = path.join(root, 'health.json');

    const day1 = await updateScraperHealth(healthPath, [
      { id: 'artist-foo', reason: 'fetch_error' },
      { id: 'artist-bar', reason: 'selectors_stale' }, // fixable by heal.ts -- not tracked here
      { id: 'afas-live-amsterdam', reason: 'fetch_error' } // venue scraper, not artist-<slug> shape -- excluded
    ], '2026-01-01T00:00:00.000Z');
    assert.deepStrictEqual(day1.map((h) => h.id), ['artist-foo']);
    assert.strictEqual(day1[0].consecutiveFailures, 1);

    const day2 = await updateScraperHealth(healthPath, [
      { id: 'artist-foo', reason: 'fetch_error' }
    ], '2026-01-02T00:00:00.000Z');
    assert.strictEqual(day2[0].consecutiveFailures, 2);
    assert.strictEqual(day2[0].firstFailedAt, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(day2[0].lastFailedAt, '2026-01-02T00:00:00.000Z');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('updateScraperHealth: a scraper that stops failing (or recovers) drops out of the streak tracker', async () => {
  const root = await tmpDir('scraper-health-recover-');
  try {
    const healthPath = path.join(root, 'health.json');
    await updateScraperHealth(healthPath, [{ id: 'artist-foo', reason: 'fetch_error' }], '2026-01-01T00:00:00.000Z');
    await updateScraperHealth(healthPath, [{ id: 'artist-foo', reason: 'fetch_error' }], '2026-01-02T00:00:00.000Z');

    // Day 3: artist-foo isn't in the fail-log at all (it succeeded) -- streak resets.
    const day3 = await updateScraperHealth(healthPath, [], '2026-01-03T00:00:00.000Z');
    assert.deepStrictEqual(day3, []);

    // Restarting a fresh streak later starts back at 1, not 3.
    const day4 = await updateScraperHealth(healthPath, [{ id: 'artist-foo', reason: 'fetch_error' }], '2026-01-04T00:00:00.000Z');
    assert.strictEqual(day4[0].consecutiveFailures, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pruneDeadScrapers: removes the config + resets the matching artist only past the threshold', async () => {
  const root = await tmpDir('prune-dead-');
  try {
    const scrapersDir = path.join(root, 'scrapers');
    const artistDb = path.join(root, 'artists');
    const auditPath = path.join(root, 'pruned-scrapers.json');
    await fs.mkdir(scrapersDir, { recursive: true });

    await fs.writeFile(
      path.join(scrapersDir, 'artist-dead-band.json'),
      JSON.stringify({ id: 'artist-dead-band', domain: 'deadband.example', url: 'https://deadband.example/tour', type: 'static_selectors', selectors: { artistNameFallback: 'Dead Band' } }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(scrapersDir, 'artist-almost-dead.json'),
      JSON.stringify({ id: 'artist-almost-dead', domain: 'almost.example', url: 'https://almost.example/tour', type: 'static_selectors', selectors: { artistNameFallback: 'Almost Dead' } }),
      'utf-8'
    );

    await saveApprovedArtists(artistDb, [
      { name: 'Dead Band', tourUrl: 'https://deadband.example/tour', tourScraperTriedAt: '2026-01-01T00:00:00.000Z', tourScraperCreatedAt: '2026-01-01T00:00:00.000Z', tourUrlProbeTriedAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Almost Dead', tourUrl: 'https://almost.example/tour', tourScraperCreatedAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Healthy Band', website: 'https://healthy.example' }
    ]);

    const health = [
      { id: 'artist-dead-band', consecutiveFailures: 5, lastReason: 'fetch_error', firstFailedAt: '2026-01-01T00:00:00.000Z', lastFailedAt: '2026-01-05T00:00:00.000Z' },
      { id: 'artist-almost-dead', consecutiveFailures: 3, lastReason: 'fetch_error', firstFailedAt: '2026-01-03T00:00:00.000Z', lastFailedAt: '2026-01-05T00:00:00.000Z' }
    ];

    const result = await pruneDeadScrapers(scrapersDir, health, artistDb, auditPath, '2026-01-05T00:00:00.000Z');
    assert.deepStrictEqual(result.pruned, ['artist-dead-band']);
    assert.deepStrictEqual(result.stillFailing, ['artist-almost-dead']);

    // Config file actually deleted for the pruned one, untouched for the one still under threshold.
    await assert.rejects(fs.access(path.join(scrapersDir, 'artist-dead-band.json')));
    await fs.access(path.join(scrapersDir, 'artist-almost-dead.json')); // must NOT throw

    const artists = await loadApprovedArtists(artistDb) as any[];
    const deadBand = artists.find((a) => a.name === 'Dead Band');
    assert.strictEqual(deadBand.tourUrl, undefined);
    assert.strictEqual(deadBand.tourScraperTriedAt, undefined);
    assert.strictEqual(deadBand.tourScraperCreatedAt, undefined);
    assert.strictEqual(deadBand.tourUrlProbeTriedAt, undefined);

    const almostDead = artists.find((a) => a.name === 'Almost Dead');
    assert.strictEqual(almostDead.tourUrl, 'https://almost.example/tour'); // untouched, still under threshold

    const healthyBand = artists.find((a) => a.name === 'Healthy Band');
    assert.ok(healthyBand); // unrelated artist untouched

    const audit = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
    assert.strictEqual(audit.length, 1);
    assert.strictEqual(audit[0].id, 'artist-dead-band');
    assert.strictEqual(audit[0].artistName, 'Dead Band');
    assert.strictEqual(audit[0].consecutiveFailures, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pruneDeadScrapers: no-op (and no audit file written) when nothing crosses the threshold', async () => {
  const root = await tmpDir('prune-noop-');
  try {
    const scrapersDir = path.join(root, 'scrapers');
    const artistDb = path.join(root, 'artists');
    const auditPath = path.join(root, 'pruned-scrapers.json');
    await fs.mkdir(scrapersDir, { recursive: true });
    await saveApprovedArtists(artistDb, [{ name: 'Some Artist' }]);

    const result = await pruneDeadScrapers(scrapersDir, [
      { id: 'artist-fine', consecutiveFailures: 1, lastReason: 'fetch_error', firstFailedAt: '2026-01-01T00:00:00.000Z', lastFailedAt: '2026-01-01T00:00:00.000Z' }
    ], artistDb, auditPath, '2026-01-01T00:00:00.000Z');

    assert.deepStrictEqual(result.pruned, []);
    await assert.rejects(fs.access(auditPath)); // never created
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pruneDeadScrapers: a case-insensitive name collision skips the field reset instead of guessing', async () => {
  const root = await tmpDir('prune-collision-');
  try {
    const scrapersDir = path.join(root, 'scrapers');
    const artistDb = path.join(root, 'artists');
    const auditPath = path.join(root, 'pruned-scrapers.json');
    await fs.mkdir(scrapersDir, { recursive: true });

    await fs.writeFile(
      path.join(scrapersDir, 'artist-nirvana.json'),
      JSON.stringify({ id: 'artist-nirvana', domain: 'x.example', url: 'https://x.example/tour', type: 'static_selectors', selectors: { artistNameFallback: 'Nirvana' } }),
      'utf-8'
    );

    // Two distinct DB rows share a name case-insensitively -- only one of them
    // (unknown which) actually owns the dead scraper.
    await saveApprovedArtists(artistDb, [
      { name: 'Nirvana', website: 'https://unrelated-real-site.example' },
      { name: 'nirvana', tourUrl: 'https://x.example/tour', tourScraperCreatedAt: '2026-01-01T00:00:00.000Z' }
    ]);

    const health = [
      { id: 'artist-nirvana', consecutiveFailures: 5, lastReason: 'fetch_error', firstFailedAt: '2026-01-01T00:00:00.000Z', lastFailedAt: '2026-01-05T00:00:00.000Z' }
    ];

    const result = await pruneDeadScrapers(scrapersDir, health, artistDb, auditPath, '2026-01-05T00:00:00.000Z');
    // The dead config is still removed and still audited -- only the ambiguous
    // artist-field reset is skipped.
    assert.deepStrictEqual(result.pruned, ['artist-nirvana']);
    await assert.rejects(fs.access(path.join(scrapersDir, 'artist-nirvana.json')));

    // saveApprovedArtists re-sorts by name (locale-aware), so don't assume
    // input order survives the round-trip -- match by the distinguishing
    // field each fixture row actually has instead of by array index.
    const artists = await loadApprovedArtists(artistDb) as any[];
    const unrelated = artists.find((a) => a.website === 'https://unrelated-real-site.example');
    const realOwner = artists.find((a) => a.tourUrl === 'https://x.example/tour');
    assert.ok(unrelated, 'unrelated same-named artist must still be present, untouched'); // not wiped
    assert.ok(realOwner, 'the real scraper-owning artist must still be present, untouched'); // ambiguous, left alone
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
