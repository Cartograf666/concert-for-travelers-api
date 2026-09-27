import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { scrape as scrapeAmorphis } from '../src/engine/custom/artist-amorphis.js';
import { scrape as scrapeUb40 } from '../src/engine/custom/artist-ub40.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const scrapedAt = '2026-09-26T08:58:03.651Z';

async function readConfig(name: string): Promise<ScraperConfig> {
  return JSON.parse(await fs.readFile(`scrapers/artists/${name}.json`, 'utf8')) as ScraperConfig;
}

test('Amorphis splits only explicit country labels and preserves source fields', async () => {
  const [config, html] = await Promise.all([
    readConfig('artist-amorphis'),
    fs.readFile(new URL('./fixtures/artist-amorphis-tour.html', import.meta.url), 'utf8')
  ]);

  const concerts = await scrapeAmorphis(config, html, scrapedAt);
  assert.equal(config.type, 'custom_js');
  assert.equal(concerts.length, 6);
  assert.deepEqual(
    concerts.slice(0, 2).map(({ artist, date, venue, city, country, ticketUrl }) => ({ artist, date, venue, city, country, ticketUrl })),
    [
      {
        artist: 'Amorphis',
        date: '26. Sep 2026',
        venue: 'The Basement Canberra',
        city: 'Belconnen',
        country: 'AU',
        ticketUrl: 'https://amorphis.net/tickets/belconnen'
      },
      {
        artist: 'Amorphis',
        date: '17. Nov 2026',
        venue: 'Paradise Rock Club',
        city: 'Boston',
        country: 'US',
        ticketUrl: undefined
      }
    ]
  );
  assert.deepEqual(
    concerts.slice(2).map(({ city, country }) => ({ city, country })),
    [
      { city: 'Los Angeles, CA', country: undefined },
      { city: 'Toronto, Canada, United States', country: undefined },
      { city: 'Atlanta, Georgia', country: undefined },
      { city: 'Mystery City, Neverland', country: undefined }
    ],
    'region-only, conflicting, and ambiguous locations must remain rejectable rather than guessed'
  );
});

test('UB40 maps only the explicit labels used by its tour feed and preserves ticket links', async () => {
  const [config, html] = await Promise.all([
    readConfig('artist-ub40'),
    fs.readFile(new URL('./fixtures/artist-ub40-tour.html', import.meta.url), 'utf8')
  ]);

  const concerts = await scrapeUb40(config, html, scrapedAt);
  assert.equal(config.type, 'custom_js');
  assert.equal(concerts.length, 6);
  assert.deepEqual(
    concerts.slice(0, 4).map(({ city, country, ticketUrl }) => ({ city, country, ticketUrl })),
    [
      { city: 'Morristown', country: 'US', ticketUrl: 'https://www.mayoarts.org/shows/ub40/' },
      { city: 'Windsor', country: 'CA', ticketUrl: 'https://ub40.global/tickets/windsor' },
      { city: 'Perth', country: 'AU', ticketUrl: 'https://ub40icf.eventbrite.com.au/' },
      { city: 'Auckland', country: 'NZ', ticketUrl: 'https://www.ticketmaster.co.nz/event/example' }
    ]
  );
  assert.deepEqual(
    concerts.slice(4).map(({ city, country }) => ({ city, country })),
    [
      { city: 'Los Angeles, CA', country: undefined },
      { city: 'Toronto, Canada, USA', country: undefined }
    ]
  );
});

test('recovered source output is accepted by the existing pipeline while unsafe locations are rejected', async () => {
  const [amorphisConfig, ub40Config, amorphisHtml, ub40Html] = await Promise.all([
    readConfig('artist-amorphis'),
    readConfig('artist-ub40'),
    fs.readFile(new URL('./fixtures/artist-amorphis-tour.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('./fixtures/artist-ub40-tour.html', import.meta.url), 'utf8')
  ]);
  const raw = [
    ...await scrapeAmorphis(amorphisConfig, amorphisHtml, scrapedAt),
    ...await scrapeUb40(ub40Config, ub40Html, scrapedAt)
  ];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artist-location-recovery-'));
  try {
    const approvedArtistsPath = path.join(dir, 'approved_artists.json');
    await fs.writeFile(approvedArtistsPath, JSON.stringify([{ name: 'Amorphis' }, { name: 'UB40' }]), 'utf8');
    const published = await processConcerts(raw, approvedArtistsPath, '2026-09-26T00:00:00.000Z');

    assert.equal(published.length, 6);
    assert.deepEqual(new Set(published.map((concert) => concert.country)), new Set(['AU', 'US', 'CA', 'NZ']));
    assert.equal(published.some((concert) => concert.city.includes(',')), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
