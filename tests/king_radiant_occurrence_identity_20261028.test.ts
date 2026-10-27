import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { scrape } from '../src/engine/custom/artist-king-gizzard-radiant.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { fetchBandsintownConcerts } from '../src/engine/bandsintown.js';
import { processConcerts } from '../src/pipeline/process.js';
import { PRODUCTION_ARTIST_DB_DIR, loadApprovedArtists } from '../src/pipeline/artistDb.js';
import { verifiedNormalizationOccurrence } from '../src/pipeline/normalization_occurrence_identity.js';
import { publishConcerts } from '../src/generator/publish.js';
import type { Concert, RawConcert } from '../src/schemas/concert.js';

const DIR = 'tests/fixtures/official-remaining-20261028';
const PROOF = 'tests/fixtures/king-radiant-identity-20261028';
const AT = '2026-10-28T00:00:00.000Z';
const processRows = (rows: RawConcert[]) => processConcerts(rows, PRODUCTION_ARTIST_DB_DIR, AT);
async function fixtures() {
  const config = ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artists/artist-king-gizzard-radiant.json', 'utf8')));
  const html = await readFile(`${DIR}/king-radiant.html`, 'utf8');
  const [native] = await scrape(config, html, AT);
  assert.ok(native);
  const capture = JSON.parse(await readFile(`${DIR}/king-bit-runtime.json`, 'utf8'));
  const peer = capture.raw.find((r: RawConcert) => r.date === native.date) as RawConcert;
  assert.ok(peer);
  return { native, peer, capture, html };
}

test('Radiant identity proof binds independent native IDs, exact artist/day/time and official action/address', async () => {
  const proof = JSON.parse(await readFile(`${PROOF}/proof.json`, 'utf8'));
  for (const input of proof.inputs) {
    const bytes = await readFile(input.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
  }
  const { html, native, peer, capture } = await fixtures();
  const $ = cheerio.load(html);
  assert.equal($('h1').text().trim(), 'KING GIZZARD & THE LIZARD WIZARD');
  assert.equal($('.spectacle-dates li').length, 1);
  assert.match($('.spectacle-dates').text(), /mercredi 09 juin 2027\s+19h00/);
  assert.match($('li').text(), /69300\s+CALUIRE ET CUIRE/);
  assert.equal(native.eventUrl, proof.nativeEventUrl);
  assert.equal(native.sourceEventUrl, undefined, 'exercise the real primary eventUrl field');
  assert.equal(native.ticketUrl, proof.nativeTicketUrl);
  const bit = capture.native[0].data.find((r: { id: string }) => r.id === proof.bandsintownEventId);
  assert.ok(bit);
  assert.equal(bit.artist_id, '2117024');
  assert.deepEqual(bit.lineup, [native.artist]);
  assert.equal(bit.datetime, '2027-06-09T19:00:00');
  assert.equal(bit.starts_at, bit.datetime);
  assert.equal(peer.startTime, '19:00');
  assert.equal(bit.venue.country, 'France');
  assert.equal(bit.venue.name, peer.venue);
  assert.equal(bit.url, peer.sourceEventUrl);
  assert.equal(new URL(bit.url).pathname, '/e/109083165');
  assert.equal(new URL(bit.offers[0].url).pathname, '/t/109083165');
  const ticket = cheerio.load(await readFile(`${PROOF}/official-ticket.html`, 'utf8'));
  assert.equal(ticket('link[rel="canonical"]').attr('href'), native.ticketUrl);
  assert.equal(ticket('.manifestation-title').text(), 'KING GIZZARD & THE LIZARD WIZARD');
  assert.equal(ticket('.manifestation-date').text(), '9 juin 2027');
  assert.equal(ticket('.manifestation-venue').text(), 'RADIANT-BELLEVUE');
});

test('real primary parser and BIT collector publish one intact primary Radiant card in both orders', async t => {
  const { native, capture } = await fixtures();
  t.mock.method(axios, 'get', async (url: string) => {
    assert.equal(url, capture.native[0].endpoint);
    return { status: 200, data: capture.native[0].data, headers: {} };
  });
  const peers = await fetchBandsintownConcerts(['King Gizzard & The Lizard Wizard'], {
    cache: {}, maxPerRun: 1, now: () => new Date(capture.startedAt)
  });
  assert.equal(peers.length, 11);
  const [primaryOnly] = await processRows([native]);
  const peersOnly = await processRows(peers);
  assert.equal(primaryOnly.spotifyId, '6XYvaoDGE0VmRt83Jss9Sn');
  assert.equal(primaryOnly.mbid, 'f58384a4-2ad2-4f24-89c5-c7b74ae1cce7');
  assert.equal(primaryOnly.artist, 'King Gizzard & the Lizard Wizard');
  const approved = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  for (const rows of [[native, ...peers], [...peers, native]]) {
    const processed = await processRows(rows);
    assert.equal(processed.length, 11);
    const dir = await mkdtemp(join(tmpdir(), 'king-radiant-identity-'));
    try {
      await publishConcerts(processed, dir, approved);
      const published = JSON.parse(await readFile(join(dir, 'concerts.json'), 'utf8')) as Concert[];
      assert.equal(published.length, 11);
      const radiant = published.filter(r => r.date === native.date);
      assert.deepEqual(radiant, [JSON.parse(JSON.stringify(primaryOnly))], 'whole-record equality: no borrowed BIT time/coordinates/links');
      assert.deepEqual([radiant[0].city, radiant[0].venue, radiant[0].country], ['Caluire et Cuire', 'Radiant-Bellevue', 'FR']);
      assert.equal(radiant[0].eventUrl, native.eventUrl);
      assert.equal(radiant[0].ticketUrl, native.ticketUrl);
      const other = (r: Concert) => r.date !== native.date;
      const sort = (a: Concert, b: Concert) =>
        JSON.stringify([a.date, a.country, a.city, a.venue]).localeCompare(JSON.stringify([b.date, b.country, b.city, b.venue]));
      assert.deepEqual(published.filter(other).sort(sort), JSON.parse(JSON.stringify(peersOnly.filter(other).sort(sort))));
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('Radiant finite proof rejects changed identity/date/country/place/source/links and unrelated city coincidences', async () => {
  const { native, peer } = await fixtures();
  const [record] = await processRows([native]);
  assert.ok(verifiedNormalizationOccurrence(native, record));
  assert.equal(verifiedNormalizationOccurrence(native, { ...record, spotifyId: 'wrong' }), undefined);
  assert.equal(verifiedNormalizationOccurrence({ ...native, artist: 'King Gizzard tribute' }, record), undefined);
  for (const change of [
    { date: '2027-06-10' }, { artist: 'Iron Maiden' }, { country: 'BE' },
    { city: 'Paris' }, { venue: 'Different Hall' }, { originalSource: 'untrusted.example' },
    { sourceEventUrl: 'https://www.bandsintown.com/e/999999' },
    { sourceEventUrl: peer.sourceEventUrl + '&session=late' },
    { ticketUrl: 'https://www.bandsintown.com/t/999999' }, { startTime: '21:00' }
  ]) {
    for (const rows of [[native, { ...peer, ...change }], [{ ...peer, ...change }, native]]) {
      assert.equal((await processRows(rows)).length, 2, JSON.stringify(change));
    }
  }
  for (const change of [
    { eventUrl: native.eventUrl + '?session=late' },
    { sourceEventUrl: 'https://radiant-bellevue.fr/spectacles/other/' },
    { ticketUrl: 'https://billetterie.radiant-bellevue.fr/fr/meeting/1575/other' },
    { startTime: '21:00' }
  ]) {
    assert.equal((await processRows([{ ...native, ...change }, peer])).length, 2, JSON.stringify(change));
  }
  // Moving both rows to another day must not extend the captured proof.
  assert.equal((await processRows([native, peer].map(r => ({ ...r, date: '2027-06-10' })))).length, 2);
  // The same pair of city labels cannot become a global alias for another artist.
  assert.equal((await processRows([native, peer].map(r => ({ ...r, artist: 'Iron Maiden' })))).length, 2);
});

test('Radiant proof cannot bridge distinct same-source events, sessions or known times', async () => {
  const { native, peer } = await fixtures();
  const otherBit = { ...peer, sourceEventUrl: 'https://www.bandsintown.com/e/999999', ticketUrl: 'https://www.bandsintown.com/t/999999' };
  const otherSession = { ...native, eventUrl: native.eventUrl + '?session=late' };
  for (const extra of [otherBit, otherSession, { ...peer, startTime: '21:00' }]) {
    for (const rows of [[native, peer, extra], [extra, peer, native], [peer, native, extra]]) {
      const output = await processRows(rows);
      assert.equal(output.length, 3, 'ambiguous rows must not attach to either distinct session');
    }
  }
  for (const rows of [[{ ...native, startTime: '19:00' }, { ...peer, startTime: '21:00' }],
    [{ ...peer, startTime: '21:00' }, { ...native, startTime: '19:00' }]]) {
    assert.deepEqual((await processRows(rows)).map(r => r.startTime).sort(), ['19:00', '21:00']);
  }
});
