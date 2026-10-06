import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert, RawConcert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';
import { mapBitEventToConcert, loadBandsintownCache, saveBandsintownCache } from '../src/engine/bandsintown.js';
import { scrape as scrapeTrain } from '../src/engine/custom/artist-patrick-monahan.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const baseDate = '2026-10-06T12:00:00Z';
const canonical = {
  name: 'Pain For Pleasure', mbid: '60d0d63e-5404-4c13-b01e-d024f71a43b2',
  website: 'https://www.painforpleasure.com/'
};
async function cachedRow(): Promise<Partial<Concert>> {
  const proof = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/provider-identity-collision-20261006.json'), 'utf8'));
  return proof.raw;
}
async function withDb(artists: unknown[], fn: (db: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-identity-'));
  try {
    const db = path.join(dir, 'artists.json');
    await fs.writeFile(db, JSON.stringify(artists));
    await fn(db);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('known cached French tribute event cannot inherit Canadian Pain For Pleasure metadata', async () => {
  await withDb([canonical], async db => {
    const raw = await cachedRow(), before = structuredClone(raw);
    let diagnostics: ProcessingDiagnostics | undefined;
    const result = await processConcerts([raw], db, baseDate, undefined, value => { diagnostics = value; });
    assert.deepEqual(result, []);
    assert.equal(diagnostics?.rawCount, 1);
    assert.equal(diagnostics?.publishedCount, 0);
    assert.equal(diagnostics?.dropped.notApproved, 1);
    assert.deepEqual(raw, before, 'rejecting misattribution must preserve last-good cache input');
  });
});

test('identity exclusion preserves other events, sources, artists and a distinct same-name identity', async () => {
  const raw = await cachedRow();
  const otherArtist = { name: 'Other Artist', mbid: '11111111-1111-4111-8111-111111111111' };
  const unrelated = [
    { ...raw, date: '2030-10-17', ticketUrl: 'https://www.bandsintown.com/t/1038425782' },
    { ...raw, date: '2030-10-18', originalSource: 'artist.example' },
    { ...raw, date: '2030-10-19', ticketUrl: 'https://tickets.example/t/1038425781' },
    { ...raw, artist: otherArtist.name }
  ];
  await withDb([canonical, otherArtist], async db => {
    const result = await processConcerts(unrelated, db, baseDate);
    assert.equal(result.length, 4);
    assert.equal(result.filter(row => row.mbid === canonical.mbid).length, 3);
    assert.equal(result.find(row => row.artist === otherArtist.name)?.mbid, otherArtist.mbid);
  });
  await withDb([{ name: canonical.name, mbid: otherArtist.mbid }], async db => {
    const result = await processConcerts([raw], db, baseDate);
    assert.equal(result.length, 1, 'the verified event remains valid for a different canonical artist');
    assert.equal(result[0].mbid, otherArtist.mbid);
  });
});


test('provider identity survives external purchase links and cache serialization after refresh', async () => {
  const raw = await cachedRow();
  const event = {
    url: 'https://www.bandsintown.com/t/1038425781',
    offers: [{ url: 'https://tickets.example/buy-tribute-show' }],
    starts_at: '2026-10-17T19:00:00',
    venue: { name: raw.venue, city: raw.city, country: 'France' }
  };
  const refreshed = mapBitEventToConcert(event, canonical.name, raw.scrapedAt!);
  assert.ok(refreshed);
  assert.equal(refreshed.ticketUrl, event.offers[0].url);
  assert.equal(refreshed.sourceEventUrl, event.url);
  await withDb([canonical], async db => {
    const cachePath = path.join(path.dirname(db), 'bandsintown-cache.json');
    await saveBandsintownCache(cachePath, {
      [canonical.name]: { fetchedAt: raw.scrapedAt!, concerts: [refreshed] }
    });
    const loaded = (await loadBandsintownCache(cachePath))[canonical.name].concerts;
    assert.equal((loaded[0] as RawConcert).sourceEventUrl, event.url);
    assert.deepEqual(await processConcerts(loaded, db, baseDate), []);
    const legitimate = mapBitEventToConcert({ ...event, url: 'https://www.bandsintown.com/t/1038425782' }, canonical.name, raw.scrapedAt!);
    assert.ok(legitimate);
    const result = await processConcerts([legitimate], db, baseDate);
    assert.equal(result.length, 1);
    assert.equal('sourceEventUrl' in result[0], false, 'internal provenance must not change the public API');
  });
});

async function trainProof(): Promise<{ canonicalSpotifyId: string; raw: RawConcert[]; legitimateBitRaw: RawConcert[] }> {
  return JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/train-provider-identity-20261006.json'), 'utf8'));
}
const canonicalTrain = {
  name: 'Train', website: 'https://www.savemesanfrancisco.com/',
  socials: { spotify: 'https://open.spotify.com/artist/3RqgnylU44Y6V4fF05p1Wp' }
};

test('four captured Aarhus promoter events cannot inherit American Train identity', async () => {
  const { raw } = await trainProof();
  assert.deepEqual(raw.map(row => new URL(row.ticketUrl!).pathname), [
    '/t/1040223915', '/t/1040093753', '/t/1040317158', '/t/1040290880'
  ]);
  await withDb([canonicalTrain], async db => {
    const before = structuredClone(raw);
    let diagnostics: ProcessingDiagnostics | undefined;
    const result = await processConcerts(raw, db, baseDate, undefined, value => { diagnostics = value; });
    assert.deepEqual(result, []);
    assert.equal(diagnostics?.rawCount, 4);
    assert.equal(diagnostics?.publishedCount, 0);
    assert.equal(diagnostics?.dropped.notApproved, 4);
    assert.deepEqual(raw, before);
  });
});

test('Train collision uses provider source URL even after purchase-link refresh and cache reload', async () => {
  const { raw } = await trainProof();
  const event = {
    url: new URL(raw[0].ticketUrl!).origin + new URL(raw[0].ticketUrl!).pathname,
    offers: [{ url: 'https://tickets.example/buy-aarhus-show' }],
    starts_at: '2026-11-04T20:00:00',
    venue: { name: raw[0].venue, city: raw[0].city, country: 'Denmark' }
  };
  const refreshed = mapBitEventToConcert(event, canonicalTrain.name, raw[0].scrapedAt);
  assert.ok(refreshed);
  assert.equal(refreshed.ticketUrl, event.offers[0].url);
  assert.equal(refreshed.sourceEventUrl, event.url);
  await withDb([canonicalTrain], async db => {
    const cachePath = path.join(path.dirname(db), 'bandsintown-cache.json');
    await saveBandsintownCache(cachePath, {
      Train: { fetchedAt: raw[0].scrapedAt, concerts: [refreshed] }
    });
    const loaded = (await loadBandsintownCache(cachePath)).Train.concerts;
    assert.equal((loaded[0] as RawConcert).sourceEventUrl, event.url);
    assert.deepEqual(await processConcerts(loaded, db, baseDate), []);
  });
});

test('Train exclusion retains official shows, real US provider events and unrelated identities', async () => {
  const { raw, legitimateBitRaw } = await trainProof();
  const config = JSON.parse(await fs.readFile('scrapers/artist-patrick-monahan.json', 'utf8')) as ScraperConfig;
  const officialFeed = await fs.readFile('tests/fixtures/remaining_train_regions.json', 'utf8');
  const official = await scrapeTrain(config, officialFeed, baseDate);
  assert.equal(official.length, 3);
  await withDb([canonicalTrain], async db => {
    const officialResult = await processConcerts(official, db, baseDate);
    const bitResult = await processConcerts(legitimateBitRaw, db, baseDate);
    assert.equal(officialResult.length, 3);
    assert.equal(bitResult.length, 2);
    assert.ok([...officialResult, ...bitResult].every(row => row.spotifyId === '3RqgnylU44Y6V4fF05p1Wp'));
    assert.ok([...officialResult, ...bitResult].every(row => row.country === 'US'));

    const otherEvent = { ...raw[0], ticketUrl: 'https://www.bandsintown.com/t/1040223916' };
    const otherProvider = { ...raw[0], originalSource: 'promoter.example' };
    assert.equal((await processConcerts([otherEvent], db, baseDate)).length, 1);
    assert.equal((await processConcerts([otherProvider], db, baseDate)).length, 1);
  });
  await withDb([{ name: 'Train', socials: { spotify: 'https://open.spotify.com/artist/DifferentTrainIdentity' } }], async db => {
    const result = await processConcerts([raw[0]], db, baseDate);
    assert.equal(result.length, 1);
    assert.equal(result[0].spotifyId, 'DifferentTrainIdentity');
  });
});
