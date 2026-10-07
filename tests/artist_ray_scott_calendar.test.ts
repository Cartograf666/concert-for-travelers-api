import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { scrape } from '../src/engine/custom/artist-ray-scott.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const fixture = 'tests/fixtures/artist-ray-scott-calendar-20261007.html';

async function source() {
  return ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-ray-scott.json', 'utf8')));
}

test('rendered official Ray Scott widget yields seven dated native events', async () => {
  const config = await source();
  assert.equal(config.type, 'playwright_render');
  assert.equal(config.renderParser, 'custom_js');
  assert.equal(config.renderWaitSelector, 'rr-bandsintown-widget .bit-event');
  const rows = await scrape(config, await readFile(fixture, 'utf8'), '2026-10-07T00:00:00Z');
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map(row => [row.artist, row.date, row.venue, row.city, row.country]), [
    ['Ray Scott', '2026-10-07', 'St. Augustine Shores Club', 'St. Augustine', 'US'],
    ['Ray Scott', '2026-10-08', 'Pensacola Beach Yacht Club', 'Pensacola Beach', 'US'],
    ['Ray Scott', '2026-10-22', 'Chuck Mathena Center', 'Princeton', 'US'],
    ['Ray Scott', '2026-10-24', 'Tower Event & Conference Center', 'Marietta', 'US'],
    ['Ray Scott', '2026-11-07', 'Studio 117', 'Coshocton', 'US'],
    ['Ray Scott', '2026-11-27', 'Hard Rock Hotel And Casino Tulsa', 'Catoosa', 'US'],
    ['Ray Scott', '2026-11-28', 'Cherokee Casino Fort Gibson', 'Fort Gibson', 'US']
  ]);
  assert.ok(rows.every(row => row.ticketUrl?.startsWith('https://www.bandsintown.com/e/') &&
    row.originalSource === config.domain));
});

test('native calendar identity, freshness and completeness guard fail closed', async () => {
  const config = await source();
  const original = await readFile(fixture, 'utf8');
  const cases = [
    original.replace('artist_id=4110', 'artist_id=9999'),
    original.replace('Ray%20Scott', 'Other%20Act'),
    original.replace('rr-bandsintown-widget', 'unrelated-widget'),
    original.replace('2026-10-08T19:00:00', '2026-02-30T19:00:00'),
    original.replace('"addressCountry":"United States"', '"addressCountry":""'),
    original.replace('655 Pensacola Beach Blvd', '999 Unverified Road'),
    original.replace('"name":"Ray Scott"', '"name":"Other Act"')
  ];
  const $ = cheerio.load(original);
  $('.bit-event').first().remove();
  cases.push($.html());
  for (const html of cases) {
    await assert.rejects(scrape(config, html, '2026-10-07T00:00:00Z'));
  }
});
