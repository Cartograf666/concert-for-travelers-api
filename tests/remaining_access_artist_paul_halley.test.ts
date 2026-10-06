import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scrape } from '../src/engine/custom/artist-paul-halley.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const config = JSON.parse(readFileSync('scrapers/artist-paul-halley.json', 'utf8')) as ScraperConfig;
const html = readFileSync('tests/fixtures/remaining_access_artist_paul_halley.html', 'utf8');

test('Paul Halley official schedule retains only his explicit concert roles with full archival locations', async () => {
  assert.equal(config.url, 'https://pelagosmusic.com/event-schedule');
  const rows = await scrape(config, html, '2026-10-06T00:00:00Z');
  assert.deepEqual(rows.map(row => [row.date, row.venue, row.city, row.country]), [
    ['2025-09-21', 'The Cathedral Church of All Saints', 'Halifax', 'CA'],
    ['2025-12-14', 'The Cathedral Church of All Saints', 'Halifax', 'CA']
  ]);
  assert.ok(rows.every(row => row.artist === 'Paul Halley' && row.originalSource === 'pelagosmusic.com'));
  assert.equal(rows.filter(row => row.date! >= '2026-10-06').length, 0);
});

test('Paul Halley excludes composition-only credit and rejects missing concert place', async () => {
  const compositionOnly = html.replace('original compositions played by Paul Halley', 'original compositions by Paul Halley');
  const rows = await scrape(config, compositionOnly, '2026-10-06T00:00:00Z');
  assert.deepEqual(rows.map(row => row.date), ['2025-12-14']);
  const missingVenue = html.replaceAll('The Cathedral Church of All Saints', 'An unnamed venue');
  await assert.rejects(scrape(config, missingVenue, '2026-10-06T00:00:00Z'), /venue/);
});
