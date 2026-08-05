import test from 'node:test';
import assert from 'node:assert';
import { geocodeConcerts, geocodeCacheKey, GeocodeCache, GeocodeFn } from '../src/pipeline/geocode.js';
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

test('Geocode - fills lat/lng for a concert missing them, via the injected geocode function', async () => {
  const concerts = [makeConcert({ lat: undefined, lng: undefined })];
  const calls: string[] = [];
  const geocodeFn: GeocodeFn = async (query) => {
    calls.push(query);
    return { lat: 52.52, lng: 13.405 };
  };

  const stats = await geocodeConcerts(concerts, { geocodeFn, delayMs: 0 });

  assert.strictEqual(concerts[0].lat, 52.52);
  assert.strictEqual(concerts[0].lng, 13.405);
  assert.strictEqual(stats.geocoded, 1);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], 'Club Arena, Berlin, DE');
});

test('Geocode - leaves an already-geocoded concert (e.g. from Ticketmaster) untouched, no lookup issued', async () => {
  const concerts = [makeConcert({ lat: 1, lng: 2 })];
  let called = false;
  const geocodeFn: GeocodeFn = async () => { called = true; return { lat: 99, lng: 99 }; };

  const stats = await geocodeConcerts(concerts, { geocodeFn, delayMs: 0 });

  assert.strictEqual(concerts[0].lat, 1);
  assert.strictEqual(concerts[0].lng, 2);
  assert.strictEqual(called, false);
  assert.strictEqual(stats.attempted, 0);
});

test('Geocode - two concerts at the same venue only issue one lookup (shared cache key)', async () => {
  const concerts = [
    makeConcert({ venue: 'Paradiso', city: 'Amsterdam', country: 'NL' }),
    makeConcert({ venue: 'Paradiso', city: 'Amsterdam', country: 'NL', artist: 'Rammstein' }),
    makeConcert({ venue: 'paradiso', city: ' Amsterdam ', country: 'nl' }) // case/whitespace variant, same key
  ];
  let callCount = 0;
  const geocodeFn: GeocodeFn = async () => { callCount++; return { lat: 52.36, lng: 4.88 }; };

  const stats = await geocodeConcerts(concerts, { geocodeFn, delayMs: 0 });

  assert.strictEqual(callCount, 1, 'only one real lookup for three concerts sharing the same venue/city/country');
  assert.strictEqual(stats.attempted, 1);
  assert.strictEqual(stats.filledFromCache, 2);
  for (const c of concerts) {
    assert.strictEqual(c.lat, 52.36);
    assert.strictEqual(c.lng, 4.88);
  }
});

test('Geocode - a persistent cache hit from a prior run skips the network call entirely', async () => {
  const concerts = [makeConcert({})];
  const cache: GeocodeCache = {
    [geocodeCacheKey(concerts[0])]: { lat: 10, lng: 20, geocodedAt: '2026-01-01T00:00:00.000Z' }
  };
  let called = false;
  const geocodeFn: GeocodeFn = async () => { called = true; return { lat: 0, lng: 0 }; };

  const stats = await geocodeConcerts(concerts, { cache, geocodeFn, delayMs: 0 });

  assert.strictEqual(called, false);
  assert.strictEqual(concerts[0].lat, 10);
  assert.strictEqual(concerts[0].lng, 20);
  assert.strictEqual(stats.filledFromCache, 1);
});

test('Geocode - a known-unresolvable venue (cached as null) is not retried every run and stays ungeocoded', async () => {
  const concerts = [makeConcert({})];
  const cache: GeocodeCache = {
    [geocodeCacheKey(concerts[0])]: { lat: null, lng: null, geocodedAt: '2026-01-01T00:00:00.000Z' }
  };
  let called = false;
  const geocodeFn: GeocodeFn = async () => { called = true; return { lat: 1, lng: 1 }; };

  await geocodeConcerts(concerts, { cache, geocodeFn, delayMs: 0 });

  assert.strictEqual(called, false);
  assert.strictEqual(concerts[0].lat, undefined);
  assert.strictEqual(concerts[0].lng, undefined);
});

test('Geocode - a failed lookup is not cached, so a transient error is retried next run', async () => {
  const concerts = [makeConcert({})];
  const cache: GeocodeCache = {};
  const geocodeFn: GeocodeFn = async () => { throw new Error('network blip'); };

  const stats = await geocodeConcerts(concerts, { cache, geocodeFn, delayMs: 0 });

  assert.strictEqual(stats.failed, 1);
  assert.strictEqual(cache[geocodeCacheKey(concerts[0])], undefined, 'transient failure must not be cached');
});

test('Geocode - a lookup with no result is cached as null (not retried) but a network error is not', async () => {
  const concerts = [makeConcert({ venue: 'Nowhere Hall' })];
  const cache: GeocodeCache = {};
  const geocodeFn: GeocodeFn = async () => null;

  const stats = await geocodeConcerts(concerts, { cache, geocodeFn, delayMs: 0 });

  assert.strictEqual(stats.failed, 1);
  const key = geocodeCacheKey(concerts[0]);
  assert.strictEqual(cache[key].lat, null);
  assert.strictEqual(cache[key].lng, null);
});

test('Geocode - respects the per-run cap, deferring the rest to a future run instead of blocking', async () => {
  const concerts = [
    makeConcert({ venue: 'Venue A' }),
    makeConcert({ venue: 'Venue B' }),
    makeConcert({ venue: 'Venue C' })
  ];
  let callCount = 0;
  const geocodeFn: GeocodeFn = async () => { callCount++; return { lat: 1, lng: 1 }; };

  const stats = await geocodeConcerts(concerts, { geocodeFn, delayMs: 0, maxPerRun: 2 });

  assert.strictEqual(callCount, 2);
  assert.strictEqual(stats.geocoded, 2);
  assert.strictEqual(stats.skippedCapped, 1);
  assert.strictEqual(concerts.filter((c) => c.lat !== undefined).length, 2);
});

test('an unreadable city is replaced with Nominatim\'s English name', async () => {
  const concerts = [makeConcert({ city: '東京', venue: 'Zepp Tokyo', lat: undefined, lng: undefined })];
  const geocodeFn: GeocodeFn = async () => ({ lat: 35.68, lng: 139.76, cityEn: 'Tokyo' });
  const cache: GeocodeCache = {};

  const stats = await geocodeConcerts(concerts, { geocodeFn, cache, delayMs: 0 });

  assert.equal(concerts[0].city, 'Tokyo');
  assert.equal(stats.cityTranslated, 1);
  assert.equal(Object.values(cache)[0].cityEn, 'Tokyo');
});

test('a city already readable is never overwritten, even by a different answer', async () => {
  // Nominatim commonly answers with a ward or suburb ("Shibuya City"); replacing a
  // good city name with a narrower one would be a downgrade, not a translation.
  const concerts = [makeConcert({ city: 'Tokyo', lat: undefined, lng: undefined })];
  const geocodeFn: GeocodeFn = async () => ({ lat: 35.68, lng: 139.76, cityEn: 'Shibuya City' });

  const stats = await geocodeConcerts(concerts, { geocodeFn, delayMs: 0 });

  assert.equal(concerts[0].city, 'Tokyo');
  assert.equal(stats.cityTranslated, 0);
});

test('an unreadable city is looked up even when coordinates are already known', async () => {
  // Most concerts carry lat/lng from their scraper config, so a coords-only guard
  // would never offer those an English name.
  const concerts = [makeConcert({ city: '東京', lat: 35.68, lng: 139.76 })];
  let called = 0;
  const geocodeFn: GeocodeFn = async () => { called++; return { lat: 35.68, lng: 139.76, cityEn: 'Tokyo' }; };

  await geocodeConcerts(concerts, { geocodeFn, delayMs: 0 });

  assert.equal(called, 1);
  assert.equal(concerts[0].city, 'Tokyo');
});

test('Nominatim answering in the local script is not treated as a translation', async () => {
  const concerts = [makeConcert({ city: '東京', lat: undefined, lng: undefined })];
  const geocodeFn: GeocodeFn = async () => ({ lat: 35.68, lng: 139.76, cityEn: '東京都' });

  const stats = await geocodeConcerts(concerts, { geocodeFn, delayMs: 0 });

  assert.equal(concerts[0].city, '東京', 'unreadable in, unreadable out -- but not silently swapped');
  assert.equal(stats.cityTranslated, 0);
});

test('a cached null cityEn is not re-queried every run', async () => {
  const concerts = [makeConcert({ city: '東京', lat: 35.68, lng: 139.76 })];
  const cache: GeocodeCache = {
    [geocodeCacheKey(concerts[0])]: { lat: 35.68, lng: 139.76, geocodedAt: '2026-01-01T00:00:00Z', cityEn: null }
  };
  let called = 0;
  const geocodeFn: GeocodeFn = async () => { called++; return { lat: 1, lng: 2, cityEn: 'Tokyo' }; };

  await geocodeConcerts(concerts, { geocodeFn, cache, delayMs: 0 });

  assert.equal(called, 0, 'Nominatim already said it has no English name for this point');
});
