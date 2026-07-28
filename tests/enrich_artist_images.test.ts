import test from 'node:test';
import assert from 'node:assert';
import {
  buildMbidImageQuery,
  queryImagesByMbid,
  audioDbArtistImage,
  selectPendingImageArtists
} from '../src/scripts/enrich_artist_images.js';
import { ArtistEntry } from '../src/schemas/artist.js';

function fakeFetch(status: number, body: any): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  })) as any;
}

test('buildMbidImageQuery embeds every mbid as a VALUES literal', () => {
  const q = buildMbidImageQuery(['abc-123', 'def-456']);
  assert.match(q, /VALUES \?mbid \{ "abc-123" "def-456" \}/);
  assert.match(q, /wdt:P434 \?mbid/);
  assert.match(q, /wdt:P18 \?image/);
});

test('queryImagesByMbid - parses P18 bindings keyed by mbid, upgrades http to https', async () => {
  const fetchFn = fakeFetch(200, {
    results: {
      bindings: [
        { mbid: { value: 'abc-123' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Muse.jpg' } }
      ]
    }
  });
  const result = await queryImagesByMbid(['abc-123'], fetchFn);
  assert.strictEqual(result.get('abc-123'), 'https://commons.wikimedia.org/wiki/Special:FilePath/Muse.jpg');
});

test('queryImagesByMbid - an empty mbid list short-circuits with no fetch', async () => {
  let called = false;
  const fetchFn = (async () => { called = true; return { ok: true, json: async () => ({}) }; }) as any;
  const result = await queryImagesByMbid([], fetchFn);
  assert.strictEqual(result.size, 0);
  assert.strictEqual(called, false);
});

test('queryImagesByMbid - a non-retryable HTTP error throws immediately', async () => {
  const fetchFn = fakeFetch(400, {});
  await assert.rejects(() => queryImagesByMbid(['abc-123'], fetchFn));
});

test('TheAudioDB - returns an image on a confident (exact normalized) name match', async () => {
  const fetchFn = fakeFetch(200, {
    artists: [{ strArtist: 'Muse', strArtistThumb: 'https://cdn.example/muse-thumb.jpg' }]
  });
  const result = await audioDbArtistImage('Muse', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.image, 'https://cdn.example/muse-thumb.jpg');
});

test('TheAudioDB - falls back to fanart/logo when thumb is absent', async () => {
  const fetchFn = fakeFetch(200, {
    artists: [{ strArtist: 'Muse', strArtistFanart: 'https://cdn.example/muse-fanart.jpg' }]
  });
  const result = await audioDbArtistImage('Muse', fetchFn);
  assert.strictEqual(result.image, 'https://cdn.example/muse-fanart.jpg');
});

test('TheAudioDB - a mismatched top result yields no image, not a wrong one', async () => {
  const fetchFn = fakeFetch(200, { artists: [{ strArtist: 'Muse Tribute Band', strArtistThumb: 'https://cdn.example/wrong.jpg' }] });
  const result = await audioDbArtistImage('Muse', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.image, undefined);
});

test('TheAudioDB - no results (null artists) is a clean ok/no-image, not an error', async () => {
  const fetchFn = fakeFetch(200, { artists: null });
  const result = await audioDbArtistImage('Some Totally Obscure Act', fetchFn);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.image, undefined);
});

test('TheAudioDB - an HTTP failure is treated as unreachable (retried later)', async () => {
  const fetchFn = fakeFetch(503, {});
  const result = await audioDbArtistImage('Muse', fetchFn);
  assert.strictEqual(result.ok, false);
});

test('selectPendingImageArtists - only artists with no image and no tried marker are selected', () => {
  const artists: ArtistEntry[] = [
    { name: 'Needs Image' },
    { name: 'Already Has Image', image: 'https://cdn.example/a.jpg' },
    { name: 'Already Tried Miss', imageFallbackTriedAt: '2026-07-08T12:00:00.000Z' },
    { name: 'Already Tried Hit', image: 'https://cdn.example/b.jpg', imageFallbackTriedAt: '2026-07-08T12:00:00.000Z' }
  ];
  const pending = selectPendingImageArtists(artists, 10);
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].name, 'Needs Image');
});

test('selectPendingImageArtists - respects the n cap', () => {
  const artists: ArtistEntry[] = Array.from({ length: 5 }, (_, i) => ({ name: `Artist ${i}` }));
  assert.strictEqual(selectPendingImageArtists(artists, 2).length, 2);
});
