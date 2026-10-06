import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as cheerio from 'cheerio';
import { scrape as peter } from '../src/engine/custom/artist-peter-smith.js';
import { scrape as rainey } from '../src/engine/custom/artist-rainey.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { normalizeCountry, parseDate } from '../src/pipeline/process.js';
const config = (id: string) => ScraperConfigSchema.parse(JSON.parse(readFileSync(`scrapers/${id}.json`, 'utf8')));
const fixture = (name: string) => readFileSync(`tests/fixtures/remaining-identity-20261006/${name}`, 'utf8');
const stamp = '2026-10-06T00:00:00Z';

test('Peter Smith first-party widget retains six dated US events and rejects another artist', async () => {
  const body = fixture('peter-smith-feed.json');
  const rows = await peter(config('artist-peter-smith'), body, stamp);
  assert.equal(rows.length, 6);
  assert.deepEqual([rows[0].artist, rows[0].date, rows[0].city, rows[0].country], ['Peter Smith', '2026-10-08', 'Pasadena', 'US']);
  assert.ok(rows.every(row => row.date! >= '2026-10-06' && row.venue && row.city && row.ticketUrl));
  const wrong = JSON.parse(body); wrong[0].artist_id = '7133';
  await assert.rejects(peter(config('artist-peter-smith'), JSON.stringify(wrong), stamp), /artist identity/);
  const incomplete = JSON.parse(body); delete incomplete[0].venue.city;
  await assert.rejects(peter(config('artist-peter-smith'), JSON.stringify(incomplete), stamp), /event fields/);
});

test('Kingfisher Sky rows use the band identity, explicit dates and per-row countries', () => {
  const c = config('artist-judith-rijnveld');
  const $ = cheerio.load(fixture('judith-shows.html'));
  const rows = $(c.selectors!.eventBlock).toArray().map(el => {
    const row = $(el);
    return [c.selectors!.artistNameFallback, parseDate(row.find('time').attr('datetime')!, stamp),
      row.find(c.selectors!.venue!).text(), row.find(c.selectors!.city!).text(), normalizeCountry(row.find(c.selectors!.country!).text())];
  });
  assert.deepEqual(rows, [['Kingfisher Sky', '2026-12-12', 'P3', 'Purmerend', 'NL'], ['Kingfisher Sky', '2026-12-19', 'Veur Theater', 'Leidschendam', 'NL']]);
  $('.venue-country').first().text('Germany');
  assert.equal(normalizeCountry($(c.selectors!.eventBlock).first().find(c.selectors!.country!).text()), 'DE');
});

test('Stephanie Rainey has two full dated Irish shows without assigning them to Rainey', async () => {
  const html = fixture('rainey-shows.html');
  const rows = await rainey(config('artist-rainey'), html, stamp);
  assert.deepEqual(rows.map(row => [row.artist, parseDate(row.date!, stamp), row.venue, row.city, row.country]),
    [['Stephanie Rainey', '2026-10-10', 'Inish Beg Estate', 'West Cork', 'IE'], ['Stephanie Rainey', '2026-12-12', 'Live At St. Lukes', 'Cork', 'IE']]);
  await assert.rejects(rainey(config('artist-rainey'), html.replace('West Cork', 'London'), stamp), /unverified country/);
  await assert.rejects(rainey(config('artist-rainey'), html.replace('10 Oct 2026', '10 Oct'), stamp), /incomplete date/);
});
