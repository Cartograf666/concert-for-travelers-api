import test from 'node:test';
import assert from 'node:assert';
import { lastfmArtistInfo, deezerArtistImage } from '../src/scripts/enrich_metadata.js';

function fakeFetch(status: number, body: any): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })) as any;
}

test('Last.fm - parses genres (top tags) and popularity (listeners/playcount) from one call', async () => {
  const fetchFn = fakeFetch(200, {
    artist: {
      name: 'Muse',
      stats: { listeners: '4500000', playcount: '900000000' },
      tags: { tag: [{ name: 'rock' }, { name: 'alternative' }, { name: 'space rock' }] }
    }
  });

  const result = await lastfmArtistInfo('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.genres, ['rock', 'alternative', 'space rock']);
  assert.deepStrictEqual(result.popularity, { listeners: 4500000, playcount: 900000000 });
});

test('Last.fm - caps genres at 5 tags', async () => {
  const fetchFn = fakeFetch(200, {
    artist: {
      name: 'Muse',
      tags: { tag: Array.from({ length: 8 }, (_, i) => ({ name: `tag${i}` })) }
    }
  });
  const result = await lastfmArtistInfo('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.genres?.length, 5);
});

test('Last.fm - error code 6 (artist not found) is a clean miss, not a failure', async () => {
  const fetchFn = fakeFetch(200, { error: 6, message: 'The artist you supplied could not be found' });
  const result = await lastfmArtistInfo('Some Unknown Artist', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.genres, undefined);
  assert.strictEqual(result.popularity, undefined);
});

test('Last.fm - rate-limit error (29) is treated as unreachable so it is retried later', async () => {
  const fetchFn = fakeFetch(200, { error: 29, message: 'Rate limit exceeded' });
  const result = await lastfmArtistInfo('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, false);
});

test('Last.fm - a network/HTTP error (non-400/404) is treated as unreachable', async () => {
  const fetchFn = fakeFetch(500, {});
  const result = await lastfmArtistInfo('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, false);
});

test('Last.fm - an artist with no tags/stats yields ok with nothing to contribute', async () => {
  const fetchFn = fakeFetch(200, { artist: { name: 'Muse' } });
  const result = await lastfmArtistInfo('Muse', 'fake-key', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.genres, undefined);
  assert.strictEqual(result.popularity, undefined);
});

test('Deezer - returns an image on a confident (exact normalized) name match', async () => {
  const fetchFn = fakeFetch(200, {
    data: [{ name: 'Muse', picture_medium: 'https://cdn.example/muse-medium.jpg', picture_small: 'https://cdn.example/muse-small.jpg' }]
  });
  const result = await deezerArtistImage('Muse', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.image, 'https://cdn.example/muse-medium.jpg');
});

test('Deezer - a mismatched top result (search returned something else) yields no image, not a wrong one', async () => {
  const fetchFn = fakeFetch(200, { data: [{ name: 'Muse Tribute Band', picture_medium: 'https://cdn.example/wrong.jpg' }] });
  const result = await deezerArtistImage('Muse', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.image, undefined);
});

test('Deezer - no results is a clean ok/no-image, not an error', async () => {
  const fetchFn = fakeFetch(200, { data: [] });
  const result = await deezerArtistImage('Some Totally Obscure Act', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.image, undefined);
});

test('Deezer - an HTTP failure is treated as unreachable (retried later)', async () => {
  const fetchFn = fakeFetch(503, {});
  const result = await deezerArtistImage('Muse', fetchFn);
  assert.strictEqual(result.ok, false);
});
