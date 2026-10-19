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
    { name: 'MORGENSHTERN' }, { name: 'Andru Donalds' }, { name: 'Сплин' }]));
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

test('raw alias city groups survive dedupe and are canonicalized only by the production geocode pass', async t => {
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
    assert.deepEqual(result.map(r => r.city), input.map(r => r.city));
    await geocodeConcerts(result, { maxPerRun: 0 });
    assert.ok(result.every(r => r.city === 'Belgrade'));
    const repeatedRaw = await processConcerts(input, db, NOW);
    await geocodeConcerts(repeatedRaw, { maxPerRun: 0 });
    assert.deepEqual(repeatedRaw, result, 'repeat the actual raw-cache consumer path, not published JSON re-ingestion');
  }
  const richer = { ...a, startTime: '20:00' };
  for (const input of [[a, richer], [richer, a]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].startTime, '20:00');
    assert.equal(result[0].lat, 1);
  }
  const unknown = row({ city: 'Beograd', country: 'RS', venue: 'NERVY IN BELGRADE', lat: 8, lng: 9 });
  const result = await processConcerts([unknown, a], db, NOW);
  assert.equal(result.length, 1, 'same raw city keeps the legacy group and chooses the whole named row');
  assert.equal(result[0].venue, 'Hall A');
  assert.equal(result[0].lat, 1);
  const secondUnknown = { ...unknown, city: 'Belgrade', lat: 10, lng: 11 };
  for (const input of [[unknown, secondUnknown], [secondUnknown, unknown]]) {
    const kept = await processConcerts(input, db, NOW);
    assert.equal(kept.length, 2, 'different raw city groups survive without inventing unknown venue identity');
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

test('identical unknown rows dedupe and metadata differences select one complete legacy-group winner', async t => {
  const { db, dir } = await fixture(t);
  const unknown = row({ city: 'Beograd', country: 'RS', venue: 'NERVY IN BELGRADE', lat: 8, lng: 9 });
  const reordered = Object.fromEntries(Object.entries(unknown).reverse()) as Concert;
  let duplicates = 0;
  const result = await processConcerts([unknown, structuredClone(unknown), reordered], db, NOW,
    undefined, report => { duplicates = report.duplicatesMerged; });
  assert.equal(result.length, 1, 'repeated identical evidence must not manufacture extra published occurrences');
  assert.equal(duplicates, 2);
  assert.equal(result[0].venue, UNKNOWN_VENUE);
  await geocodeConcerts(result, { maxPerRun: 0 });
  const out = path.join(dir, 'unknown-duplicates');
  await publishConcerts(result, out);
  const published = JSON.parse(await fs.readFile(path.join(out, 'concerts.json'), 'utf8'));
  assert.equal(published.length, 1);
  const repeated = await processConcerts([...published, ...published], db, NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(repeated)), published);

  const otherSource = { ...unknown, originalSource: 'www.bandsintown.com', startTime: '21:00' };
  for (const input of [[unknown, otherSource, structuredClone(unknown)], [otherSource, unknown, structuredClone(otherSource)]]) {
    const kept = await processConcerts(input, db, NOW);
    assert.equal(kept.length, 1, 'source metadata must not create a new event identity');
    assert.equal(kept[0].originalSource, input[0].originalSource);
    assert.equal(kept[0].startTime, input[0].startTime, 'unknown records do not splice metadata');
    assert.ok(kept.every(r => r.lat === 8 && r.lng === 9));
    assert.deepEqual(await processConcerts(kept, db, NOW), kept);
  }
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

test('H2 A: same raw city groups a placeholder and named venue before choosing the whole named row', async t => {
  const { db } = await fixture(t);
  const unknown = row({ venue: 'NERVY IN YEREVAN', lat: 1, lng: 2, ticketUrl: 'https://tickets.example/event?ref=bit' });
  const named = row({ venue: 'Karen Demirchyan Complex', originalSource: 'native.example', lat: 3, lng: 4 });
  for (const input of [[unknown, named], [named, unknown]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].venue, named.venue);
    assert.equal(result[0].originalSource, named.originalSource);
    assert.equal(result[0].ticketUrl, undefined, 'keep whole named row without borrowing placeholder URL');
    assert.equal(result[0].lat, 3);
    assert.equal(result[0].lng, 4);
  }
});

test('H2 B: scrape timestamps do not create unknown event identities', async t => {
  const { db } = await fixture(t);
  const first = row({ city: 'Belgrade', country: 'RS', venue: 'NERVY IN BELGRADE' });
  const newer = { ...first, scrapedAt: '2026-10-19T01:00:00.000Z' };
  for (const input of [[first, newer], [newer, first]]) {
    let duplicates = 0;
    const result = await processConcerts(input, db, NOW, undefined, report => { duplicates = report.duplicatesMerged; });
    assert.equal(result.length, 1);
    assert.equal(duplicates, 1);
    assert.equal(result[0].scrapedAt, input[0].scrapedAt);
  }
});

test('H2 B2: tracking-query changes do not create unknown event identities', async t => {
  const { db } = await fixture(t);
  const first = row({ city: 'Belgrade', country: 'RS', venue: 'NERVY IN BELGRADE', ticketUrl: 'https://tickets.example/event?ref=one' });
  const second = { ...first, ticketUrl: 'https://tickets.example/event?ref=two' };
  for (const input of [[first, second], [second, first]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].ticketUrl, input[0].ticketUrl);
  }
});

test('H2 C: named-venue spelling variants in one raw city retain the legacy dedupe group', async t => {
  const { db } = await fixture(t);
  const first = row({ city: 'Belgrade', country: 'RS', venue: 'Štark Arena', lat: 1, lng: 2 });
  const second = { ...first, venue: 'Stark Arena Beograd', lat: 3, lng: 4 };
  for (const input of [[first, second], [second, first]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].venue, input[0].venue);
    assert.equal(result[0].lat, input[0].lat);
  }
});

test('M1: named venue wins over placeholder before URL fallback at equal authority, including Berlin', async t => {
  const { db } = await fixture(t);
  const unknown = row({ city: 'Berlin', country: 'DE', venue: 'NERVY IN BERLIN', lat: 1, lng: 2,
    ticketUrl: 'https://tickets.example/unknown' });
  const named = { ...unknown, venue: 'Columbiahalle', originalSource: 'native.example', lat: 3, lng: 4, ticketUrl: undefined };
  for (const input of [[unknown, named], [named, unknown]]) {
    const result = await processConcerts(input, db, NOW);
    assert.equal(result.length, 1);
    assert.equal(result[0].venue, named.venue);
    assert.equal(result[0].ticketUrl, undefined);
    assert.equal(result[0].lat, 3);
    assert.equal(result[0].lng, 4);
  }
});

test('official authority precedes named-venue preference and metadata URL fallback', async t => {
  const { db } = await fixture(t);
  const unknown = row({ venue: UNKNOWN_VENUE, originalSource: 'official.example', lat: 1, lng: 2 });
  const named = row({ venue: 'Real Hall', lat: 3, lng: 4, ticketUrl: 'https://tickets.example/named' });
  for (const official of [unknown, named]) {
    const context = new WeakMap([[official, { artist: 'Нервы' }]]);
    for (const input of [[unknown, named], [named, unknown]]) {
      const result = await processConcerts(input, db, NOW, undefined, undefined, context);
      assert.equal(result.length, 1);
      assert.equal(result[0].venue, official.venue);
      assert.equal(result[0].lat, official.lat);
      assert.equal(result[0].ticketUrl, official.ticketUrl);
    }
  }
});

test('named-venue preference cannot override the country boundary', async t => {
  const { db } = await fixture(t);
  const unknown = row({ city: 'Berlin', country: 'DE', venue: UNKNOWN_VENUE, ticketUrl: 'https://tickets.example/unknown' });
  const named = { ...unknown, country: 'AT', venue: 'Other Country Hall', ticketUrl: undefined };
  const result = await processConcerts([unknown, named], db, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].country, 'DE');
  assert.equal(result[0].venue, UNKNOWN_VENUE);
});

test('D: inflected Russian artist-city title is retained as unknown without geocoding or city inference', async t => {
  const { db } = await fixture(t);
  const raw = mapBitEventToConcert({ starts_at: '2027-01-01T20:00:00',
    venue: { name: 'Сплин в Ижевске', city: 'Izhevsk', country: 'RU' } }, 'Сплин', NOW);
  assert.ok(raw, 'placeholder venue cannot justify dropping the event');
  const result = await processConcerts([raw], db, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, UNKNOWN_VENUE);
  assert.equal(result[0].city, 'Izhevsk');
  const stats = await geocodeConcerts(result, { geocodeFn: async () => { throw new Error('placeholder must not query'); } });
  assert.equal(stats.attempted, 0);
  assert.equal(result[0].lat, undefined);
  const foreign = normalizeLocation(row({ artist: 'Сплин', venue: 'Сплин в Ижевске', city: 'Izhevsk', country: 'US' }));
  assert.equal(foreign.venue, 'Сплин в Ижевске', 'comparison forms are country-scoped');
});

test('structured BIT city-country placeholder requires matching country and retains Various as unresolved city', async t => {
  const { db } = await fixture(t);
  for (const venue of ['Belgrade, Serbia', 'Beograd, Serbia', 'Belgrade, RS']) {
    const result = await processConcerts([row({ venue, city: 'Belgrade', country: 'RS' })], db, NOW);
    assert.equal(result[0].venue, UNKNOWN_VENUE);
    assert.equal(result[0].city, 'Belgrade');
  }
  const mismatch = normalizeLocation(row({ venue: 'Belgrade, United States', city: 'Belgrade', country: 'RS' }));
  assert.equal(mismatch.venue, 'Belgrade, United States');
  const native = normalizeLocation(row({ venue: 'Belgrade, Serbia', city: 'Belgrade', country: 'RS', originalSource: 'native.example' }));
  assert.equal(native.venue, 'Belgrade, Serbia');
  const various = await processConcerts([row({ venue: 'Various', city: 'Various', country: 'GB' })], db, NOW);
  await geocodeConcerts(various, { maxPerRun: 0 });
  assert.equal(various[0].city, 'Various', 'a real city cannot be inferred');
  assert.equal(various[0].venue, UNKNOWN_VENUE);
  assert.equal(various[0].lat, undefined);
});
