import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ScraperConfig } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-patrick-monahan.js';

const config = JSON.parse(readFileSync('scrapers/artist-patrick-monahan.json', 'utf8')) as ScraperConfig;
const capturedFeed = JSON.parse(readFileSync('tests/fixtures/remaining_train_regions.json', 'utf8'));
const scrapedAt = '2026-10-06T00:00:00.000Z';

function feedWith(change?: (feed: typeof capturedFeed) => void): string {
  const feed = structuredClone(capturedFeed);
  change?.(feed);
  return JSON.stringify(feed);
}

test('Train parses all three referenced live events, including California and Florida', async () => {
  // The previous FL-only location check rejected this entire captured three-row feed.
  assert.equal(/^([^,]+), FL$/.test(capturedFeed.included[0].attributes['formatted-address']), false);
  const events = await scrape(config, feedWith(), scrapedAt);
  assert.deepEqual(events.map(({ date, venue, city, country }) => ({ date, venue, city, country })), [
    { date: '2026-11-14', venue: 'The Canyon Agoura Hills', city: 'Agoura Hills', country: 'US' },
    { date: '2027-01-23', venue: 'PGA West at The American Express', city: 'La Quinta', country: 'US' },
    { date: '2027-02-11', venue: 'Sail Across The Sun', city: 'Miami Beach', country: 'US' },
  ]);
  assert.ok(events.every((event) => event.artist === 'Train' &&
    event.ticketUrl === 'https://www.savemesanfrancisco.com/tour' &&
    event.originalSource === config.domain && event.scrapedAt === scrapedAt));
});

test('Train requires its exact artist identity and all referenced event records', async () => {
  await assert.rejects(scrape(config, feedWith((feed) => { feed.data.id = 'another-tour'; }), scrapedAt), /identity/);
  await assert.rejects(scrape(config, feedWith((feed) => { feed.data.attributes.name = 'Another Artist'; }), scrapedAt), /identity/);
  await assert.rejects(scrape(config, feedWith((feed) => { feed.data.relationships['tour-events'].data[1].id = 'missing'; }), scrapedAt), /lacks explicit/);
});

test('Train rejects incomplete, impossible, or unsupported rows rather than returning a partial tour', async () => {
  const cases: Array<[string, (feed: typeof capturedFeed) => void]> = [
    ['missing date', (feed) => { delete feed.included[0].attributes['starts-at-date-local']; }],
    ['invalid date', (feed) => { feed.included[0].attributes['starts-at-date-local'] = '2027-02-30'; }],
    ['missing venue', (feed) => { feed.included[0].attributes['venue-name'] = '   '; }],
    ['missing city', (feed) => { feed.included[0].attributes['formatted-address'] = ' , CA'; }],
    ['unknown state', (feed) => { feed.included[0].attributes['formatted-address'] = 'Agoura Hills, ZZ'; }],
    ['unsupported province', (feed) => { feed.included[0].attributes['formatted-address'] = 'Toronto, ON'; }],
  ];
  for (const [label, change] of cases) {
    await assert.rejects(scrape(config, feedWith(change), scrapedAt), /lacks explicit/, label);
  }
});

test('Train accepts a later explicitly printed valid year without a fixed event-year cap', async () => {
  const events = await scrape(config, feedWith((feed) => {
    feed.included[0].attributes['starts-at-date-local'] = '2028-02-29';
  }), scrapedAt);
  assert.equal(events[1].date, '2028-02-29');
});
