import test from 'node:test';
import assert from 'node:assert';
import {
  mapBitEventToConcert,
  bandsintownCountryToCode,
  fetchBandsintownConcerts,
  BandsintownCache,
  BitFetchFn
} from '../src/engine/bandsintown.js';

function bitEvent(overrides: any = {}): any {
  return {
    starts_at: '2026-09-10T20:00:00',
    offers: [{ url: 'https://bandsintown.com/t/123' }],
    artist: { name: 'Metallica' },
    venue: { name: 'Sphere', city: 'Las Vegas', country: 'United States', latitude: '36.12', longitude: '-115.16' },
    ...overrides
  };
}

test('Bandsintown - country name -> ISO code (full names, aliases, already-a-code)', () => {
  assert.strictEqual(bandsintownCountryToCode('United States'), 'US');
  assert.strictEqual(bandsintownCountryToCode('Czechia'), 'CZ');
  assert.strictEqual(bandsintownCountryToCode('Japan'), 'JP');
  assert.strictEqual(bandsintownCountryToCode('Russia'), 'RU');
  assert.strictEqual(bandsintownCountryToCode('Turkey'), 'TR');
  assert.strictEqual(bandsintownCountryToCode('DE'), 'DE'); // already a code
  assert.strictEqual(bandsintownCountryToCode('Nowherestan'), null); // unmappable
  assert.strictEqual(bandsintownCountryToCode(undefined), null);
  // Native-script name (observed live for a Japan venue) must map, not slip through
  // as a bogus 2-glyph "code".
  assert.strictEqual(bandsintownCountryToCode('日本'), 'JP');
  assert.strictEqual(bandsintownCountryToCode('대한민국'), 'KR');
});

test('Bandsintown - mapBitEventToConcert prefers the queried name and slices the date', () => {
  const c = mapBitEventToConcert(bitEvent(), 'Metallica', '2026-07-08T00:00:00.000Z');
  assert.deepStrictEqual(c, {
    artist: 'Metallica',
    date: '2026-09-10',
    venue: 'Sphere',
    city: 'Las Vegas',
    country: 'US',
    lat: 36.12,
    lng: -115.16,
    ticketUrl: 'https://bandsintown.com/t/123',
    originalSource: 'bandsintown.com',
    scrapedAt: '2026-07-08T00:00:00.000Z'
  });
});

test('Bandsintown - mapBitEventToConcert rejects an event with an unmappable country', () => {
  const c = mapBitEventToConcert(bitEvent({ venue: { name: 'V', city: 'C', country: 'Nowherestan' } }), 'X', 'now');
  assert.strictEqual(c, null);
});

test('Bandsintown - mapBitEventToConcert rejects events missing required fields', () => {
  assert.strictEqual(mapBitEventToConcert(bitEvent({ starts_at: undefined, datetime: undefined }), 'X', 'now'), null);
  assert.strictEqual(mapBitEventToConcert(bitEvent({ venue: { city: 'C', country: 'US' } }), 'X', 'now'), null); // no venue name
});

test('Bandsintown - sweep fetches all artists and maps their events', async () => {
  const byArtist: Record<string, any[]> = {
    Metallica: [bitEvent({ venue: { name: 'V1', city: 'London', country: 'United Kingdom' } })],
    'Bi-2': [bitEvent({ artist: { name: 'Bi-2' }, venue: { name: 'V2', city: 'Jūrmala', country: 'Latvia' } })]
  };
  const fetchFn: BitFetchFn = async (artist) => byArtist[artist] || [];

  const cache: BandsintownCache = {};
  const concerts = await fetchBandsintownConcerts(['Metallica', 'Bi-2'], { cache, fetchFn, delayMs: 0 });

  assert.strictEqual(concerts.length, 2);
  assert.deepStrictEqual(concerts.map((c) => c.country).sort(), ['GB', 'LV']);
  // Both artists recorded in cache with their fetch timestamp.
  assert.ok(cache['Metallica'] && cache['Bi-2']);
});

test('Bandsintown - a fresh (recently fetched) artist is skipped but still contributes cached events', async () => {
  let calls = 0;
  const fetchFn: BitFetchFn = async () => { calls++; return [bitEvent()]; };

  const cache: BandsintownCache = {
    Metallica: {
      fetchedAt: new Date().toISOString(), // just now -> fresh
      concerts: [{ artist: 'Metallica', date: '2026-09-10', venue: 'Cached', city: 'X', country: 'US', originalSource: 'bandsintown.com', scrapedAt: 'now' }]
    }
  };

  const concerts = await fetchBandsintownConcerts(['Metallica'], { cache, fetchFn, delayMs: 0, freshnessDays: 6 });
  assert.strictEqual(calls, 0, 'a fresh artist must not be re-fetched');
  assert.strictEqual(concerts.length, 1);
  assert.strictEqual(concerts[0].venue, 'Cached');
});

test('Bandsintown - per-run cap batches the work, stalest-first, leaving the rest cached', async () => {
  const fetchFn: BitFetchFn = async (artist) => [bitEvent({ artist: { name: artist }, venue: { name: `V-${artist}`, city: 'C', country: 'US' } })];

  // B already has an old cache entry; A and C are never-fetched (higher priority).
  const cache: BandsintownCache = {
    B: { fetchedAt: '2020-01-01T00:00:00.000Z', concerts: [] }
  };

  const concerts = await fetchBandsintownConcerts(['A', 'B', 'C'], { cache, fetchFn, delayMs: 0, maxPerRun: 2 });

  // Only 2 fetched this run (A and C, the never-fetched ones), B deferred to next run.
  const fetchedThisRun = Object.entries(cache).filter(([, v]) => v.fetchedAt !== '2020-01-01T00:00:00.000Z');
  assert.strictEqual(fetchedThisRun.length, 2);
  assert.ok(concerts.length >= 2);
});

test('Bandsintown - a 404 is recorded as empty (not a block) and does not stop the sweep', async () => {
  const fetchFn: BitFetchFn = async (artist) => {
    if (artist === 'Unknown') { const e: any = new Error('not found'); e.response = { status: 404 }; throw e; }
    return [bitEvent({ artist: { name: artist }, venue: { name: 'V', city: 'C', country: 'US' } })];
  };
  const cache: BandsintownCache = {};
  const concerts = await fetchBandsintownConcerts(['Unknown', 'Metallica'], { cache, fetchFn, delayMs: 0 });

  assert.deepStrictEqual(cache['Unknown'].concerts, []);
  assert.ok(cache['Metallica'].concerts.length === 1, 'the sweep continues past a 404');
  assert.strictEqual(concerts.length, 1);
});

test('Bandsintown - a cluster of 401s (unresolvable names) does NOT trip the block guard', async () => {
  // Real regression: a run of never-fetched niche names (odd punctuation) all 401'd
  // consecutively and wrongly halted the whole sweep. 401 = "no data for this name",
  // not throttling, so it must behave like 404: skip-empty and keep going.
  let goodFetched = false;
  const fetchFn: BitFetchFn = async (artist) => {
    if (artist.startsWith('bad')) { const e: any = new Error('unauthorized'); e.response = { status: 401 }; throw e; }
    goodFetched = true;
    return [bitEvent({ artist: { name: artist }, venue: { name: 'V', city: 'C', country: 'US' } })];
  };
  const cache: BandsintownCache = {};
  // 6 consecutive 401s (> the 5-streak limit) followed by a real artist.
  const artists = ['bad1', 'bad2', 'bad3', 'bad4', 'bad5', 'bad6', 'Metallica'];
  const concerts = await fetchBandsintownConcerts(artists, { cache, fetchFn, delayMs: 0 });

  assert.ok(goodFetched, 'the sweep must reach the real artist after the 401 cluster');
  assert.strictEqual(cache['Metallica'].concerts.length, 1);
  assert.strictEqual(concerts.length, 1);
});

test('Bandsintown - a sustained failure streak stops the sweep (likely a block)', async () => {
  let calls = 0;
  const fetchFn: BitFetchFn = async () => { calls++; const e: any = new Error('rate limited'); e.response = { status: 429 }; throw e; };

  const cache: BandsintownCache = {};
  const artists = Array.from({ length: 20 }, (_, i) => `Artist ${i}`);
  await fetchBandsintownConcerts(artists, { cache, fetchFn, delayMs: 0 });

  // Stops at the 5-consecutive-failure limit rather than grinding all 20.
  assert.strictEqual(calls, 5, `expected to stop after 5 consecutive 429s, made ${calls} calls`);
});
