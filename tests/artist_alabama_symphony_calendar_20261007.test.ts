import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-alabama-symphony-orchestra.js';
import { runScraper } from '../src/engine/runner.js';
import { parseDate } from '../src/pipeline/process.js';

const SCRAPED_AT = '2026-10-07T08:00:00.000Z';
const FIXTURE = 'tests/fixtures/artist-alabama-symphony-calendar-20261007.html';

async function source() {
  return ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artists/artist-alabama-symphony-orchestra.json', 'utf8')));
}

test('official calendar keeps adult family and education dates, excludes ASYO, and maps exact venue cities', async () => {
  const config = await source();
  const html = await readFile(FIXTURE, 'utf8');
  assert.equal(config.type, 'custom_js');
  const rows = await scrape(config, html, SCRAPED_AT);
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map(row => [row.date, row.city]), [
    ['October 7, 2026 9:30 am', 'Alabaster'],
    ['October 7, 2026 11:00 am', 'Alabaster'],
    ['November 6, 2026 7:00 pm', 'Birmingham'],
    ['November 7, 2026 7:00 pm', 'Birmingham'],
    ['February 11, 2027 11:00 am', 'Hoover'],
    ['March 2, 2027 10:00 am', 'Birmingham'],
    ['March 3, 2027 10:00 am', 'Birmingham'],
    ['March 6, 2027 11:00 am', 'Birmingham'],
    ['May 15, 2027 6:30 pm', 'Trussville']
  ]);
  assert.equal(rows.some(row => row.date === 'November 7, 2026 2:00 pm'), false);
  assert.ok(rows.every(row => row.artist === 'Alabama Symphony Orchestra' && row.country === 'US'));
  assert.ok(rows.every(row => row.ticketUrl?.startsWith('https://')));
  assert.ok(rows.every(row => parseDate(row.date!, SCRAPED_AT) !== null));
});

test('runner dispatches the source parser and unknown event facts fail loudly', async (t) => {
  const config = await source();
  const html = await readFile(FIXTURE, 'utf8');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const previous = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios';
  t.after(() => { if (previous === undefined) delete process.env.SCRAPER_HTTP_BACKEND; else process.env.SCRAPER_HTTP_BACKEND = previous; });
  const result = await runScraper(config);
  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 9);
  const unknownVenue = html.replace('Ferus Artisan Ales - Trussville', 'Unknown Venue');
  await assert.rejects(scrape(config, unknownVenue, SCRAPED_AT), /unverified venue: Unknown Venue/);
  const missingDate = html.replace('May 15, 2027 6:30 pm', 'Date TBD');
  await assert.rejects(scrape(config, missingDate, SCRAPED_AT), /no complete native date: Tunes on Tap/);
  const unsafeDetail = html.replace('https://alabamasymphony.org/concert/special-event-tunes-on-tap-ferus/', 'javascript:alert(1)');
  await assert.rejects(scrape(config, unsafeDetail, SCRAPED_AT), /no official event URL: Tunes on Tap/);
});
