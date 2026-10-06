import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as cheerio from 'cheerio';
import { parseDate } from '../src/pipeline/process.js';
import { scrape as scrapeJames } from '../src/engine/custom/artist-james-alexander.js';
import { scrape as scrapeManiacs } from '../src/engine/custom/artist-jerry-augustyniak.js';
import { scrape as scrapeJacobs } from '../src/engine/custom/artist-yarbrough-and-peoples.js';
import { scrape as scrapeTrain } from '../src/engine/custom/artist-patrick-monahan.js';
import { scrape as scrapeCroMags } from '../src/engine/custom/artist-harley-flanagan.js';
import { scrape as scrapeMotionCity } from '../src/engine/custom/artist-justin-pierre.js';
import { scrape as scrapeYosei } from '../src/engine/custom/artist-yosei-teikoku.js';
import { scrape as scrapeBarby } from '../src/engine/custom/barby-tel-aviv.js';
import { scrape as scrapeHeyNineteen } from '../src/engine/custom/artist-hey-nineteen.js';
import { scrape as scrapeHaash } from '../src/engine/custom/artist-haash.js';
import { scrape as scrapeAnnie } from '../src/engine/custom/artist-annie-clark.js';
import { parseDetail as parseYanagiDetail } from '../src/engine/custom/artist-yanagi-nagi.js';
import { scrape as scrapeKitty } from '../src/engine/custom/kitty-su-bangalore.js';
import { scrape as scrapeJun } from '../src/engine/custom/artist-jun-shibata.js';
import { scrape as scrapeYusa } from '../src/engine/custom/artist-yusa-mimori.js';
import { scrape as scrapeRanjani } from '../src/engine/custom/artist-ranjani-gayatri.js';
import { ScraperConfig } from '../src/schemas/config.js';

const fixture = (id: string) => readFileSync(`tests/fixtures/venue-sources-recovery-20261006/${id}.html`, 'utf8');
const config = (id: string): ScraperConfig => JSON.parse(readFileSync(`scrapers/${id}.json`, 'utf8'));
const scrapedAt = '2026-10-06T00:00:00Z';

test('Chicago current tour rows retain canonical band, date, venue and location', () => {
  const $ = cheerio.load(fixture('artist-james-pankow'));
  const c = config('artist-james-pankow');
  const rows = $(c.selectors!.eventBlock).toArray().map(element => {
    const block = $(element);
    return {
      artist: c.selectors!.artistNameFallback,
      date: parseDate(block.find(c.selectors!.date).text().trim(), '2026-10-06'),
      venue: block.find(c.selectors!.venue!).text().trim(),
      city: block.find(c.selectors!.city!).text().trim(),
      ticketUrl: block.find('a').first().attr('href')
    };
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    artist: 'Chicago', date: '2026-11-05', venue: 'The Wind Creek Event Center',
    city: 'Bethlehem, PA', ticketUrl: 'https://chicagotheband.com/js_events/chicago-at-the-wind-creek-event-center-2/'
  });
  assert.ok(rows[1].date && rows[1].venue && rows[1].city && rows[1].ticketUrl);
});

test('James Alexander Bright official live rows have explicit future dates and places', async () => {
  const rows = await scrapeJames(config('artist-james-alexander'), fixture('artist-james-alexander'), scrapedAt);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.artist, parseDate(row.date!, '2026-10-06'), row.venue, row.city, row.country]), [
    ['James Alexander Bright', '2026-11-19', 'SJQ', 'London', 'GB'],
    ['James Alexander Bright', '2026-11-28', 'Green Room', 'Bournemouth', 'GB']
  ]);
  assert.ok(rows.every(row => row.ticketUrl?.startsWith('https://')));
});

test('Ranjani-Gayatri official cards keep India and Dubai country distinct', async () => {
  const rows = await scrapeRanjani(config('artist-ranjani-gayatri'), fixture('artist-ranjani-gayatri'), scrapedAt);
  assert.deepEqual(rows.map(row => [row.artist, parseDate(row.date!, '2026-10-06'), row.venue, row.city, row.country]), [
    ['Ranjani-Gayatri', '2026-10-10', 'SASTRA SATSANGH', 'Chennai', 'IN'],
    ['Ranjani-Gayatri', '2026-10-24', 'Folklore Theatre', 'Dubai', 'AE']
  ]);
});


test('Mimori Yusa official 2026 section yields only dated Japanese concerts', async () => {
  const rows = await scrapeYusa(config('artist-yusa-mimori'), fixture('artist-yusa-mimori'), scrapedAt);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => [row.date, row.city, row.venue]), [
    ['2026-11-28', '京都', '平安教会'],
    ['2026-12-06', '仙台', '仙台市戦災復興記念館 記念ホール'],
    ['2026-12-12', '名古屋', '聖マルコ教会'],
    ['2026-12-17', '東京', 'ルーテル市ヶ谷ホール'],
    ['2026-12-18', '東京', 'ルーテル市ヶ谷ホール']
  ]);
  assert.ok(rows.every(row => row.artist === 'Mimori Yusa' && row.country === 'JP'));
});


test('Jun Shibata replacement official site yields the six announced 2026 tour dates', async () => {
  const rows = await scrapeJun(config('artist-jun-shibata'), fixture('artist-jun-shibata'), scrapedAt);
  assert.deepEqual(rows.map(row => row.date), [
    '2026-10-25', '2026-10-31', '2026-11-17', '2026-11-20', '2026-12-04', '2026-12-22'
  ]);
  assert.deepEqual([rows[0].artist, rows[0].venue, rows[0].city, rows[0].country],
    ['Jun Shibata', 'NHK大阪ホール', '大阪', 'JP']);
  assert.ok(rows.every(row => row.venue && row.city && row.ticketUrl === 'https://www.shibajun.jp/schedule/live/'));
});


test('Kitty Su current official Kolkata listings are not mislabeled as Bangalore', async () => {
  const rows = await scrapeKitty(config('kitty-su-bangalore'), fixture('kitty-su-bangalore'), scrapedAt);
  assert.deepEqual(rows, []);
});


test('Yanagi official event detail confirms guest identity, date and PADOMA venue', () => {
  const c = config('artist-yanagi-nagi');
  const html = fixture('artist-yanagi-nagi-detail');
  const url = 'https://yanaginagi.net/live/historicavol7/';
  const row = parseYanagiDetail(c, html, '2027-07-17', url, scrapedAt);
  assert.deepEqual([row.artist, row.date, row.venue, row.city, row.country, row.ticketUrl],
    ['Yanagi Nagi', '2027-07-17', 'live music club PADOMA', 'Kobe', 'JP', url]);
  assert.throws(() => parseYanagiDetail(c, html, '2027-07-18', url, scrapedAt), /date mismatch/);
});


test('Ha*Ash official embedded feed preserves performer and country across 32 future shows', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-haash-feed.json', 'utf8');
  const rows = await scrapeHaash(config('artist-haash'), body, scrapedAt);
  assert.equal(rows.length, 32);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].city, rows[0].country],
    ['Ha*Ash', '2027-02-04', 'Managua', 'NI']);
  assert.ok(rows.every(row => row.artist === 'Ha*Ash' && row.venue && row.city && row.country && row.ticketUrl));
  const tampered = JSON.parse(body); tampered[1].artist_id = '7133';
  await assert.rejects(scrapeHaash(config('artist-haash'), JSON.stringify(tampered), scrapedAt), /artist identity/);
});

test('St. Vincent official embedded feed yields only matching artist rows', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-annie-clark-feed.json', 'utf8');
  const rows = await scrapeAnnie(config('artist-annie-clark'), body, scrapedAt);
  assert.equal(rows.length, 8);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].venue, rows[0].city, rows[0].country],
    ['St. Vincent', '2026-10-22', 'Sweetwater Music Hall', 'Mill Valley', 'US']);
  assert.ok(rows.every(row => row.date && row.venue && row.city && row.country && row.ticketUrl));
  const tampered = JSON.parse(body); tampered[0].artist_id = '1107757';
  await assert.rejects(scrapeAnnie(config('artist-annie-clark'), JSON.stringify(tampered), scrapedAt), /artist identity/);
});


test('10,000 Maniacs official widget returns band rather than member identity', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-jerry-augustyniak-feed.json', 'utf8');
  const rows = await scrapeManiacs(config('artist-jerry-augustyniak'), body, scrapedAt);
  assert.equal(rows.length, 13);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].venue, rows[0].city, rows[0].country],
    ['10,000 Maniacs', '2026-10-16', 'Alex Theatre', 'Glendale', 'US']);
  const tampered = JSON.parse(body); tampered[0].artist_id = '7133';
  await assert.rejects(scrapeManiacs(config('artist-jerry-augustyniak'), JSON.stringify(tampered), scrapedAt), /artist identity/);
});

test('Jacobs Pavilion official feed excludes the show moved to Agora Theatre', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-yarbrough-and-peoples-feed.json', 'utf8');
  const rows = await scrapeJacobs(config('artist-yarbrough-and-peoples'), body, scrapedAt);
  assert.deepEqual(rows.map(row => [row.artist, row.date, row.venue, row.city, row.country]), [
    ['Roger Waters Presents Legacy - A Pink Floyd Show', '2027-09-21', 'Jacobs Pavilion', 'Cleveland', 'US']
  ]);
  const tampered = JSON.parse(body); tampered.events[1].venue.venueId = 'other';
  await assert.rejects(scrapeJacobs(config('artist-yarbrough-and-peoples'), JSON.stringify(tampered), scrapedAt), /invalid venue/);
});

test('Train official embedded feed preserves the band identity and full 2027 date', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-patrick-monahan-seated.json', 'utf8');
  const rows = await scrapeTrain(config('artist-patrick-monahan'), body, scrapedAt);
  assert.deepEqual(rows.map(row => [row.artist, row.date, row.venue, row.city, row.country]), [
    ['Train', '2027-02-11', 'Sail Across The Sun', 'Miami Beach', 'US']
  ]);
  const tampered = JSON.parse(body); tampered.data.attributes.name = 'Other artist';
  await assert.rejects(scrapeTrain(config('artist-patrick-monahan'), JSON.stringify(tampered), scrapedAt), /artist identity/);
});

test('Cro-Mags official 2026 schedule maps only announced future dates and places', async () => {
  const rows = await scrapeCroMags(config('artist-harley-flanagan'), fixture('artist-harley-flanagan'), scrapedAt);
  assert.deepEqual(rows.map(row => [row.artist, row.date, row.venue, row.city, row.country]), [
    ['Cro-Mags', '2026-12-04', 'Decibel Beer & Metal Fest', 'Denver', 'US'],
    ['Cro-Mags', '2026-12-12', 'The Belasco, For The Children', 'Los Angeles', 'US']
  ]);
  await assert.rejects(scrapeCroMags(config('artist-harley-flanagan'), fixture('artist-harley-flanagan').replace(/<title>[^<]*<\/title>/, '<title>Other Artist</title>'), scrapedAt), /identity/);
});

test('Motion City Soundtrack official feed retains Justin Pierre band identity', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-justin-pierre-seated.json', 'utf8');
  const rows = await scrapeMotionCity(config('artist-justin-pierre'), body, scrapedAt);
  assert.deepEqual(rows.map(row => [row.artist, row.date, row.venue, row.city, row.country]), [
    ['Motion City Soundtrack', '2026-11-07', 'Handlebar (Outdoors)', 'Pensacola', 'US'],
    ['Motion City Soundtrack', '2026-11-14', 'Camping World Stadium Campus', 'Orlando', 'US']
  ]);
  const tampered = JSON.parse(body); tampered.data.attributes.name = 'Other artist';
  await assert.rejects(scrapeMotionCity(config('artist-justin-pierre'), JSON.stringify(tampered), scrapedAt), /artist identity/);
});

test('Yōsei Teikoku official current calendar explicitly says no upcoming events', async () => {
  const body = fixture('artist-yosei-teikoku-empty');
  const c = config('artist-yosei-teikoku');
  assert.ok(body.includes(c.emptyScheduleText!));
  assert.deepEqual(await scrapeYosei(c, body, scrapedAt), []);
  await assert.rejects(scrapeYosei(c, body.replace(/<title>[^<]*<\/title>/, '<title>Other Artist</title>'), scrapedAt), /calendar changed/);
});

test('Barby official browser API provides full years and excludes the customer-service card', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/barby-tel-aviv-feed.json', 'utf8');
  const rows = await scrapeBarby(config('barby-tel-aviv'), body, scrapedAt);
  assert.equal(rows.length, 66);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].venue, rows[0].city, rows[0].country],
    ['עטר מיינר', '2026-10-10', 'Barby', 'Tel Aviv', 'IL']);
  assert.deepEqual([rows.at(-1)?.artist, rows.at(-1)?.date], ['ג׳ימבו ג׳יי - מופע להקה', '2027-01-26']);
  assert.ok(rows.every(row => row.date && row.venue && row.city && row.country && row.ticketUrl));
  const tampered = JSON.parse(body); tampered.returnShow.show[0].showDate = '10/10';
  await assert.rejects(scrapeBarby(config('barby-tel-aviv'), JSON.stringify(tampered), scrapedAt), /full date/);
});

test('Hey Nineteen official embedded widget preserves band identity and cleans venue labels', async () => {
  const body = readFileSync('tests/fixtures/venue-sources-recovery-20261006/artist-hey-nineteen-feed.json', 'utf8');
  const rows = await scrapeHeyNineteen(config('artist-hey-nineteen'), body, scrapedAt);
  assert.equal(rows.length, 6);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].venue, rows[0].city, rows[0].country],
    ['Hey Nineteen', '2026-10-16', 'The Met', 'Pawtucket', 'US']);
  assert.deepEqual([rows.at(-1)?.date, rows.at(-1)?.venue], ['2027-05-15', 'Ramshead Onstage']);
  const tampered = JSON.parse(body); tampered[0].artist_id = '1107757';
  await assert.rejects(scrapeHeyNineteen(config('artist-hey-nineteen'), JSON.stringify(tampered), scrapedAt), /artist identity/);
});
