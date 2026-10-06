import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scrape } from '../src/engine/custom/artist-marmalade.js';
import { parseDate } from '../src/pipeline/process.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const config = JSON.parse(readFileSync('scrapers/artists/artist-marmalade.json', 'utf8')) as ScraperConfig;
const html = readFileSync('tests/fixtures/remaining_access_artist_marmalade.html', 'utf8');

test('Marmalade official tour rows retain both future cities and venue names', async () => {
  const rows = await scrape(config, html, '2026-10-06T00:00:00Z');
  assert.deepEqual(rows.map(row => [parseDate(row.date!, '2026-10-06'), row.venue, row.city, row.country]), [
    ['2027-01-16', 'Butlins', 'Skegness', 'GB'],
    ['2027-03-13', 'Unity Beach, Holiday Park', 'Burnham-on-Sea', 'GB']
  ]);
  assert.ok(rows.every(row => row.artist === 'Marmalade' && row.originalSource === 'themarmalade.net'));
});

test('Marmalade rejects a dated row whose city cannot be separated', async () => {
  const missingCity = html.replace('Butlins, Skegness', 'Butlins');
  await assert.rejects(scrape(config, missingCity, '2026-10-06T00:00:00Z'), /city/);
});

test('Marmalade does not assign a UK country to an unverified future city', async () => {
  await assert.rejects(scrape(config, html.replace('Butlins, Skegness', 'Concert Hall, Berlin'), '2026-10-06T00:00:00Z'), /verified country/);
  const later = await scrape(config, html.replaceAll('2027', '2030'), '2029-10-06T00:00:00Z');
  assert.deepEqual(later.map(row => parseDate(row.date!, '2029-10-06')), ['2030-01-16', '2030-03-13']);
});
