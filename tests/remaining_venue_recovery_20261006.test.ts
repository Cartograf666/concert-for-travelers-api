import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { scrape as scrapeMajestic } from '../src/engine/custom/majestic-music-club-bratislava.js';
import { scrape as scrapeRust } from '../src/engine/custom/rust-copenhagen.js';
import { scrape } from '../src/engine/custom/artist-antones-records.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
const config = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/artist-antones-records.json', 'utf8')));
const body = readFileSync('tests/fixtures/remaining-venue-20261006/antones-calendar.json', 'utf8');
const stamp = '2026-10-06T00:00:00Z';

test("Antone's loaded calendar yields complete dated concerts and excludes venue history visits", async () => {
  const rows = await scrape(config, body, stamp);
  assert.equal(rows.length, 17);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].venue, rows[0].city, rows[0].country],
    ['LAUNDRY DAY Presents: The Larger Than LIFE Tour w/ Illusion Hills', '2026-10-07', "Antone's Nightclub", 'Austin', 'US']);
  assert.ok(rows.every(row => row.date! >= '2026-10-06' && row.ticketUrl?.startsWith('https://')));
  assert.ok(!rows.some(row => row.artist?.includes('Guided Full Venue History Tour')));
  const blueMondays = rows.filter(row => ['2026-10-12', '2026-10-19'].includes(row.date!));
  assert.deepEqual(blueMondays.map(row => row.artist), ['Soul Man Sam', 'Soul Man Sam']);
  assert.ok(!rows.some(row => row.artist?.includes('Blue Monday')));
});

test("Antone's rejects an incomplete calendar and mismatched event detail instead of a false success", async () => {
  await assert.rejects(scrape(config, '{"events":[]}', stamp), /incomplete/);
  const wrong = JSON.parse(body); wrong.events[0].url = '#tw-event-dialog-5239';
  await assert.rejects(scrape(config, JSON.stringify(wrong), stamp), /relationship/);
  const missing = JSON.parse(body); missing.popupdata = '';
  await assert.rejects(scrape(config, JSON.stringify(missing), stamp), /missing its matching detail/);
});


test('RUST official calendar preserves explicit dates and public ticket links', async () => {
  const c = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/rust-copenhagen.json', 'utf8')));
  const html = readFileSync('tests/fixtures/remaining-venue-20261006/rust-concerts.html', 'utf8');
  const rows = await scrapeRust(c, html, stamp);
  assert.deepEqual(rows.map(row => [row.artist, row.date]), [['Infinity Knives & Brian Ennals (US)', '2026-10-05'], ['Wolf Eyes (US)', '2026-10-06']]);
  assert.ok(rows.every(row => row.ticketUrl?.startsWith('https://')));
  await assert.rejects(scrapeRust(c, html.replace('20261005', '20260230'), stamp), /explicit calendar date/);
  await assert.rejects(scrapeRust(c, html.replace('20261005', '1005'), stamp), /explicit calendar date/);
});

test('Majestic retains Monday performances instead of dropping their Slovak weekday dates', async () => {
  const c = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/majestic-music-club-bratislava.json', 'utf8')));
  const html = readFileSync('tests/fixtures/remaining-venue-20261006/majestic-program.html', 'utf8');
  const rows = await scrapeMajestic(c, html, stamp);
  assert.deepEqual(rows.map(row => [row.artist, row.date]), [['MORGENSHTERN', '2026-11-02'], ['REDZED', '2026-11-16'], ['JAREK NOHAVICA', '2026-12-07']]);
  assert.ok(rows.every(row => row.city === 'Bratislava' && row.country === 'SK' && row.ticketUrl?.startsWith('https://majestic.sk/')));
  await assert.rejects(scrapeMajestic(c, html.replace('02.11.2026', '02.11'), stamp), /explicit date/);
  await assert.rejects(scrapeMajestic(c, html.replace('02.11.2026', '30.02.2026'), stamp), /explicit date/);
});
