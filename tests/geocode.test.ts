import test from 'node:test';
import assert from 'node:assert';
import { geocodeConcerts, geocodeCacheKey, GeocodeCache, GeocodeFn, mergeGeocodeCaches, NOMINATIM_RATE_LIMIT_MS, parseNominatimResponse } from '../src/pipeline/geocode.js';
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

test('Geocode - a failed lookup is persisted as retryable, so a transient error is retried next run', async () => {
  const concerts = [makeConcert({})];
  const cache: GeocodeCache = {};
  const geocodeFn: GeocodeFn = async () => { throw new Error('network blip'); };

  const stats = await geocodeConcerts(concerts, { cache, geocodeFn, delayMs: 0 });

  assert.strictEqual(stats.failed, 1);
  assert.equal(cache[geocodeCacheKey(concerts[0])].retryable, true, 'transient failure must remain retryable');
  assert.equal(cache[geocodeCacheKey(concerts[0])].geocodedAt, undefined);
  const retry = [makeConcert({})];
  let retried = 0;
  await geocodeConcerts(retry, { cache, delayMs: 0, geocodeFn: async () => { retried++; return { lat: 1, lng: 2 }; } });
  assert.equal(retried, 1);
  assert.equal(cache[geocodeCacheKey(retry[0])].retryable, undefined);
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

test('maxPerRun zero is cache-only and does not call an injected transport', async () => {
  const concerts = [makeConcert({})];
  let called = 0;
  const stats = await geocodeConcerts(concerts, { maxPerRun: 0, geocodeFn: async () => { called++; return { lat: 1, lng: 2 }; } });
  assert.equal(called, 0);
  assert.equal(stats.attempted, 0);
  assert.equal(stats.skippedCapped, 1);
});

test('transient failures are deduplicated within a run and persisted as retryable', async () => {
  const concerts = [makeConcert({}), makeConcert({ artist: 'Other' })];
  const cache: GeocodeCache = {};
  let calls = 0;
  await geocodeConcerts(concerts, { cache, delayMs: 0, geocodeFn: async () => { calls++; throw new Error('temporary'); } });
  assert.equal(calls, 1);
  assert.equal(cache[geocodeCacheKey(concerts[0])].retryable, true);
});

test('city translation lookup retains source coordinates and applies legacy cache coordinates first', async () => {
  const concert = makeConcert({ city: '東京', lat: 1, lng: 2 });
  const stats = await geocodeConcerts([concert], { delayMs: 0, geocodeFn: async () => ({ lat: 35.68, lng: 139.76, cityEn: 'Tokyo' }) });
  assert.equal(concert.lat, 1);
  assert.equal(concert.lng, 2);
  assert.equal(concert.city, 'Tokyo');
  assert.equal(stats.cityTranslated, 1);

  const cachedConcert = makeConcert({ city: '東京' });
  const cache: GeocodeCache = { [geocodeCacheKey(cachedConcert)]: { lat: 35.68, lng: 139.76, geocodedAt: '2026-01-01T00:00:00Z' } };
  await geocodeConcerts([cachedConcert], { cache, delayMs: 0, geocodeFn: async () => ({ lat: 99, lng: 99, cityEn: 'Tokyo' }) });
  assert.equal(cachedConcert.lat, 35.68);
  assert.equal(cachedConcert.lng, 139.76);
});

test('a lookup fills only the absent source coordinate', async () => {
  const latitudeOnly = makeConcert({ lat: 52.52, lng: undefined });
  const longitudeOnly = makeConcert({ lat: undefined, lng: 13.405, venue: 'Other' });
  await geocodeConcerts([latitudeOnly, longitudeOnly], { delayMs: 0, geocodeFn: async () => ({ lat: 1, lng: 2 }) });
  assert.equal(latitudeOnly.lat, 52.52);
  assert.equal(latitudeOnly.lng, 2);
  assert.equal(longitudeOnly.lat, 1);
  assert.equal(longitudeOnly.lng, 13.405);
});

test('a no-result city retry preserves cached coordinates for the next cache-only run', async () => {
  const first = makeConcert({ city: '東京' });
  const cache: GeocodeCache = { [geocodeCacheKey(first)]: { lat: 35.68, lng: 139.76, geocodedAt: '2026-01-01T00:00:00Z' } };
  await geocodeConcerts([first], { cache, delayMs: 0, geocodeFn: async () => null });
  const second = makeConcert({ city: '東京' });
  let calls = 0;
  await geocodeConcerts([second], { cache, maxPerRun: 0, geocodeFn: async () => { calls++; return null; } });
  assert.equal(calls, 0);
  assert.equal(second.lat, 35.68);
  assert.equal(second.lng, 139.76);
});

test('cache-only mode applies a cached city translation even when source coordinates are authoritative', async () => {
  const concert = makeConcert({ city: '東京', lat: 1, lng: 2 });
  const rawKey = geocodeCacheKey(concert);
  const cache: GeocodeCache = { [rawKey]: { lat: 35.68, lng: 139.76, geocodedAt: '2026-01-01T00:00:00Z', cityEn: 'Tokyo' } };
  let called = 0;
  await geocodeConcerts([concert], { cache, maxPerRun: 0, geocodeFn: async () => { called++; return null; } });
  assert.equal(called, 0);
  assert.equal(concert.city, 'Tokyo');
  assert.equal(concert.lat, 1);
  assert.equal(concert.lng, 2);
});

test('only an empty Nominatim result is a durable miss', () => {
  assert.equal(parseNominatimResponse([]), null);
  assert.throws(() => parseNominatimResponse({}), /invalid Nominatim response/);
  assert.throws(() => parseNominatimResponse([{ lat: 'bad', lon: 1 }]), /invalid Nominatim response/);
  assert.throws(() => parseNominatimResponse([{ lat: null, lon: null }]), /invalid Nominatim response/);
});

test('primary/backup merge keeps Unicode keys, warmer primary, and an explicit terminal null city', () => {
  const key = 'ライブハウス|東京|jp';
  const backup: GeocodeCache = { [key]: { lat: 35, lng: 139, geocodedAt: '2026-01-01T00:00:00.000Z', cityEn: 'Tokyo' } };
  const primary: GeocodeCache = { [key]: { lat: 36, lng: 140, geocodedAt: '2026-02-01T00:00:00.000Z', cityEn: null } };
  const merged = mergeGeocodeCaches(primary, backup);
  assert.deepEqual(merged[key].lat, 36);
  assert.deepEqual(merged[key].cityEn, null);
});

test('retryable failures rotate behind never-attempted venues so a bounded queue advances', async () => {
  const concerts = Array.from({ length: 250 }, (_, index) => makeConcert({ venue: `Venue ${index}` }));
  const cache: GeocodeCache = {};
  const attempted = new Set<string>();
  let tick = 0;
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    for (let run = 0; run < 3; run++) {
      const stats = await geocodeConcerts(concerts, {
        cache, maxPerRun: 100, delayMs: 0,
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
        geocodeFn: async (query) => { attempted.add(query); throw new Error('temporary'); }
      });
      assert.equal(stats.attempted, 100);
    }
  } finally { console.warn = warn; }
  assert.equal(attempted.size, 250);
  assert.equal(Object.values(cache).every((entry) => entry.retryable === true), true);
});

test('the default regular Nominatim delay is at least 15.1 seconds', () => {
  assert.equal(NOMINATIM_RATE_LIMIT_MS >= 15_100, true);
});
