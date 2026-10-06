import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { runScraper } from '../src/engine/runner.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { normalizeCountry, parseDate } from '../src/pipeline/process.js';

async function config(id: string) {
  return ScraperConfigSchema.parse(JSON.parse(await readFile(`scrapers/artists/${id}.json`, 'utf8')));
}

test('Anna Depenbusch official Termine card yields its dated Hamburg show', async (t) => {
  const html = await readFile('tests/fixtures/artist-selector-recovery-20261006/anna-termine.html', 'utf8');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(await config('artist-anna-depenbusch'));
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.concerts.map(({ artist, date, venue, city, country }) =>
    ({ artist, date, venue, city, country })), [{
    artist: 'Anna Depenbusch', date: '08. Dez. 2026', venue: 'Laeiszhalle', city: 'Hamburg', country: 'DE'
  }]);
  assert.equal(result.concerts[0].ticketUrl,
    'https://ass-concerts-and-promotion.reservix.de/p/reservix/event/2583333');
  assert.equal(parseDate(result.concerts[0].date!, '2026-10-06T00:00:00.000Z'), '2026-12-08');
});

test('Julie Fowlis public events API supplies explicit year and per-event location', async (t) => {
  const json = JSON.parse(await readFile('tests/fixtures/artist-selector-recovery-20261006/julie-events.json', 'utf8'));
  t.mock.method(axios, 'get', async () => ({ status: 200, data: json, headers: {} }));
  const cfg = await config('artist-julie-fowlis');
  assert.equal(cfg.url, 'https://www.juliefowlis.com/wp-json/tribe/events/v1/events?per_page=100');
  const result = await runScraper(cfg);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.concerts.map(({ artist, date, venue, city, country }) =>
    ({ artist, date, venue, city, country })), [{
    artist: 'Julie Fowlis', date: '2026-12-12 17:30:00', venue: 'OVO Hydro', city: 'Glasgow', country: 'United Kingdom'
  }]);
  assert.equal(result.concerts[0].ticketUrl,
    'https://www.juliefowlis.com/event/hoolie-in-the-hydro-local-hero/');
  assert.equal(parseDate(result.concerts[0].date!, '2026-10-06T00:00:00.000Z'), '2026-12-12');
  assert.equal(normalizeCountry(result.concerts[0].country!), 'GB');
});

test('Bassnectar official show rows retain source years and country evidence', async (t) => {
  const html = await readFile('tests/fixtures/artist-selector-recovery-20261006/bass-shows.html', 'utf8');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const cfg = await config('artist-bassnectar');
  const result = await runScraper(cfg);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.concerts.map(({ date, venue, city, country }) => ({ date, venue, city, country })), [
    { date: 'July 25th, 2026', venue: 'Pete Be Center', city: 'San Jose', country: 'US' },
    { date: 'December 2nd, 2012', venue: 'Stereosonic Festival', city: 'Brisbane', country: 'AU' },
    { date: 'August 6th, 2012', venue: 'Veld Festival', city: 'Toronto', country: 'CA' }
  ]);
  assert.match(result.concerts[0].ticketUrl!, /^https:\/\/bassnectar\.net\/shows\/2026\//);
  const { scrape } = await import('../src/engine/custom/artist-bassnectar.js');
  const future = await scrape(cfg, html.replace('July 25th, 2026', 'July 25th, 2027'), '2026-10-06T00:00:00.000Z');
  assert.equal(future[0].date, 'July 25th, 2027');
});

test('L. Subramaniam official archive keeps each printed year and country', async (t) => {
  const html = await readFile('tests/fixtures/artist-selector-recovery-20261006/l-subramaniam-events.html', 'utf8');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const cfg = await config('artist-l-subramaniam');
  const result = await runScraper(cfg);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.concerts.map(({ date, city, country }) => ({ date, city, country })), [
    { date: '08 Feb 2020', city: undefined, country: 'US' },
    { date: '11 Feb 2020', city: undefined, country: 'US' },
    { date: '16 Feb 2020', city: 'Delhi', country: 'IN' },
    { date: '22 May 2020', city: 'Quebec City', country: 'CA' },
    { date: '23 May 2020', city: 'Montreal', country: 'CA' },
    { date: '24 May 2020', city: 'Ottawa', country: 'CA' }
  ]);
  assert.equal(result.concerts[0].venue, 'Broomfield Auditorium');
  const { scrape } = await import('../src/engine/custom/artist-l-subramaniam.js');
  const future = await scrape(cfg, html.replace('16 Feb 2020', '16 Feb 2027'), '2026-10-06T00:00:00.000Z');
  assert.equal(future[2].date, '16 Feb 2027');
});

test('Legs Diamond official archive does not apply a US fallback to European shows', async (t) => {
  const html = await readFile('tests/fixtures/artist-selector-recovery-20261006/legs-diamond-tours.html', 'utf8');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const cfg = await config('artist-legs-diamond');
  const result = await runScraper(cfg);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.concerts.map(({ date, city, country }) => ({ date, city, country })), [
    { date: 'June 17th, 2006', city: 'San Antonio', country: 'US' },
    { date: 'June 9, 2006', city: 'Tarzana', country: 'US' },
    { date: 'January 13, 2006', city: 'Tarzana', country: 'US' },
    { date: 'October 30, 2005', city: 'Ludwigsburg', country: 'DE' },
    { date: 'May 7, 2005', city: 'Bradford', country: 'GB' }
  ]);
  const { scrape } = await import('../src/engine/custom/artist-legs-diamond.js');
  const future = await scrape(cfg, html.replace('June 17th, 2006', 'June 17th, 2027'), '2026-10-06T00:00:00.000Z');
  assert.equal(future[0].date, 'June 17th, 2027');
});
