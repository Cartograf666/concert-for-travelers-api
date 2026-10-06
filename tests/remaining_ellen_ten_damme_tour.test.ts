import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { runScraper } from '../src/engine/runner.js';
import { scrape } from '../src/engine/custom/artist-ellen-ten-damme.js';
import { parseDate } from '../src/pipeline/process.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const scrapedAt = '2026-10-06T12:00:00.000Z';
const fixture = 'tests/fixtures/remaining_ellen_ten_damme_tour.html';

async function source() {
  return ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artists/artist-ellen-ten-damme.json', 'utf8')));
}

test('Ellen ten Damme official upcoming table preserves all 62 fully printed Dutch dates', async (t) => {
  const html = await readFile(fixture, 'utf8');
  const $ = cheerio.load(html);
  const oldDateTexts = $('table.shows.show-upcoming tr').map((_, row) =>
    $(row).find('td.event-field-datetime').text().trim()).get();
  assert.equal(oldDateTexts.length, 62);
  assert.equal(oldDateTexts.filter(date => parseDate(date, scrapedAt)).length, 32,
    'the previous whole-cell selector dropped 30 genuine rows');

  const config = await source();
  assert.equal(config.url, 'https://ellentendamme.nl/tour');
  assert.equal(config.allowEmpty, undefined);
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 62);
  assert.deepEqual([result.concerts[0].date, result.concerts[0].startTime, result.concerts[0].city],
    ['2026-10-09', '20:15', 'Wassenaar']);
  assert.deepEqual([result.concerts[22].date, result.concerts[22].city], ['2027-03-03', 'Hellevoetsluis']);
  assert.deepEqual([result.concerts[49].date, result.concerts[49].city], ['2027-05-01', 'Houten']);
  assert.deepEqual([result.concerts[61].date, result.concerts[61].city], ['2027-05-29', 'Delft']);
  assert.ok(result.concerts.every(item => item.date! >= '2026-10-06' && item.country === 'NL' && item.venue && item.city));
});

test('Ellen ten Damme new printed year works; unknown country, bad date and empty table fail', async (t) => {
  const html = await readFile(fixture, 'utf8');
  const config = await source();
  const future = html.replace('9 okt 2026', '9 okt 2028');
  assert.equal((await scrape(config, future, scrapedAt))[0].date, '2028-10-09');
  await assert.rejects(scrape(config, html.replace('> Wassenaar</a>', '> Antwerpen</a>'), scrapedAt), /unverified country/);
  await assert.rejects(scrape(config, html.replace('9 okt 2026', '9 okt'), scrapedAt), /complete printed date/);
  await assert.rejects(scrape(config, html.replace('9 okt 2026', '32 okt 2026'), scrapedAt), /invalid calendar date/);
  await assert.rejects(scrape(config, html.replace('20:15', '25:15'), scrapedAt), /invalid start time/);
  await assert.rejects(scrape(config, html.replace('Tour | Ellen ten Damme', 'Tour | Another Artist'), scrapedAt), /official upcoming tour table is missing/);
  const noRows = html.replaceAll(/<tr[^>]*>.*?<\/tr>/gs, '');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: noRows, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'selectors_stale');
});
