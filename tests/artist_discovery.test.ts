import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { artistDiscoveryFor, classifyArtistDiscoveryAudience } from '../src/pipeline/artist_discovery.js';
import { buildApprovedMatcher, processConcerts } from '../src/pipeline/process.js';
import { publishArtistCatalog, publishConcerts } from '../src/generator/publish.js';
import { ConcertSchema } from '../src/schemas/concert.js';

const unknownDiscovery = { version: 1, audience: 'unknown', basis: 'lastfm-listeners', metricAsOf: null };

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artist-discovery-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('artist discovery - balanced listener thresholds are inclusive and invalid values are unknown', () => {
  assert.strictEqual(classifyArtistDiscoveryAudience(1_000_000), 'very-large');
  assert.strictEqual(classifyArtistDiscoveryAudience(100_000), 'large');
  assert.strictEqual(classifyArtistDiscoveryAudience(10_000), 'medium');
  assert.strictEqual(classifyArtistDiscoveryAudience(9_999), 'small');
  for (const value of [0, -1, NaN, Infinity, undefined, '100000']) {
    assert.strictEqual(classifyArtistDiscoveryAudience(value), 'unknown');
  }
});

test('artist discovery - concert schema accepts legacy records but rejects an invalid new field', () => {
  const legacy = {
    artist: 'Legacy', date: '2026-10-12', venue: 'Club Arena', city: 'Berlin', country: 'DE',
    originalSource: 'club-arena.example', scrapedAt: '2026-09-11T12:00:00.000Z'
  };
  assert.strictEqual(ConcertSchema.safeParse(legacy).success, true);
  assert.strictEqual(ConcertSchema.safeParse({ ...legacy, artistDiscovery: { ...unknownDiscovery, version: 2 } }).success, false);
  assert.strictEqual(ConcertSchema.safeParse({ ...legacy, artistDiscovery: { ...unknownDiscovery, audience: 'current-global' } }).success, false);
});

test('artist discovery - matcher takes classification from the exact approved row, including aliases', () => {
  const matchedArtist = { name: 'Мьюз', displayName: 'Muse', aliases: ['Muse'], popularity: { listeners: 100_000, playcount: 1 } };
  const matchWithUnrelatedRoster = buildApprovedMatcher([matchedArtist, { name: 'Unrelated', popularity: { listeners: 9_999_999, playcount: 1 } }]);
  const matchWithoutUnrelatedRoster = buildApprovedMatcher([matchedArtist]);

  assert.deepStrictEqual(matchWithUnrelatedRoster('Muse'), {
    name: 'Мьюз',
    website: undefined,
    socials: undefined,
    mbid: undefined,
    artistDiscovery: { version: 1, audience: 'large', basis: 'lastfm-listeners', metricAsOf: null }
  });
  assert.deepStrictEqual(matchWithUnrelatedRoster('Muse')?.artistDiscovery, matchWithoutUnrelatedRoster('Muse')?.artistDiscovery);
  assert.deepStrictEqual(artistDiscoveryFor('Legacy row'), unknownDiscovery);
});

test('artist discovery - catalog and every concert feed preserve the same matched-row projection', async () => {
  await withTempDir(async (dir) => {
    const artists = [
      { name: 'Мьюз', displayName: 'Muse', aliases: ['Muse'], popularity: { listeners: 100_000, playcount: 1 }, tier: 'professional' },
      { name: 'Small Artist', aliases: ['Small'], popularity: { listeners: 9_999, playcount: 1 }, tier: 'longtail' },
      'Legacy row'
    ];
    const artistDbPath = path.join(dir, 'approved_artists.json');
    await fs.writeFile(artistDbPath, JSON.stringify(artists), 'utf8');
    const beforeDb = await fs.readFile(artistDbPath, 'utf8');
    const concerts = await processConcerts([
      { artist: 'Muse', date: '2026-10-12', venue: 'Club Arena', city: 'Berlin', country: 'DE', originalSource: 'club-arena.example', scrapedAt: '2026-09-11T12:00:00.000Z' },
      { artist: 'Small', date: '2026-10-13', venue: 'Club Arena', city: 'Berlin', country: 'DE', originalSource: 'club-arena.example', scrapedAt: '2026-09-11T12:00:00.000Z' },
      { artist: 'Legacy row', date: '2026-10-14', venue: 'Club Arena', city: 'Berlin', country: 'DE', originalSource: 'club-arena.example', scrapedAt: '2026-09-11T12:00:00.000Z' }
    ], artistDbPath, '2026-09-11T00:00:00.000Z');

    assert.strictEqual(await fs.readFile(artistDbPath, 'utf8'), beforeDb, 'discovery must not mutate the artist DB or tier');
    assert.strictEqual(concerts.length, 3, 'large, small, and unknown artists must all remain in the feed');
    const discovery = { version: 1, audience: 'large', basis: 'lastfm-listeners', metricAsOf: null };
    const expectedByArtist = new Map([
      ['Мьюз', discovery],
      ['Small Artist', { version: 1, audience: 'small', basis: 'lastfm-listeners', metricAsOf: null }],
      ['Legacy row', unknownDiscovery]
    ]);
    for (const concert of concerts) assert.deepStrictEqual(concert.artistDiscovery, expectedByArtist.get(concert.artist));

    await publishArtistCatalog(artists, dir);
    const catalog = JSON.parse(await fs.readFile(path.join(dir, 'artists.json'), 'utf8'));
    assert.deepStrictEqual(catalog.find((entry: any) => entry.slug === 'мьюз').discovery, discovery);
    assert.deepStrictEqual(catalog.find((entry: any) => entry.slug === 'legacy-row').discovery, unknownDiscovery);

    await publishConcerts(concerts, dir);
    for (const file of [path.join(dir, 'concerts.json'), path.join(dir, 'cities', 'berlin.json'), path.join(dir, 'concerts', 'page-1.json')]) {
      const feed = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.strictEqual(feed.length, 3, `${path.basename(file)} must preserve every audience bucket`);
      for (const concert of feed) assert.deepStrictEqual(concert.artistDiscovery, expectedByArtist.get(concert.artist), `${path.basename(file)} must preserve artistDiscovery`);
    }
    for (const [artist, slug] of [['Мьюз', 'мьюз'], ['Small Artist', 'small-artist'], ['Legacy row', 'legacy-row']] as const) {
      const feed = JSON.parse(await fs.readFile(path.join(dir, 'artists', `${slug}.json`), 'utf8'));
      assert.strictEqual(feed.length, 1);
      assert.deepStrictEqual(feed[0].artistDiscovery, expectedByArtist.get(artist));
    }
  });
});
