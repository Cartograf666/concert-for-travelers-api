import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import net from 'node:net';
import { normalizeLocation, canonicalCity, UNKNOWN_VENUE } from '../src/pipeline/location.js';
import { processConcerts } from '../src/pipeline/process.js';
import { geocodeConcerts, geocodeCacheKey, type GeocodeCache } from '../src/pipeline/geocode.js';
import { mapBitEventToConcert } from '../src/engine/bandsintown.js';
import { publishConcerts } from '../src/generator/publish.js';
import type { Concert } from '../src/schemas/concert.js';

const NOW = '2026-10-19T00:00:00.000Z';
function row(overrides: Partial<Concert> = {}): Concert {
  return { artist: 'Нервы', date: '2027-01-01', venue: 'Real Hall', city: 'Yerevan', country: 'AM',
    originalSource: 'bandsintown.com', scrapedAt: NOW, ...overrides };
}
const required = [
  row({ venue: 'NERVY IN YEREVAN', city: 'Երևան' }),
  row({ venue: 'NERVY IN TBILISI', city: "T'bilisi", country: 'GE' }),
  row({ venue: 'NERVY IN BATUMI', city: 'Batumi', country: 'GE' }),
  row({ venue: 'NERVY IN BELGRADE', city: 'Beograd', country: 'RS' }),
  row({ artist: 'MORGENSHTERN', venue: 'MORGENSHTERN | Limassol', city: 'Άγιος Τύχων', country: 'CY' }),
  ...['Krasnoyarsk', 'Novosibirsk', 'Bangkok'].map(city => row({ artist: 'Andru Donalds', venue: city, city,
    country: city === 'Bangkok' ? 'TH' : 'RU' }))
];
async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'location-normalization-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'approved.json');
  await fs.writeFile(db, JSON.stringify([{ name: 'Нервы', aliases: ['Nervy'] }, { name: 'Test Artist', aliases: ['Different Name'] },
    { name: 'MORGENSHTERN' }, { name: 'Andru Donalds' }]));
  return { dir, db };
}

test('native BIT → process → cache-only geocode → publisher retains all required rows and coordinates', async t => {
  const { dir, db } = await fixture(t);
  t.mock.method(net.Socket.prototype, 'connect', () => { throw new Error('Network forbidden'); });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network forbidden'); });
  const raw = required.map((r, i) => mapBitEventToConcert({ starts_at: `${r.date}T20:00:00`,
    venue: { name: r.venue, city: r.city, country: r.country, latitude: '10', longitude: '20' },
    url: `https://www.bandsintown.com/e/${i}` }, r.artist, NOW)!);
  assert.equal(raw.filter(Boolean).length, required.length, 'BIT must not discard title-shaped venues');
  const original = structuredClone(raw);
  const processed = await processConcerts(raw, db, NOW);
  assert.equal(processed.length, required.length);
  assert.deepEqual(raw, original, 'raw cache/provenance must remain untouched');
  await geocodeConcerts(processed, { maxPerRun: 0, geocodeFn: async () => { throw new Error('Network forbidden'); } });
  assert.ok(processed.every(r => r.venue === UNKNOWN_VENUE && r.lat === 10 && r.lng === 20));
  assert.deepEqual(processed.map(r => r.city), ['Yerevan', 'Tbilisi', 'Batumi', 'Belgrade', 'Agios Tychonas', 'Krasnoyarsk', 'Novosibirsk', 'Bangkok']);
  const out = path.join(dir, 'published');
  await publishConcerts(processed, out);
  const published: Concert[] = JSON.parse(await fs.readFile(path.join(out, 'concerts.json'), 'utf8'));
  assert.equal(published.length, required.length);
  assert.ok(published.every(r => r.venue === UNKNOWN_VENUE && r.lat === 10 && r.lng === 20));
  assert.equal(published.find(r => r.country === 'CY')?.city, 'Agios Tychonas');
  const again = await processConcerts(published, db, NOW);
  await geocodeConcerts(again, { maxPerRun: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(again)), published, 'public production output is idempotent');
});

test('finite country aliases and placeholder detection commute and are idempotent', () => {
  for (const r of required) {
    const aliases = r.artist === 'Нервы' ? ['Nervy'] : [];
    const result = normalizeLocation(r, aliases);
    assert.equal(result.venue, UNKNOWN_VENUE);
    assert.deepEqual(normalizeLocation(result, aliases), result);
    assert.deepEqual(normalizeLocation({ ...r, city: canonicalCity(r.city, r.country) }, aliases), result);
  }
  for (const [city, country, expected] of [
    ['Երևան', 'AM', 'Yerevan'], ["T'bilisi", 'GE', 'Tbilisi'], ['Beograd', 'RS', 'Belgrade'],
    ['Άγιος Τύχων', 'CY', 'Agios Tychonas'], ['Beograd', 'US', 'Beograd'], ['Երևան', 'GE', 'Երևան'],
    ["T'bilisi", 'AM', "T'bilisi"], ['Άγιος Τύχων', 'GR', 'Άγιος Τύχων'], ['Unverified City', 'CY', 'Unverified City']
  ]) assert.equal(canonicalCity(city, country), expected);
});

test('real venues, artist-name venues and unverified title suffixes remain intact', async t => {
  const { db } = await fixture(t);
  const real = [
    row({ venue: 'Belgrade Arena', city: 'Beograd', country: 'RS' }),
    row({ venue: 'Dubai Opera', city: 'Dubai', country: 'AE' }),
    row({ venue: 'NERVY', city: 'Batumi', country: 'GE' }),
    row({ venue: 'NERVY IN YEREVAN Arena' }), row({ venue: 'NERVY IN Unknownville' }),
    row({ venue: 'NERVY | Real Hall' }), row({ venue: 'NERVY IN YEREVAN', originalSource: 'real.example' }),
    row({ venue: "Jimmy's Jazz & Blues Club, Portsmouth, NH", city: "Jimmy's Jazz & Blues Club, Portsmouth, NH", originalSource: 'real.example' }),
    row({ venue: 'Andru Donalds Theatre', artist: 'Andru Donalds', city: 'Bangkok', country: 'TH' })
  ].map((r, i) => ({ ...r, date: `2027-01-${String(i + 1).padStart(2, '0')}` }));
  const result = await processConcerts(real, db, NOW);
  assert.deepEqual(result.map(r => r.venue), real.map(r => r.venue));
});

test('alias convergence preserves distinct venues, dedupes same venues as whole records, both orders', async t => {
  const { db } = await fixture(t);
  const a = row({ city: 'Beograd', country: 'RS', venue: 'Hall A', lat: 1, lng: 2 });
  const b = row({ city: 'Belgrade', country: 'RS', venue: 'Hall B', lat: 3, lng: 4 });
  // The old city keys are distinct. Canonicalizing these without a venue guard
  // would destroy a previously retained row; this is the bounded dedupe change.
  for (const input of [[a, b], [b, a]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 2);
    assert.equal(result.find(r => r.venue === 'Hall A')?.lat, 1);
    assert.equal(result.find(r => r.venue === 'Hall B')?.lat, 3);
    assert.deepEqual(await processConcerts(result, db, NOW), result);
  }
  const richer = { ...a, city: 'Belgrade', startTime: '20:00' };
  for (const input of [[a, richer], [richer, a]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].startTime, '20:00');
    assert.equal(result[0].lat, 1);
  }
  const unknown = row({ city: 'Beograd', country: 'RS', venue: 'NERVY IN BELGRADE', lat: 8, lng: 9 });
  const result = await processConcerts([unknown, a], db, NOW);
  assert.equal(result.length, 2, 'unknown cannot be merged into a different real venue by alias convergence');
  assert.equal(result.find(r => r.venue === UNKNOWN_VENUE)?.lat, 8);
  const secondUnknown = { ...unknown, city: 'Belgrade', lat: 10, lng: 11 };
  for (const input of [[unknown, secondUnknown], [secondUnknown, unknown]]) {
    const kept = await processConcerts(input, db, NOW);
    assert.equal(kept.length, 2, 'two unknown venues cannot acquire shared venue identity during alias convergence');
    assert.deepEqual(kept.map(r => [r.lat, r.lng]), input.map(r => [r.lat, r.lng]));
    assert.deepEqual(await processConcerts(kept, db, NOW), kept);
  }
});

test('arbitrary approved artist aliases normalize title placeholders without per-artist rules', async t => {
  const { db } = await fixture(t);
  const result = await processConcerts([row({ artist: 'Test Artist', venue: 'Different Name IN YEREVAN' })], db, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, UNKNOWN_VENUE);
});

test('existing artist/date/city dedupe remains unchanged outside finite alias groups', async t => {
  const { db } = await fixture(t);
  const result = await processConcerts([row({ city: 'Berlin', country: 'DE', venue: 'Hall A' }),
    row({ city: 'Berlin', country: 'DE', venue: 'Hall B', lat: 3, lng: 4 })], db, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, 'Hall A');
  assert.equal(result[0].lat, undefined, 'never splice metadata from another venue');
});

test('placeholder geocoding never queries provider or shares cache coordinates; source coordinates survive', async () => {
  const rows = [row({ artist: 'Nervy', venue: 'NERVY IN YEREVAN' }), row({ venue: 'Yerevan', lat: 1, lng: 2 })];
  const cache: GeocodeCache = { [geocodeCacheKey({ ...rows[0], venue: UNKNOWN_VENUE })]:
    { lat: 40, lng: 44, cityEn: 'Yerevan', geocodedAt: NOW } };
  const before = structuredClone(cache);
  const stats = await geocodeConcerts(rows, { cache, geocodeFn: async () => { throw new Error('must not query placeholder'); } });
  assert.equal(stats.attempted, 0);
  assert.equal(stats.filledFromCache, 0);
  assert.equal(rows[0].lat, undefined);
  assert.equal(rows[1].lat, 1);
  assert.deepEqual(cache, before);
});

test('real venues retain legacy alias cache access without replacing source coordinates', async t => {
  const { db } = await fixture(t);
  const raw = row({ city: "T'bilisi", country: 'GE', venue: 'Elektrowerk' });
  const cache: GeocodeCache = { [geocodeCacheKey(raw)]: { lat: 41, lng: 44, cityEn: 'Tbilisi', geocodedAt: NOW } };
  const result = await processConcerts([raw], db, NOW);
  await geocodeConcerts(result, { cache, maxPerRun: 0 });
  assert.equal(result[0].city, 'Tbilisi');
  assert.equal(result[0].lat, 41);
  assert.equal(result[0].lng, 44);
  const supplied = { ...raw, lat: 10, lng: 20 };
  await geocodeConcerts([supplied], { cache, maxPerRun: 0 });
  assert.equal(supplied.lat, 10);
  assert.equal(supplied.lng, 20);
});
