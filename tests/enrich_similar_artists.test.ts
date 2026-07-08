import test from 'node:test';
import assert from 'node:assert';
import { lastfmSimilarArtists, resolveSimilarArtists } from '../src/scripts/enrich_similar_artists.js';
import { normName } from '../src/scripts/enrich_wikidata_bulk.js';

function fakeFetch(status: number, body: any): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })) as any;
}

test('Last.fm getsimilar - parses name/match pairs in the order returned', async () => {
  const fetchFn = fakeFetch(200, {
    similarartists: {
      artist: [
        { name: 'Muse', match: '1' },
        { name: 'Radiohead', match: '0.87234' },
        { name: 'Coldplay', match: '0.5' }
      ]
    }
  });
  const result = await lastfmSimilarArtists('Placebo', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.candidates, [
    { name: 'Muse', match: 1 },
    { name: 'Radiohead', match: 0.87234 },
    { name: 'Coldplay', match: 0.5 }
  ]);
});

test('Last.fm getsimilar - error code 6 (artist not found) is a clean miss, not a failure', async () => {
  const fetchFn = fakeFetch(200, { error: 6, message: 'The artist you supplied could not be found' });
  const result = await lastfmSimilarArtists('Some Unknown Artist', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.candidates, undefined);
});

test('Last.fm getsimilar - rate-limit error (29) is treated as unreachable so it is retried later', async () => {
  const fetchFn = fakeFetch(200, { error: 29, message: 'Rate limit exceeded' });
  const result = await lastfmSimilarArtists('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, false);
});

test('Last.fm getsimilar - a network/HTTP error (non-400/404) is treated as unreachable', async () => {
  const fetchFn = fakeFetch(500, {});
  const result = await lastfmSimilarArtists('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, false);
});

test('Last.fm getsimilar - malformed/missing artist list yields ok with no candidates', async () => {
  const fetchFn = fakeFetch(200, { similarartists: {} });
  const result = await lastfmSimilarArtists('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.candidates, undefined);
});

function byName(names: string[]): Map<string, { name: string; slug: string }> {
  return new Map(names.map((name) => [normName(name), { name, slug: name.toLowerCase().replace(/\s+/g, '-') }]));
}

test('resolveSimilarArtists - keeps only candidates present in our own whitelist, preserving order', () => {
  const map = byName(['Muse', 'Radiohead']);
  const candidates = [
    { name: 'Muse', match: 1 },
    { name: 'Some Obscure Band Not In Our DB', match: 0.9 },
    { name: 'Radiohead', match: 0.8 }
  ];
  const resolved = resolveSimilarArtists(candidates, map, normName('Placebo'), 10);
  assert.deepStrictEqual(resolved, [
    { name: 'Muse', slug: 'muse', match: 1 },
    { name: 'Radiohead', slug: 'radiohead', match: 0.8 }
  ]);
});

test('resolveSimilarArtists - never lists an artist as similar to itself', () => {
  const map = byName(['Muse']);
  const candidates = [{ name: 'Muse', match: 1 }];
  const resolved = resolveSimilarArtists(candidates, map, normName('Muse'), 10);
  assert.deepStrictEqual(resolved, []);
});

test('resolveSimilarArtists - caps at max, keeping the highest-match (first) entries', () => {
  const map = byName(['A', 'B', 'C']);
  const candidates = [
    { name: 'A', match: 0.9 },
    { name: 'B', match: 0.8 },
    { name: 'C', match: 0.7 }
  ];
  const resolved = resolveSimilarArtists(candidates, map, normName('X'), 2);
  assert.strictEqual(resolved.length, 2);
  assert.deepStrictEqual(resolved.map((r) => r.name), ['A', 'B']);
});

test('resolveSimilarArtists - is case/normalization-insensitive on both sides', () => {
  const map = byName(['AC/DC']);
  const candidates = [{ name: 'ac dc', match: 0.5 }];
  const resolved = resolveSimilarArtists(candidates, map, normName('Nothing'), 10);
  assert.deepStrictEqual(resolved, [{ name: 'AC/DC', slug: 'ac/dc', match: 0.5 }]);
});
