import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';
import { runScraper } from '../src/engine/runner.js';
import { scrape } from '../src/engine/custom/artist-ivar-grydeland.js';
import { parseDate, normalizeCountry } from '../src/pipeline/process.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const scrapedAt = '2026-10-06T12:00:00.000Z';
const fixturePath = 'tests/fixtures/ivar-grydeland-recovery-20261006/official-upcoming.html';

async function source() {
  return ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-ivar-grydeland.json', 'utf8')));
}

test('official Ivar Grydeland Upcoming block retains all six explicitly dated archive rows', async (t) => {
  const html = await readFile(fixturePath, 'utf8');
  const config = await source();
  assert.equal(config.url, 'https://www.ivargrydeland.com/concerts');
  assert.equal(config.allowEmpty, undefined);
  assert.equal(config.selectors?.countryNameFallback, 'AU');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 6);
  assert.deepEqual(result.concerts.map(({ date, venue, city, country }) => ({ date, venue, city, country })), [
    { date: '2026-05-31', venue: 'Living Room Theatre', city: 'Sydney', country: 'Australia' },
    { date: '2026-06-01', venue: 'Tempo Rubato', city: 'Melbourne', country: 'Australia' },
    { date: '2026-06-03', venue: 'COMA', city: 'Adelaide', country: 'Australia' },
    { date: '2026-06-05', venue: 'TAC', city: 'Canberra', country: 'Australia' },
    { date: '2026-06-06', venue: 'Liquid Architecture', city: 'Melbourne', country: 'Australia' },
    { date: '2026-06-07', venue: 'Castlemaine Jazz Festival', city: 'Castlemaine', country: 'Australia' }
  ]);
  assert.ok(result.concerts.every(item => parseDate(item.date!, scrapedAt)! < '2026-10-06'));
  assert.ok(result.concerts.every(item => normalizeCountry(item.country!) === 'AU'));
});

test('same structure remains usable for future dated events', async () => {
  const html = await readFile(fixturePath, 'utf8');
  const concerts = await scrape(await source(), html.replace('<p>2026:</p>', '<p>2027:</p>'), scrapedAt);
  assert.equal(concerts.length, 6);
  assert.equal(parseDate(concerts[0].date!, scrapedAt), '2027-05-31');
  assert.equal(concerts[5].venue, 'Castlemaine Jazz Festival');
  assert.ok(concerts.every(item => parseDate(item.date!, scrapedAt)! > '2026-10-06'));
  const germany = await scrape(await source(), html.replace('Sydney, Australia', 'Berlin, Germany')
    .replace('<p>2026:</p>', '<p>2027:</p>'), scrapedAt);
  assert.equal(germany[0].country, 'Germany', 'country comes from the row, never from the schema fallback');
});

test('missing calendar structure or malformed dated rows fail instead of silently returning partial data', async () => {
  const html = await readFile(fixturePath, 'utf8');
  const config = await source();
  await assert.rejects(scrape(config, html.replace('<p>Upcoming</p>', ''), scrapedAt), /calendar is missing/);
  await assert.rejects(scrape(config, html.replace('<p>2026:</p>', ''), scrapedAt), /no printed year/);
  await assert.rejects(scrape(config, html.replace('3rd June:', '3rd Jun:'), scrapedAt), /unrecognized date or row/);
  await assert.rejects(scrape(config, html.replace('5th June:', '32nd June:'), scrapedAt), /invalid calendar date/);
  await assert.rejects(scrape(config, html.replace('Sydney, Australia', 'Sydney'), scrapedAt), /unrecognized venue or location/);
  await assert.rejects(scrape(config, html.replace('<p>Concert history</p>', ''), scrapedAt), /calendar is incomplete/);
});
