import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as cheerio from 'cheerio';
import { loadConfigs, runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import { scrape as maiden } from '../src/engine/custom/artist-iron-maiden.js';
import { scrape as bluetones } from '../src/engine/custom/artist-the-bluetones.js';
import { scrape as matthew } from '../src/engine/custom/artist-matthew-good-cn-centre.js';
import { scrape as charrues } from '../src/engine/custom/artist-muse-vieilles-charrues.js';
import { scrape as eurocks } from '../src/engine/custom/artist-muse-eurockeennes.js';
const captured = '2026-10-28T00:00:00.000Z';
const sources = [
  { id: 'artist-iron-maiden', fixture: 'maiden', parse: maiden, artist: 'Iron Maiden', dates: ['2027-05-14', '2027-05-16'] },
  { id: 'artist-the-bluetones', fixture: 'bluetones', parse: bluetones, artist: 'The Bluetones', dates: ['2027-05-08'] },
  { id: 'artist-matthew-good-cn-centre', fixture: 'matthew', parse: matthew, artist: 'Matthew Good', dates: ['2026-12-15'] },
  { id: 'artist-muse-vieilles-charrues', fixture: 'charrues', parse: charrues, artist: 'Muse', dates: ['2027-07-15'] },
  { id: 'artist-muse-eurockeennes', fixture: 'eurocks-home', parse: eurocks, artist: 'Muse', dates: ['2027-07-05'] }
];
const fixture = (name: string) => readFile(`tests/fixtures/official-remaining-20261028/${name}.html`, 'utf8');
const config = async (id: string) => (await loadConfigs('scrapers/artists')).find(c => c.id === id)!;

test('normal artist loader → real custom module → raw → unchanged process accepts all six accessible target dates', async () => {
  const html = new Map(await Promise.all(sources.map(async s => [`/${s.id}`, await fixture(s.fixture)] as const)));
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html.get(req.url || '') || ''); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const dir = await mkdtemp(join(tmpdir(), 'official-remaining-'));
  try {
    // Isolated approved identity list exercises the real pipeline without editing
    // artist shards or granting source-wide authority. Integration uses real DB.
    const approved = join(dir, 'approved.json');
    await writeFile(approved, JSON.stringify(sources.map(s => ({ name: s.artist }))));
    for (const s of sources) {
      const c = await config(s.id); assert.ok(c, `${s.id} discovered`);
      const result = await runScraper({ ...c, url: `http://localhost:${address.port}/${s.id}` });
      assert.equal(result.success, true, `${s.id}: ${result.reason}`);
      const published = await processConcerts(result.concerts, approved, captured);
      for (const date of s.dates) {
        assert.equal(result.concerts.filter(r => r.date === date && r.artist === s.artist).length, 1, `${s.id} raw ${date}`);
        assert.equal(published.filter(r => r.date === date && r.artist === s.artist).length, 1, `${s.id} process ${date}`);
      }
      assert.ok(result.concerts.every(r => r.originalSource === c.domain));
      assert.ok(result.concerts.every(r => r.ticketUrl !== c.url));
    }
  } finally { server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('all source parsers reject empty/malformed pages and preserve native identities', async () => {
  for (const s of sources) {
    const c = await config(s.id);
    assert.deepEqual(await s.parse(c, '', captured), []);
    assert.deepEqual(await s.parse(c, '<html><script type="application/ld+json">{bad</script></html>', captured), []);
    const original = await fixture(s.fixture);
    const wrongIdentity = original.replaceAll(s.artist, 'Unrelated Performer').replaceAll(s.artist.toUpperCase(), 'UNRELATED PERFORMER');
    assert.deepEqual(await s.parse(c, wrongIdentity, captured), [], `${s.id} wrong artist`);
  }
});

test('Iron Maiden reads calendar rows, not guest artists, onsale dates, or invalid/cancelled rows', async () => {
  const c = await config('artist-iron-maiden'); const html = await fixture('maiden');
  const raw = await maiden(c, html, captured);
  assert.deepEqual(raw.map(r => r.date), ['2027-04-14','2027-04-16','2027-04-18','2027-04-20','2027-04-22','2027-04-24','2027-04-26','2027-04-28','2027-05-01','2027-05-02','2027-05-05','2027-05-07','2027-05-09','2027-05-11','2027-05-14','2027-05-16']);
  assert.ok(raw.every(r => r.artist === 'Iron Maiden'));
  const $ = cheerio.load(html);
  $('.tour-info-row').each((_, el) => { $(el).children().first().text('31 Feb 2027'); });
  assert.deepEqual(await maiden(c, $.html(), captured), []);
  $('.tour-info-row').each((_, el) => { $(el).children().first().text('14 May 2027'); $(el).append('<span>Cancelled</span>'); });
  assert.deepEqual(await maiden(c, $.html(), captured), []);
});

test('Bluetones scope excludes the separate acoustic identity and cancellation/invalid dates', async () => {
  const c = await config('artist-the-bluetones'); const html = await fixture('bluetones');
  const raw = await bluetones(c, html, captured);
  assert.deepEqual(raw.map(r => r.date), ['2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-05','2026-11-06','2026-11-07','2026-11-08','2026-11-13','2027-04-30','2027-05-08','2027-08-20']);
  assert.equal(raw.some(r => r.date === '2026-12-10'), false);
  assert.equal(raw.find(r => r.date === '2027-05-08')?.ticketUrl, 'https://guiseleysounds.co.uk/guiseley-sounds-festival-2027-tickets/');
  const $ = cheerio.load(html);
  $('tr.gigpress-row').each((_, el) => { $(el).find('.gigpress-date').text('31/02/27'); });
  assert.deepEqual(await bluetones(c, $.html(), captured), []);
  $('tr.gigpress-row').each((_, el) => { $(el).find('.gigpress-date').text('08/05/27'); $(el).append('<td>Cancelled</td>'); });
  assert.deepEqual(await bluetones(c, $.html(), captured), []);
});

test('CN Centre requires exact bill, local ISO calendar day, venue and noncancelled description', async () => {
  const c = await config('artist-matthew-good-cn-centre'); const html = await fixture('matthew');
  const raw = await matthew(c, html, captured);
  assert.equal(raw[0]?.date, '2026-12-15'); // Do not shift to Dec 16 UTC.
  assert.equal(raw[0]?.eventUrl, c.url);
  assert.notEqual(raw[0]?.ticketUrl, c.url);
  assert.deepEqual(await matthew(c, html.replaceAll('2026-12-15T', '2026-02-30T'), captured), []);
  const $ = cheerio.load(html); $('main .field--name-body').prepend('<p>Event postponed</p>');
  assert.deepEqual(await matthew(c, $.html(), captured), []);
});

test('Muse uses a performer card and edition year, never the four-day festival window', async () => {
  const c = await config('artist-muse-vieilles-charrues'); const html = await fixture('charrues');
  assert.deepEqual((await charrues(c, html, captured)).map(r => r.date), ['2027-07-15']);
  assert.deepEqual(await charrues(c, html.replace('JEUDI 15 JUILLET', '15–18 JUILLET'), captured), []);
  assert.deepEqual(await charrues(c, html.replace('JEUDI 15 JUILLET', 'JEUDI 32 JUILLET'), captured), []);
  assert.deepEqual(await charrues(c, html.replace('JEUDI 15 JUILLET', 'ANNULÉ JEUDI 15 JUILLET'), captured), []);
});

test('Eurocks source title explicitly owns Muse and day; ignores duplicate cards and dated festival windows', async () => {
  const c = await config('artist-muse-eurockeennes'); const html = await fixture('eurocks-home');
  assert.deepEqual((await eurocks(c, html, captured)).map(r => r.date), ['2027-07-05']);
  assert.deepEqual(await eurocks(c, html.replaceAll('MUSE clôture le festival lundi 5 juillet 2027', 'MUSE annulé lundi 5 juillet 2027'), captured), []);
  assert.deepEqual(await eurocks(c, html.replaceAll('MUSE clôture le festival lundi 5 juillet 2027', 'MUSE clôture le festival du 2 au 5 juillet 2027'), captured), []);
  assert.deepEqual(await eurocks(c, html.replaceAll('MUSE clôture le festival lundi 5 juillet 2027', 'MUSE clôture le festival lundi 32 juillet 2027'), captured), []);
});
