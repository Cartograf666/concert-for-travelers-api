import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-john-mellencamp.js';

const config = ScraperConfigSchema.parse(JSON.parse(readFileSync(join(process.cwd(),
  'scrapers/artists/artist-john-mellencamp.json'), 'utf8')));

function page(cards: string, events: unknown): string {
  return `<html><head><title>Tour | John Mellencamp</title></head><body>
    <h1>Tour</h1><div class="widget-events--default border-bottom border-primary">${cards}</div>
    <script type="application/ld+json">${JSON.stringify(events)}</script></body></html>`;
}

test('John Mellencamp native empty widget and event data agree', async () => {
  assert.equal(config.type, 'custom_js');
  assert.equal(config.allowEmpty, true);
  assert.deepEqual(await scrape(config, page(' ', []), '2026-10-07T00:00:00Z'), []);
  await assert.rejects(scrape(config, page('<article>Upcoming</article>', []), '2026-10-07T00:00:00Z'),
    /cards and event data disagree/);
  await assert.rejects(scrape(config, page(' ', [{ '@type': 'MusicEvent' }]), '2026-10-07T00:00:00Z'),
    /cards and event data disagree/);
});

test('John Mellencamp event must identify him and provide a complete dated place', async () => {
  const valid = {
    '@type': 'MusicEvent', performer: { name: 'John Mellencamp' },
    startDate: '2027-05-06T19:00:00',
    location: { name: 'Example Hall', address: { addressLocality: 'Chicago', addressCountry: 'US' } },
    url: 'https://www.mellencamp.com/tour/example'
  };
  const html = page('<article>May 6</article>', [valid]);
  const rows = await scrape(config, html, '2026-10-07T00:00:00Z');
  assert.deepEqual(rows.map(({ artist, date, venue, city, country }) =>
    ({ artist, date, venue, city, country })), [
    { artist: 'John Mellencamp', date: '2027-05-06', venue: 'Example Hall', city: 'Chicago', country: 'US' }
  ]);
  await assert.rejects(scrape(config, page('<article>May 6</article>',
    [{ ...valid, performer: { name: 'John Mellencamp Tribute' } }]), '2026-10-07T00:00:00Z'),
    /identity or location is invalid/);
  await assert.rejects(scrape(config, page('<article>May 6</article>',
    [{ ...valid, location: { name: 'Example Hall', address: { addressLocality: 'Chicago' } } }]),
  '2026-10-07T00:00:00Z'), /complete location/);
  await assert.rejects(scrape(config, page('<article>May 6</article>',
    [{ ...valid, location: { name: 'Example Hall', address: { addressLocality: 'Chicago', addressCountry: 'ZZ' } } }]),
  '2026-10-07T00:00:00Z'), /complete location/);
});
