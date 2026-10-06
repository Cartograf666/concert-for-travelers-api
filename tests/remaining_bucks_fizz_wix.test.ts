import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { runScraper } from '../src/engine/runner.js';
import { scrape } from '../src/engine/custom/artist-bucks-fizz.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const scrapedAt = '2026-10-06T18:00:00.000Z';
const fixture = 'tests/fixtures/artist-bucks-fizz-tour-20261006.html';
const source = async () => ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-bucks-fizz.json', 'utf8')));

test('The Fizz current Wix calendar yields all 15 printed shows with country and source provenance', async (t) => {
  const html = await readFile(fixture, 'utf8');
  const $ = cheerio.load(html);
  assert.equal($('.html-section-item.html-section-event-row').length, 0, 'stale selector finds no current Wix events');
  const config = await source();
  assert.equal(config.type, 'custom_js');
  assert.equal(config.allowEmpty, undefined);
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 15);
  assert.deepEqual(result.concerts.slice(0, 4).map(({ date, venue, city, country }) => ({ date, venue, city, country })), [
    { date: '2026-09-11', venue: 'Retrospective Festival', city: 'St. Helens', country: 'GB' },
    { date: '2026-11-08', venue: 'Winter Pride', city: 'Maspalomas', country: 'ES' },
    { date: '2026-11-13', venue: 'Parkdean Resort', city: 'Treccobay', country: 'GB' },
    { date: '2026-11-18', venue: 'The Stables', city: 'Milton Keynes', country: 'GB' }
  ]);
  assert.deepEqual(result.concerts.at(-1) && [result.concerts.at(-1)!.date, result.concerts.at(-1)!.venue, result.concerts.at(-1)!.city],
    ['2027-11-20', 'Butlins', 'Skegness']);
  assert.equal(result.concerts.filter(row => row.date! >= '2026-10-06').length, 14);
  assert.equal(result.concerts[1].ticketUrl, 'https://www.winterpride.com/');
  assert.equal(result.concerts[3].ticketUrl, 'https://stables.org/boxoffice/ticket/465801');
  assert.equal(result.concerts[2].ticketUrl, undefined, 'a printed show without a ticket link remains a show');
  assert.ok(result.concerts.every(row => row.artist === 'The Fizz' && row.venue && row.city && row.country &&
    row.originalSource === config.domain && row.scrapedAt));
});

test('The Fizz parser rejects unknown country, missing fields, invalid dates, wrong identity and empty calendar', async () => {
  const html = await readFile(fixture, 'utf8');
  const config = await source();
  await assert.rejects(scrape(config, html.replace('Winter Pride, Maspalomas', 'Winter Pride, Atlantis'), scrapedAt), /unverified country/);
  await assert.rejects(scrape(config, html.replace('Winter Pride, Maspalomas', ', Maspalomas'), scrapedAt), /venue or city/);
  await assert.rejects(scrape(config, html.replace('Winter Pride, Maspalomas', 'Winter Pride, '), scrapedAt), /venue or city/);
  await assert.rejects(scrape(config, html.replace('18th November 2026', '18th November'), scrapedAt), /full printed date/);
  await assert.rejects(scrape(config, html.replace('18th November 2026', '31st February 2026'), scrapedAt), /invalid calendar date/);
  await assert.rejects(scrape(config, html.replace('TOUR | THE FIZZ', 'TOUR | Different Artist'), scrapedAt), /identity/);
  const $ = cheerio.load(html);
  $('div[data-testid="richTextElement"] p').remove();
  await assert.rejects(scrape(config, $.html(), scrapedAt), /calendar block/);
});

test('The Fizz parser accepts a newly printed valid year without a fixed-year mapping', async () => {
  const html = await readFile(fixture, 'utf8');
  const config = await source();
  const updated = html.replace('2026 DATES', '2028 DATES').replace('8th November 2026', '8th November 2028');
  const rows = await scrape(config, updated, scrapedAt);
  assert.equal(rows[1].date, '2028-11-08');
  assert.equal(rows[1].country, 'ES');
});
