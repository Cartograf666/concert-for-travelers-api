import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scrape } from '../src/engine/custom/artist-jerry-depizzo.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const config = JSON.parse(readFileSync('scrapers/artist-jerry-depizzo.json', 'utf8')) as ScraperConfig;
const feed = readFileSync('tests/fixtures/remaining_access_artist_jerry_depizzo_feed.json', 'utf8');
const widget = readFileSync('tests/fixtures/remaining_access_artist_jerry_depizzo_widget.html', 'utf8');

test('O.A.R. official widget identity yields band dates without Marc Roberge solo shows', async () => {
  assert.match(widget, /data-artist-id="fc4e0166-09b2-48ad-87b8-c352fcc73bb5"/);
  assert.equal(config.url, 'https://cdn.seated.com/api/tour/fc4e0166-09b2-48ad-87b8-c352fcc73bb5?include=tour-events');
  const rows = await scrape(config, feed, '2026-10-06T00:00:00Z');
  assert.deepEqual(rows.map(row => [row.date, row.venue, row.city, row.country]), [
    ['2026-11-12', 'The BayCare Sound', 'Clearwater', 'US'],
    ['2026-11-13', 'Hard Rock Live', 'Hollywood', 'US'],
    ['2026-11-14', 'The St. Augustine Amphitheatre', 'St. Augustine', 'US'],
    ['2026-11-15', 'Hard Rock Live Orlando', 'Orlando', 'US']
  ]);
  assert.ok(rows.every(row => row.artist === 'O.A.R.' && row.originalSource === 'cdn.seated.com'));
});

test('O.A.R. feed rejects wrong tour identity and incomplete band event', async () => {
  const wrong = JSON.parse(feed);
  wrong.data.attributes.name = 'Other Artist';
  await assert.rejects(scrape(config, JSON.stringify(wrong), '2026-10-06T00:00:00Z'), /identity/);
  const incomplete = JSON.parse(feed);
  const first = incomplete.included.find((event: { id: string }) => event.id === '6da3436c-0b72-4982-a762-600ee2396595');
  delete first.attributes['venue-name'];
  await assert.rejects(scrape(config, JSON.stringify(incomplete), '2026-10-06T00:00:00Z'), /venue/);
});
