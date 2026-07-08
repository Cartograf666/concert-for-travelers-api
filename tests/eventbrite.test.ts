import test from 'node:test';
import assert from 'node:assert';
import {
  mapEbResultToConcert,
  extractEbServerData,
  fetchEventbriteConcerts,
  EventbriteCache,
  EbFetchFn
} from '../src/engine/eventbrite.js';

function ebResult(overrides: any = {}): any {
  return {
    name: 'Metallica Live in Chicago',
    url: 'https://www.eventbrite.com/e/metallica-live-in-chicago-tickets-123',
    start_date: '2026-09-10',
    start_time: '20:00:00',
    is_online_event: false,
    primary_venue: {
      name: 'United Center',
      address: { city: 'Chicago', country: 'US', latitude: '41.88', longitude: '-87.67' }
    },
    ...overrides
  };
}

test('Eventbrite - extractEbServerData parses the embedded window.__SERVER_DATA__ blob', () => {
  const html = `<html><script>window.__SERVER_DATA__ = {"a":1,"b":[2,3]};\n</script></html>`;
  assert.deepStrictEqual(extractEbServerData(html), { a: 1, b: [2, 3] });
});

test('Eventbrite - extractEbServerData returns null when the blob is missing or malformed', () => {
  assert.strictEqual(extractEbServerData('<html>no data here</html>'), null);
  assert.strictEqual(extractEbServerData('window.__SERVER_DATA__ = {not valid json};\n'), null);
});

test('Eventbrite - mapEbResultToConcert accepts a result whose title leads with the queried artist', () => {
  const c = mapEbResultToConcert(ebResult(), 'Metallica', '2026-07-08T00:00:00.000Z');
  assert.deepStrictEqual(c, {
    artist: 'Metallica Live in Chicago',
    date: '2026-09-10',
    startTime: '20:00',
    venue: 'United Center',
    city: 'Chicago',
    country: 'US',
    lat: 41.88,
    lng: -87.67,
    ticketUrl: 'https://www.eventbrite.com/e/metallica-live-in-chicago-tickets-123',
    originalSource: 'eventbrite.com',
    scrapedAt: '2026-07-08T00:00:00.000Z'
  });
});

test('Eventbrite - mapEbResultToConcert rejects a result whose title does not lead with the queried artist (noisy full-text search)', () => {
  // Real observed case: a "Dropkick Murphys" query surfaced this via loose
  // full-text matching on the word "Murphy".
  const c = mapEbResultToConcert(ebResult({ name: 'Kevin Murphy Hair Styling Workshop' }), 'Dropkick Murphys', 'now');
  assert.strictEqual(c, null);
});

test('Eventbrite - mapEbResultToConcert rejects a title that only mentions the artist mid-string', () => {
  const c = mapEbResultToConcert(ebResult({ name: 'Rock Night ft. Metallica and AC/DC covers' }), 'Metallica', 'now');
  assert.strictEqual(c, null);
});

test('Eventbrite - mapEbResultToConcert still lets a leading-but-tributed title through to the shared filter (raw title preserved)', () => {
  // This function itself doesn't reject "tribute" text -- that's process.ts's job
  // (matchApprovedArtist's whole-word cover/tribute filter). Confirm the raw,
  // untouched title is what gets passed through as `artist`.
  const c = mapEbResultToConcert(ebResult({ name: 'Metallica Tribute by Battery with Blaine Luis' }), 'Metallica', 'now');
  assert.strictEqual(c?.artist, 'Metallica Tribute by Battery with Blaine Luis');
});

test('Eventbrite - mapEbResultToConcert rejects an online-only event', () => {
  const c = mapEbResultToConcert(ebResult({ is_online_event: true }), 'Metallica', 'now');
  assert.strictEqual(c, null);
});

test('Eventbrite - mapEbResultToConcert rejects a result missing required venue/date fields', () => {
  assert.strictEqual(mapEbResultToConcert(ebResult({ start_date: undefined }), 'Metallica', 'now'), null);
  assert.strictEqual(mapEbResultToConcert(ebResult({ primary_venue: null }), 'Metallica', 'now'), null);
  assert.strictEqual(mapEbResultToConcert(ebResult({ primary_venue: { name: 'V', address: { country: 'US' } } }), 'Metallica', 'now'), null); // no city
});

test('Eventbrite - sweep fetches all artists and maps their events', async () => {
  const byArtist: Record<string, any[]> = {
    Metallica: [ebResult()],
    'Bi-2': [ebResult({ name: 'Bi-2 Live', primary_venue: { name: 'V2', address: { city: 'Riga', country: 'LV' } } })]
  };
  const fetchFn: EbFetchFn = async (artist) => byArtist[artist] || [];

  const cache: EventbriteCache = {};
  const concerts = await fetchEventbriteConcerts(['Metallica', 'Bi-2'], { cache, fetchFn, delayMs: 0 });

  assert.strictEqual(concerts.length, 2);
  assert.deepStrictEqual(concerts.map((c) => c.country).sort(), ['LV', 'US']);
  assert.ok(cache['Metallica'] && cache['Bi-2']);
});

test('Eventbrite - a fresh (recently fetched) artist is skipped but still contributes cached events', async () => {
  let calls = 0;
  const fetchFn: EbFetchFn = async () => { calls++; return [ebResult()]; };

  const cache: EventbriteCache = {
    Metallica: {
      fetchedAt: new Date().toISOString(),
      concerts: [{ artist: 'Metallica Live', date: '2026-09-10', venue: 'Cached', city: 'X', country: 'US', originalSource: 'eventbrite.com', scrapedAt: 'now' }]
    }
  };

  const concerts = await fetchEventbriteConcerts(['Metallica'], { cache, fetchFn, delayMs: 0, freshnessDays: 6 });
  assert.strictEqual(calls, 0, 'a fresh artist must not be re-fetched');
  assert.strictEqual(concerts.length, 1);
  assert.strictEqual(concerts[0].venue, 'Cached');
});

test('Eventbrite - per-run cap batches the work, stalest-first, leaving the rest cached', async () => {
  const fetchFn: EbFetchFn = async (artist) => [ebResult({ name: `${artist} Live`, primary_venue: { name: `V-${artist}`, address: { city: 'C', country: 'US' } } })];

  const cache: EventbriteCache = {
    B: { fetchedAt: '2020-01-01T00:00:00.000Z', concerts: [] }
  };

  const concerts = await fetchEventbriteConcerts(['A', 'B', 'C'], { cache, fetchFn, delayMs: 0, maxPerRun: 2 });

  const fetchedThisRun = Object.entries(cache).filter(([, v]) => v.fetchedAt !== '2020-01-01T00:00:00.000Z');
  assert.strictEqual(fetchedThisRun.length, 2);
  assert.ok(concerts.length >= 2);
});

test('Eventbrite - a sustained failure streak stops the sweep (likely a block)', async () => {
  let calls = 0;
  const fetchFn: EbFetchFn = async () => { calls++; const e: any = new Error('rate limited'); e.response = { status: 429 }; throw e; };

  const cache: EventbriteCache = {};
  const artists = Array.from({ length: 20 }, (_, i) => `Artist ${i}`);
  await fetchEventbriteConcerts(artists, { cache, fetchFn, delayMs: 0 });

  assert.strictEqual(calls, 5, `expected to stop after 5 consecutive failures, made ${calls} calls`);
});

test('Eventbrite - a page-parse failure (blocked/changed structure) counts toward the block streak, not a silent empty result', async () => {
  let calls = 0;
  const fetchFn: EbFetchFn = async () => { calls++; throw new Error('Could not find/parse window.__SERVER_DATA__ in the Eventbrite response.'); };

  const cache: EventbriteCache = {};
  const artists = Array.from({ length: 20 }, (_, i) => `Artist ${i}`);
  await fetchEventbriteConcerts(artists, { cache, fetchFn, delayMs: 0 });

  assert.strictEqual(calls, 5);
});
