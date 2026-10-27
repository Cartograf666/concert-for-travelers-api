import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { processConcerts } from '../src/pipeline/process.js';
import { verifiedNormalizationOccurrence } from '../src/pipeline/normalization_occurrence_identity.js';
import type { RawConcert, Concert } from '../src/schemas/concert.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const AT = '2026-10-11T05:00:00.000Z';
const DIR = 'tests/fixtures/normalization-integrity-20261011';
const nativeDir = 'tests/fixtures/normalization-location-20261011';
interface Pair {
  artist: string; stableField: 'spotifyId' | 'mbid' | 'artistWebsite'; stableId: string;
  date: string; country: string; nativeSource: string; nativeUrl: string;
  nativeCity: string; nativeVenue: string; peerSource: string; peerCity: string; peerVenue: string;
  winner: 'native' | 'peer'; before: Concert;
}
const loadProof = async () => JSON.parse(await readFile(`${DIR}/occurrence-proof.json`, 'utf8')) as { pairs: Pair[] };
const ids: Record<string, string> = { 'Turmion Kätilöt': 'turmion-katilot' };
async function nativeRows(artist: string, bodyOverride?: string): Promise<RawConcert[]> {
  const id = `artist-${ids[artist] || artist.toLowerCase().replaceAll(' ', '-')}`;
  const cfg = ScraperConfigSchema.parse(JSON.parse(await readFile(`scrapers/artists/${id}.json`, 'utf8')));
  const body = bodyOverride ?? await readFile(`${nativeDir}/${id}.${artist === 'Shelly Berg' ? 'json' : 'html'}`, 'utf8');
  const parser = await import(`../src/engine/custom/${id}.js`);
  return parser.scrape(cfg, body, AT);
}
const publish = (rows: RawConcert[]) => processConcerts(rows, 'data/artists', AT);

test('41 primary occurrence pairs select the same whole record in both orders without splicing fields', async () => {
  const proof = await loadProof();
  assert.equal(proof.pairs.length, 41);
  const cache = new Map<string, RawConcert[]>();
  const natives: RawConcert[] = [];
  for (const pair of proof.pairs) {
    if (!cache.has(pair.artist)) cache.set(pair.artist, await nativeRows(pair.artist));
    const native = cache.get(pair.artist)!.find(r => r.date === pair.date && r.venue === pair.nativeVenue);
    assert.ok(native, `${pair.artist}/${pair.date}`);
    natives.push(native);
  }
  const peers = proof.pairs.map(pair => pair.before);
  const sourceOnly = await publish(natives);
  const peerOnly = await publish(peers);
  const nativeFirst = await publish([...natives, ...peers]);
  const peerFirst = await publish([...peers, ...natives]);
  const futures = natives.map((r, i) => ({ ...r, date: `2030-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}` }));
  const futureOnly = await processConcerts(futures, 'data/artists', AT, undefined, undefined, undefined, { maxFutureDays: 2000 });
  const movedOnly = await publish(natives.map(r => ({ ...r, venue: `${r.venue} moved` })));
  assert.equal(sourceOnly.length, 41);
  assert.equal(peerOnly.length, 41);
  assert.equal(nativeFirst.length, 41);
  assert.equal(peerFirst.length, 41);
  for (const [i, pair] of proof.pairs.entries()) {
    const native = natives[i];
    assert.equal(native.sourceEventUrl, pair.nativeUrl);
    const record = sourceOnly.find(r => r.artist === pair.artist && r.date === pair.date)!;
    assert.deepEqual([record.city, record.country, record.venue], [pair.nativeCity, pair.country, pair.nativeVenue]);
    const expected = pair.winner === 'native' ? record : peerOnly.find(r => r.artist === pair.artist && r.date === pair.date);
    for (const output of [nativeFirst, peerFirst]) {
      assert.deepEqual(output.find(r => r.artist === pair.artist && r.date === pair.date), expected);
    }
    // Complete JSON equality includes country, venue, coordinates, price, time,
    // lineup, provenance and canonical artist metadata: no field masks/splicing.
    assert.ok(verifiedNormalizationOccurrence(native, record));
    for (const change of [
      { date: '2030-01-01' }, { country: 'ZZ' }, { venue: `${native.venue} moved` },
      { city: 'Unknown' }, { originalSource: 'untrusted.example' },
      { artist: `${pair.artist} tribute` }, { sourceEventUrl: `${pair.nativeUrl}?other=1` }
    ]) {
      assert.equal(verifiedNormalizationOccurrence({ ...native, ...change }, { ...record, ...change }), undefined);
    }
    assert.equal(verifiedNormalizationOccurrence(native, { ...record, [pair.stableField]: 'wrong-id' }), undefined);
    assert.equal(verifiedNormalizationOccurrence({ ...native, sourceEventUrl: undefined }, record), undefined);
    assert.equal(futureOnly.find(r => r.artist === pair.artist && r.date === futures[i].date)?.venue, native.venue);
    assert.equal(movedOnly.find(r => r.artist === pair.artist && r.date === pair.date)?.venue, `${native.venue} moved`);
  }
});

test('Randy programmes use primary physical venues; unproved or changed occurrences retain raw date/place and no venue', async () => {
  const rows = await nativeRows('Randy Houser');
  for (const [date, venue] of [
    ['2026-10-17', 'The Bluff Amphitheater'], ['2026-10-30', 'The Pinnacle'],
    ['2026-11-11', 'House of Blues Houston'], ['2026-12-31', 'The Charlotte County Fair']
  ]) assert.equal(rows.find(r => r.date === date)?.venue, venue);
  assert.ok(rows.every(r => !r.venue?.includes('with Riley Green')));
  const body = await readFile(`${nativeDir}/artist-randy-houser.html`, 'utf8');
  for (const replacement of [
    body.replace('100.3 The Bull presents Ten Man Jam - Acoustic', 'Unknown festival programme'),
    body.replace('Nov 11 2026', 'Nov 11 2027'),
    body.replace('Houston, TX', 'Houston, AL')
  ]) {
    const changed = await nativeRows('Randy Houser', replacement);
    const row = changed.find(r => r.city === 'Houston');
    assert.ok(row);
    assert.equal(row.venue, undefined);
    assert.equal((await publish([row])).length, 0);
    assert.equal(row.country, 'US');
  }
});

test('new primary proof keeps original capture bytes and explicitly documents moves and physical addresses', async () => {
  for (const stem of ['paul-zwickau-move', 'randy-port-charlotte-linked', 'randy-nashville-promoter', 'randy-loblolly-linked', 'bonnie-festival']) {
    const body = await readFile(`${DIR}/${stem}.html`);
    const meta = JSON.parse(await readFile(`${DIR}/${stem}-meta.json`, 'utf8'));
    assert.equal(meta.status, 200);
    assert.equal(createHash('sha256').update(body).digest('hex'), meta.sha256);
  }
  const zwickau = cheerio.load(await readFile(`${DIR}/paul-zwickau-move.html`, 'utf8'));
  assert.match(zwickau.text(), /Sparkassenarena[\s\S]*Neue Welt[\s\S]*verlegt/);
  const event = JSON.parse(zwickau('script[type="application/ld+json"]').first().text())[0];
  assert.equal(event.startDate.slice(0, 10), '2026-10-19');
  assert.equal(event.location.address.addressLocality, 'Zwickau');
  const port = cheerio.load(await readFile(`${DIR}/randy-port-charlotte-linked.html`, 'utf8'));
  assert.match(port.text(), /The Charlotte County Fair/);
  assert.match(port.text(), /2333 El Jobean/);
  const portEvent = port('script[type="application/ld+json"]').toArray()
    .map(element => JSON.parse(port(element).text())).find(row => row['@type'] === 'Event');
  assert.equal(portEvent.startDate.slice(0, 10), '2026-12-31');
  assert.deepEqual([portEvent.location.name, portEvent.location.address.addressLocality,
    portEvent.location.address.addressRegion, portEvent.location.address.addressCountry],
  ['The Charlotte County Fair', 'Port Charlotte', 'FL', 'US']);
});
