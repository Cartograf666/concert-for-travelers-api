import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { processConcerts, buildApprovedMatcher } from '../src/pipeline/process.js';
import { isVerifiedTheHuObservation, verifiedTheHuDublinSourceRank } from '../src/pipeline/thehu_identity.js';
import { loadCache, saveCache, hashConcerts } from '../src/engine/cache.js';
import type { Concert } from '../src/schemas/concert.js';
import type { OfficialArtistContext } from '../src/engine/official_artist_sources.js';

const baseDate = '2026-09-28T09:13:36.728Z';
const theHu = { name: 'The HU', website: 'https://www.thehuofficial.com/' };
const theHub = {
  name: 'The Hub', website: null, mbid: '7f67acbf-4b15-471a-833a-6bdd338c2fbe',
  socials: { spotify: 'https://open.spotify.com/artist/2o3p4q5r6s7t8u9v0w1x2y' }
};
async function inputs(): Promise<Partial<Concert>[]> {
  const proof = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/thehu-identity-proof-20260928.json'), 'utf8'));
  return proof.bindings.map((b: { raw: Partial<Concert> }) => b.raw);
}
async function withDb(fn: (db: string, dir: string) => Promise<void>, includeTheHu = true): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thehu-identity-'));
  try {
    const db = path.join(dir, 'artists.json');
    await fs.writeFile(db, JSON.stringify(includeTheHu ? [theHub, theHu] : [theHub]));
    await fn(db, dir);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('ten verified observations become nine The HU shows without The Hub metadata', async () => {
  await withDb(async db => {
    const raw = await inputs(), before = structuredClone(raw);
    assert.equal(raw.length, 10);
    assert.equal(buildApprovedMatcher([theHub])('The Hu')?.name, 'The Hub');
    const result = await processConcerts(raw, db, baseDate);
    assert.equal(result.length, 9);
    for (const event of result) {
      assert.equal(event.artist, 'The HU');
      assert.equal(event.artistWebsite, theHu.website);
      assert.equal(event.mbid, undefined);
      assert.equal(event.spotifyId, undefined);
      assert.equal(event.artistSocials, undefined);
      const original = raw.find(row => row.date === event.date)!;
      assert.ok(original);
      for (const field of ['startTime', 'venue', 'city', 'country', 'lat', 'lng', 'originalSource', 'scrapedAt'] as const) {
        assert.equal(event[field], original[field]);
      }
    }
    assert.deepEqual(raw, before);
  });
});

test('Dublin pair preserves the whole Ticketmaster winner in both orders after site enrichment', async () => {
  await withDb(async db => {
    const rows = await inputs(), venue = rows[0], tm = rows[9];
    assert.notEqual(venue.lat, tm.lat);
    assert.equal(venue.startTime, undefined);
    const expected = await processConcerts([tm], db, baseDate);
    for (const pair of [[venue, tm], [tm, venue]]) {
      assert.deepEqual(await processConcerts(pair, db, baseDate), expected);
    }
    assert.equal(expected[0].startTime, '19:00');
    assert.equal(expected[0].originalSource, 'ticketmaster.com');
    assert.equal(verifiedTheHuDublinSourceRank(venue), 1);
    assert.equal(verifiedTheHuDublinSourceRank(tm), 2);
    assert.equal(verifiedTheHuDublinSourceRank(rows[1]), 0);
  });
});

test('Dublin survives either verified source alone; an unverified venue cannot resurrect The Hub', async () => {
  await withDb(async db => {
    const rows = await inputs(), venue = rows[0], tm = rows[9];
    const result = await processConcerts([venue], db, baseDate);
    assert.equal(result.length, 1);
    assert.equal(result[0].artist, 'The HU');
    assert.equal(result[0].startTime, undefined);
    assert.equal(result[0].lat, venue.lat);
    assert.equal(result[0].originalSource, '3olympia.ie');
    const unknown = { ...venue, date: '2026-10-06' };
    assert.equal(verifiedTheHuDublinSourceRank(unknown), 0);
    assert.deepEqual(await processConcerts([unknown], db, baseDate), []);
    assert.deepEqual(await processConcerts([unknown, tm], db, baseDate), await processConcerts([tm], db, baseDate));
    assert.deepEqual(await processConcerts([unknown, { ...tm, ticketUrl: undefined }], db, baseDate), []);
    // Genuine artist authority still takes precedence over the scoped source rank.
    const context: OfficialArtistContext = new WeakMap([[venue, { artist: 'The HU' }]]);
    for (const pair of [[venue, tm], [tm, venue]]) {
      assert.deepEqual(await processConcerts(pair, db, baseDate, undefined, undefined, context), result);
    }
  });
});

test('serialized legacy cache and each provider retain The HU without changing cached inputs', async () => {
  await withDb(async (db, dir) => {
    const raw = await inputs(), cachePath = path.join(dir, 'old-cache.json');
    await saveCache(cachePath, { old: { contentHash: hashConcerts(raw), scrapedAt: raw[0].scrapedAt!, concerts: raw } });
    const bytes = await fs.readFile(cachePath, 'utf8'), loaded = (await loadCache(cachePath)).old.concerts;
    assert.equal((await processConcerts(loaded, db, baseDate)).length, 9);
    for (const source of ['ticketmaster.com', '3olympia.ie']) {
      const result = await processConcerts(loaded.filter(row => row.originalSource === source), db, baseDate);
      assert.equal(result.length, source === 'ticketmaster.com' ? 9 : 1);
      assert.ok(result.every(row => row.artist === 'The HU'));
    }
    assert.equal(await fs.readFile(cachePath, 'utf8'), bytes);
    assert.deepEqual(loaded, raw);
  });
});

test('wrong source, event URL, date or location fails closed for all Ticketmaster certificates', async () => {
  await withDb(async db => {
    for (const raw of (await inputs()).slice(1)) {
      const url = new URL(raw.ticketUrl!);
      const altered: Partial<Concert>[] = [
        { ...raw, originalSource: 'bandsintown.com' }, { ...raw, originalSource: 'ticketmaster.com.example.org' },
        { ...raw, ticketUrl: raw.ticketUrl!.replace(url.host, 'fake.example') },
        { ...raw, ticketUrl: raw.ticketUrl!.replace('https://', 'https://user:pass@') },
        { ...raw, ticketUrl: raw.ticketUrl!.replace('https://', 'http://') },
        { ...raw, ticketUrl: url.origin + url.pathname + '/OTHER_EVENT' },
        { ...raw, ticketUrl: undefined }, { ...raw, ticketUrl: '' },
        { ...raw, date: '2026-12-31' }, { ...raw, venue: 'Other venue' },
        { ...raw, city: 'Other city' }, { ...raw, country: 'US' }
      ];
      assert.deepEqual(await processConcerts(altered, db, baseDate), []);
      const tracked = { ...raw, artist: ' THE HU ', ticketUrl: url.origin + url.pathname + '/?ref=alternate#tickets' };
      assert.equal(isVerifiedTheHuObservation(tracked), true);
      assert.equal((await processConcerts([tracked], db, baseDate))[0].artist, 'The HU');
    }
  });
});

test('absent URL exception applies only to the exact Dublin venue observation', async () => {
  await withDb(async db => {
    const row = (await inputs())[0];
    const altered: Partial<Concert>[] = [
      { ...row, date: '2026-10-06' }, { ...row, date: 'Wed 7th Oct 2026' },
      { ...row, venue: 'Other venue' }, { ...row, city: 'Belfast' }, { ...row, country: 'GB' },
      { ...row, originalSource: 'ticketmaster.com' },
      ...['', null, 'https://www.3olympia.ie/whats-on/the-hu', 'https://www.thehuofficial.com/'].map(ticketUrl => ({ ...row, ticketUrl: ticketUrl as string }))
    ];
    assert.ok(altered.every(r => verifiedTheHuDublinSourceRank(r) === 0));
    assert.deepEqual(await processConcerts(altered, db, baseDate), []);
    assert.equal(isVerifiedTheHuObservation(row), true);
  });
});

test('missing canonical fails closed; The Hub and unrelated matcher decisions are unchanged', async () => {
  const row = (await inputs())[1];
  await withDb(async db => { assert.deepEqual(await processConcerts([row], db, baseDate), []); }, false);
  await withDb(async db => {
    for (const artist of ['The Hub', 'THE HUB', 'The Hubs', 'The Hurt', 'Unrelated Artist']) {
      const original = buildApprovedMatcher([theHub])(artist);
      const result = await processConcerts([{ ...row, artist }], db, baseDate);
      if (!original) assert.deepEqual(result, []);
      else {
        assert.equal(result.length, 1);
        assert.equal(result[0].artist, original.name);
        assert.equal(result[0].mbid, theHub.mbid);
      }
    }
  });
});
