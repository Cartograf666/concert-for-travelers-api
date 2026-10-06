import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { scrape } from '../src/engine/custom/artist-allan-stewart.js';
import { processConcerts } from '../src/pipeline/process.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const observedAt = '2026-10-06T12:00:00.000Z';
const artistFile = 'tests/fixtures/artist-allan-stewart-shows-20261006.html';
const bigFile = 'tests/fixtures/artist-allan-stewart-big-big-20261006.html';
const pinFile = 'tests/fixtures/artist-allan-stewart-pinocchio-20261006.html';
const bigUrl = 'https://www.capitaltheatres.com/shows/allan-stewarts-big-big-variety-show/';
const pinUrl = 'https://www.capitaltheatres.com/shows/pinocchio/';

async function input() {
  return {
    config: ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-allan-stewart.json', 'utf8'))),
    artist: await readFile(artistFile, 'utf8'), big: await readFile(bigFile, 'utf8'), pin: await readFile(pinFile, 'utf8')
  };
}

test('Allan Stewart current discovery and primary pages produce seven timed variety performances', async (t) => {
  const { config, artist, big, pin } = await input();
  const fetched: string[] = [];
  t.mock.method(axios, 'get', async (url: string) => {
    fetched.push(url);
    return { status: 200, data: url === pinUrl ? pin : url === bigUrl ? big : '', headers: {} };
  });
  assert.equal(config.type, 'playwright_render');
  assert.equal(config.renderParser, 'custom_js');
  assert.equal(config.allowEmpty, undefined);
  const rows = await scrape(config, artist, observedAt);
  assert.deepEqual(fetched, [pinUrl, bigUrl]);
  assert.equal(rows.length, 7, 'desktop and mobile booking links identify the same seven shows');
  assert.deepEqual(rows.map(row => [row.date, row.startTime, row.ticketUrl]), [
    ['2027-03-23', '19:30', 'https://www.capitaltheatres.com/book-online/399801'],
    ['2027-03-24', '14:30', 'https://www.capitaltheatres.com/book-online/399402'],
    ['2027-03-24', '19:30', 'https://www.capitaltheatres.com/book-online/399802'],
    ['2027-03-25', '19:30', 'https://www.capitaltheatres.com/book-online/399803'],
    ['2027-03-26', '19:30', 'https://www.capitaltheatres.com/book-online/400001'],
    ['2027-03-27', '14:30', 'https://www.capitaltheatres.com/book-online/399602'],
    ['2027-03-27', '19:30', 'https://www.capitaltheatres.com/book-online/400002']
  ]);
  assert.ok(rows.every(row => row.artist === 'Allan Stewart' && row.venue === 'Kings Theatre' &&
    row.city === 'Edinburgh' && row.country === 'GB' && row.originalSource === config.domain &&
    row.scrapedAt === observedAt));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allan-stewart-'));
  try {
    const db = path.join(dir, 'artists.json');
    await writeFile(db, JSON.stringify([{ name: 'Allan Stewart', website: 'https://www.allanstewart.com/' }]));
    const published = await processConcerts(rows, db, observedAt);
    assert.deepEqual(published.map(row => row.date), [
      '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27'
    ]);
    assert.ok(published.every(row => row.artist === 'Allan Stewart' && row.country === 'GB' &&
      row.originalSource === config.domain && row.ticketUrl === 'https://www.allanstewart.com/'));
    assert.ok(rows.every(row => row.ticketUrl?.startsWith('https://www.capitaltheatres.com/book-online/')),
      'raw booking provenance stays intact when public URLs prefer the official artist site');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Allan Stewart current cards cannot silently lose the headline link or gain unknown show types', async () => {
  const { config, artist } = await input();
  await assert.rejects(scrape(config, artist.replace('UPCOMING SHOWS | allanstewart', 'UPCOMING SHOWS | someone else'), observedAt), /identity/);
  const unknown = cheerio.load(artist);
  unknown('h5').filter((_, element) => /Big Big Variety/.test(unknown(element).text())).first().text('Other Show');
  await assert.rejects(scrape(config, unknown.html(), observedAt), /current show list changed/);
  await assert.rejects(scrape(config, artist.replaceAll('https://www.capitaltheatres.com/whats-on/allan-stewarts-big-big-variety-show', 'https://tickets.example/show'), observedAt), /discovery links/);
  await assert.rejects(scrape(config, artist.replaceAll('Kings Theatre, Edinburgh', 'Unknown Hall, Unknown City'), observedAt), /venue/);
});

test('Allan Stewart headline survives completed pantomime and removal of the old 2024 tour card', async (t) => {
  const { config, artist, big, pin } = await input();
  const fetched: string[] = [];
  t.mock.method(axios, 'get', async (url: string) => {
    fetched.push(url);
    return { status: 200, data: url === pinUrl ? pin : big, headers: {} };
  });
  const withoutPanto = cheerio.load(artist);
  withoutPanto('h5').filter((_, element) => /^Pinocchio\b/.test(withoutPanto(element).text()))
    .closest('div[data-testid="richTextElement"]').remove();
  withoutPanto(`a[href="${pinUrl}"]`).remove();
  assert.equal((await scrape(config, withoutPanto.html(), observedAt)).length, 7);
  assert.deepEqual(fetched, [bigUrl], 'removed cast role no longer causes an unnecessary primary fetch');

  const withoutArchive = cheerio.load(artist);
  withoutArchive('h5').filter((_, element) => /The Wizard of Oz \(UK TOUR\)/.test(withoutArchive(element).text()))
    .closest('div[data-testid="richTextElement"]').remove();
  withoutArchive('h2').filter((_, element) => /^UK TOUR 2024\b/.test(withoutArchive(element).text()))
    .closest('div[data-testid="richTextElement"]').remove();
  fetched.length = 0;
  assert.equal((await scrape(config, withoutArchive.html(), observedAt)).length, 7);
  assert.deepEqual(fetched, [pinUrl, bigUrl]);
});

test('Allan Stewart rejects changed cast role, primary identity, dates, time and bookings', async (t) => {
  const { config, artist, big, pin } = await input();
  let primary = big;
  let panto = pin;
  t.mock.method(axios, 'get', async (url: string) => ({ status: 200, data: url === pinUrl ? panto : primary, headers: {} }));
  panto = pin.replace('May Geppetto', 'headline singer');
  await assert.rejects(scrape(config, artist, observedAt), /cast-role exclusion/);
  panto = pin;
  const wrongBooking = cheerio.load(big);
  wrongBooking('li.event-instance__time-list--item a[href*="/book-online/"]').first().attr('href', 'https://tickets.example/399801');
  for (const [changed, reason] of [
    [big.replace('Allan Stewart’s Big Big Variety Show', 'Other Artist Show'), /headline show identity/],
    [big.replace('data-month="2027-03"', 'data-month="2027-02"'), /invalid calendar date/],
    [big.replace('7:30pm', '25:30pm'), /invalid time/],
    [big.replace('Kings Theatre', 'Other Venue'), /headline show identity/],
    [wrongBooking.html(), /booking/]
  ] as const) {
    primary = changed;
    await assert.rejects(scrape(config, artist, observedAt), reason);
  }
});

test('Allan Stewart parser reads a newly printed year without a fixed date table', async (t) => {
  const { config, artist, big, pin } = await input();
  let primary = big;
  t.mock.method(axios, 'get', async (url: string) => ({ status: 200, data: url === pinUrl ? pin : primary, headers: {} }));
  primary = big.replaceAll('data-month="2027-03"', 'data-month="2038-03"');
  const rows = await scrape(config, artist, observedAt);
  assert.equal(rows[0].date, '2038-03-23');
});
