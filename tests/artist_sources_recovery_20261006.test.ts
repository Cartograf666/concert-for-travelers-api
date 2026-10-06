import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { runScraper } from '../src/engine/runner.js';
import { scrape as scrapeTencc } from '../src/engine/custom/artist-10cc.js';
import { scrape as scrapeAust } from '../src/engine/custom/artist-aust.js';
import { scrape as scrapeDavid } from '../src/engine/custom/artist-david-kikoski.js';
import { scrape as scrapeDan } from '../src/engine/custom/artist-dan-deacon.js';
import { scrape as scrapeLadyA } from '../src/engine/custom/artist-lady-antebellum.js';
import { scrape as scrapeRick } from '../src/engine/custom/artist-rick-braun.js';
import { scrape as scrapeEmancipator } from '../src/engine/custom/artist-emancipator.js';
import { scrape as scrapeGiora } from '../src/engine/custom/artist-giora-feidman.js';
import { scrape as scrapeParalamas } from '../src/engine/custom/artist-paralamas-do-sucesso.js';

const fixtures = path.join(process.cwd(), 'tests/fixtures/artist-sources-recovery-20261006');
const scrapedAt = '2026-10-06T12:00:00.000Z';

async function config(id: string) {
  return ScraperConfigSchema.parse(JSON.parse(await readFile(path.join(process.cwd(), 'scrapers/artists', `${id}.json`), 'utf8')));
}

async function fixture(id: string) {
  return readFile(path.join(fixtures, `${id}.html`), 'utf8');
}

test('10cc reads table heading years and distinct countries without reviving past dates', async () => {
  const concerts = await scrapeTencc(await config('artist-10cc'), await fixture('artist-10cc'), scrapedAt);
  assert.equal(concerts.length, 42);
  assert.ok(concerts.every((concert) => (concert.date || '') >= '2026-10-06'));
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-11-17', 'DR Koncerthuset', 'Copenhagen', 'DK']);
  assert.ok(concerts.some((concert) => concert.country === 'FI'));
  assert.ok(concerts.some((concert) => concert.country === 'GB'));
  const duda = await scrapeTencc(await config('artist-10cc'), JSON.stringify({ content: await fixture('artist-10cc') }), scrapedAt);
  assert.equal(duda.length, 42);
});

test('AUST official Next Event keeps explicit year, Swiss location and venue', async () => {
  const concerts = await scrapeAust(await config('artist-aust'), await fixture('artist-aust'), scrapedAt);
  assert.equal(concerts.length, 1);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-10-11', 'Papiersaal w/ Tender', 'Zurich', 'CH']);
  assert.match(concerts[0].ticketUrl || '', /^https:\/\/www\.seetickets\.com\/ch\//);
});

test('David Kikoski uses the current official domain and real venue fields', async () => {
  const source = await config('artist-david-kikoski');
  assert.equal(source.url, 'https://www.davidkikoski.com/events');
  const concerts = await scrapeDavid(source, await fixture('artist-david-kikoski'), scrapedAt);
  assert.equal(concerts.length, 11);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-10-12', 'The Pocket', 'New York', 'US']);
  assert.deepEqual([concerts[9].city, concerts[9].country], ['New York', 'US']);
});

test('Dan Deacon rows keep date, venue and city separate', async () => {
  const concerts = await scrapeDan(await config('artist-dan-deacon'), await fixture('artist-dan-deacon'), scrapedAt);
  assert.equal(concerts.length, 6);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-11-06', '29th Street Ballroom', 'Austin', 'US']);
  assert.deepEqual([concerts[5].date, concerts[5].venue, concerts[5].city, concerts[5].country],
    ['2027-03-18', 'Blue Note Hawaii', 'Honolulu', 'US']);
});

test('Emancipator follows the official Seated widget feed with local event dates', async () => {
  const source = await config('artist-emancipator');
  assert.equal(source.url, 'https://cdn.seated.com/api/tour/0410bcb7-a835-464c-b3ef-d7855c3ecbdc?include=tour-events');
  const feed = await readFile(path.join(fixtures, 'artist-emancipator.json'), 'utf8');
  const links = JSON.parse(await readFile(path.join(fixtures, 'artist-emancipator-widget-links.json'), 'utf8')) as string[];
  const concerts = await scrapeEmancipator(source, feed, scrapedAt);
  assert.equal(concerts.length, 12);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-11-05', 'Crystal Ballroom at Somerville Theatre', 'Somerville', 'US']);
  assert.deepEqual([concerts[3].date, concerts[3].venue, concerts[3].city, concerts[3].country],
    ['2026-11-19', 'Hollywood Theatre', 'Vancouver', 'CA']);
  assert.deepEqual(new Set(concerts.map((concert) => concert.ticketUrl)), new Set(links));
});

test('Emancipator rejects incomplete referenced events while excluding a valid past date', async () => {
  const source = await config('artist-emancipator');
  const original = JSON.parse(await readFile(path.join(fixtures, 'artist-emancipator.json'), 'utf8'));
  const changed = () => structuredClone(original);
  const parse = (feed: typeof original) => scrapeEmancipator(source, JSON.stringify(feed), scrapedAt);

  const missing = changed();
  missing.included.shift();
  await assert.rejects(parse(missing), /tour-event .* is missing/);

  const noVenue = changed();
  delete noVenue.included[0].attributes['venue-name'];
  await assert.rejects(parse(noVenue), /invalid venue or location/);

  const invalidDate = changed();
  invalidDate.included[0].attributes['starts-at-date-local'] = '2026-02-30';
  await assert.rejects(parse(invalidDate), /invalid date/);

  const noCity = changed();
  noCity.included[0].attributes['formatted-address'] = ', CA';
  await assert.rejects(parse(noCity), /invalid venue or location/);

  const unknownRegion = changed();
  unknownRegion.included[0].attributes['formatted-address'] = 'Los Angeles, ZZ';
  await assert.rejects(parse(unknownRegion), /unrecognized country or region/);

  const duplicate = changed();
  duplicate.included.push(structuredClone(duplicate.included[0]));
  await assert.rejects(parse(duplicate), /is duplicated/);

  const past = changed();
  past.included[0].attributes['starts-at-date-local'] = '2026-10-05';
  const concerts = await parse(past);
  assert.equal(concerts.length, 11);
  assert.ok(concerts.every((concert) => concert.ticketUrl !== `https://link.seated.com/${past.included[0].id}`));
});

test('Emancipator parser failure keeps the last good runner cache unchanged', async (t) => {
  const source = await config('artist-emancipator');
  const original = JSON.parse(await readFile(path.join(fixtures, 'artist-emancipator.json'), 'utf8'));
  const damaged = structuredClone(original);
  delete damaged.included[0].attributes['venue-name'];
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(damaged));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const cachedConcerts = await scrapeEmancipator(source, JSON.stringify(original), scrapedAt);
  const cache = { concerts: cachedConcerts, scrapedAt, verifiedAt: scrapedAt, contentHash: 'last-good' };
  const snapshot = structuredClone(cache);
  const result = await runScraper({
    ...source, url: `http://127.0.0.1:${address.port}/tour`, maxRetries: 0
  }, cache);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'parse_error');
  assert.match(result.error || '', /invalid venue or location/);
  assert.deepEqual(cache, snapshot);
});

test('Lady A widget exposes all rows while only using eight Ticketmaster-verified venues', async () => {
  const source = await config('artist-lady-antebellum');
  assert.match(source.url, /^https:\/\/rest\.bandsintown\.com\/artists\/id_6132\/events/);
  const body = await readFile(path.join(fixtures, 'artist-lady-antebellum.json'), 'utf8');
  const concerts = await scrapeLadyA(source, body, scrapedAt);
  assert.equal(concerts.length, 9);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city],
    ['2026-12-10', 'Northfield Park Racino - Center Stage', 'Northfield']);
  assert.equal(concerts.filter((concert) => concert.date === '2026-12-21').length, 2);
  assert.ok(concerts.every((concert) => concert.venue !== "This Winter's Night Tour"));
  assert.deepEqual([concerts[8].date, concerts[8].venue, concerts[8].city, concerts[8].country],
    ['2027-02-07', undefined, 'Miami', 'US']);
  assert.equal(concerts[8].ticketUrl, JSON.parse(body)[8].url);
  const wrongArtist = JSON.parse(body);
  wrongArtist[0].artist_id = 'wrong';
  await assert.rejects(scrapeLadyA(source, JSON.stringify(wrongArtist), scrapedAt), /artist identity/);
  const changedKnown = JSON.parse(body);
  changedKnown[0].venue.city = 'Chicago';
  await assert.rejects(scrapeLadyA(source, JSON.stringify(changedKnown), scrapedAt), /no longer matches/);
  const unknownFuture = JSON.parse(body);
  unknownFuture.push({
    ...unknownFuture[0], id: '999999999', datetime: '2027-05-04T20:00:00',
    url: 'https://www.bandsintown.com/e/999999999',
    venue: { ...unknownFuture[0].venue, city: 'Toronto', country: 'Canada', name: 'Tour title only' }
  });
  const withFuture = await scrapeLadyA(source, JSON.stringify(unknownFuture), scrapedAt);
  assert.deepEqual([withFuture[9].date, withFuture[9].venue, withFuture[9].city, withFuture[9].country],
    ['2027-05-04', undefined, 'Toronto', 'CA']);
  unknownFuture[9].datetime = '2027-02-30T20:00:00';
  await assert.rejects(scrapeLadyA(source, JSON.stringify(unknownFuture), scrapedAt), /invalid date/);
  unknownFuture[9].datetime = '2027-05-04T20:00:00';
  unknownFuture[9].venue.country = 'Unknown Country';
  await assert.rejects(scrapeLadyA(source, JSON.stringify(unknownFuture), scrapedAt), /unrecognized country/);
});

test('Rick Braun official widget excludes tour-title and cruise placeholders', async () => {
  const source = await config('artist-rick-braun');
  assert.match(source.url, /^https:\/\/rest\.bandsintown\.com\/artists\/id_46323\/events/);
  const body = await readFile(path.join(fixtures, 'artist-rick-braun.json'), 'utf8');
  const concerts = await scrapeRick(source, body, scrapedAt);
  assert.equal(concerts.length, 3);
  assert.deepEqual(concerts.map((concert) => concert.venue), ["Yoshi's", 'Trilith Live', 'The Tin Pan']);
  assert.ok(concerts.every((concert) => concert.country === 'US'));
});

test('Giora Feidman rows preserve explicit dates and distinguish LI, CH and DE', async () => {
  const concerts = await scrapeGiora(await config('artist-giora-feidman'), await fixture('artist-giora-feidman'), scrapedAt);
  assert.equal(concerts.length, 61);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-10-21', 'Theater am Kirchplatz', 'Schaan', 'LI']);
  assert.deepEqual([concerts[1].city, concerts[1].country], ['Thun', 'CH']);
  assert.deepEqual([concerts[5].city, concerts[5].country], ['Konstanz', 'DE']);
  assert.ok(concerts.every((concert) => !concert.ticketUrl || concert.ticketUrl.startsWith('https://')));
  const duda = await scrapeGiora(await config('artist-giora-feidman'), JSON.stringify({ content: await fixture('artist-giora-feidman') }), scrapedAt);
  assert.equal(duda.length, 61);
});

test('Paralamas parses Portuguese dates and excludes cruises without a concert city', async () => {
  const concerts = await scrapeParalamas(await config('artist-paralamas-do-sucesso'), await fixture('artist-paralamas-do-sucesso'), scrapedAt);
  assert.equal(concerts.length, 8);
  assert.deepEqual([concerts[0].date, concerts[0].venue, concerts[0].city, concerts[0].country],
    ['2026-10-08', 'Auditório do Multicenter Sebrae (SESSÃO EXTRA)', 'São Luís', 'BR']);
  assert.deepEqual([concerts[7].date, concerts[7].city, concerts[7].country], ['2027-03-06', 'Montes Claros', 'BR']);
});

test('each declared empty schedule has an exact saved official HTML phrase', async () => {
  const proofs = JSON.parse(await readFile(path.join(fixtures, 'empty-schedule-proof.json'), 'utf8')) as Array<{
    id: string; url: string; marker: string; htmlFragment: string
  }>;
  assert.equal(proofs.length, 12);
  for (const proof of proofs) {
    const source = await config(proof.id);
    assert.equal(source.url, proof.url, proof.id);
    assert.equal(source.allowEmpty, true, proof.id);
    assert.equal(source.emptyScheduleText, proof.marker, proof.id);
    assert.ok(proof.htmlFragment.includes(proof.marker), proof.id);
  }
});

test('empty schedule marker accepts current proof but missing marker remains a failure', async () => {
  const proof = (JSON.parse(await readFile(path.join(fixtures, 'empty-schedule-proof.json'), 'utf8')) as Array<{
    id: string; marker: string; htmlFragment: string
  }>).find((item) => item.id === 'artist-the-cure');
  assert.ok(proof);
  const html = `<!doctype html><html><body>${proof.htmlFragment}</body></html>`;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url?.includes('missing') ? html.replace(proof.marker, 'Schedule unavailable') : html);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const source = await config('artist-the-cure');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const empty = await runScraper({ ...source, url: `${baseUrl}/empty` });
    assert.equal(empty.success, true);
    assert.equal(empty.reason, 'empty_schedule');
    const missing = await runScraper({ ...source, url: `${baseUrl}/missing` });
    assert.equal(missing.success, false);
    assert.notEqual(missing.reason, 'empty_schedule');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
