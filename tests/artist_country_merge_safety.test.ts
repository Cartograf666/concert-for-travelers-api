import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scrape as ocean } from '../src/engine/custom/artist-ocean-colour-scene.js';
import { scrape as andrea } from '../src/engine/custom/artist-andrea-motis.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const observedAt = '2026-09-27T15:01:59.619Z';

async function publish(t: test.TestContext, events: Partial<Concert>[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'country-merge-safety-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const approved = path.join(dir, 'artists.json');
  await writeFile(approved, JSON.stringify([{ name: 'Ocean Colour Scene' }, { name: 'Andrea Motis' }]));
  return processConcerts(events, approved, observedAt);
}

test('Ocean verified venue labels preserve richer whole records in the unchanged pipeline', async (t) => {
  const config = JSON.parse(await readFile('scrapers/artists/artist-ocean-colour-scene.json', 'utf8')) as ScraperConfig;
  for (const [day, city, label, venue] of [
    ['21', 'Glasgow', 'Glasgow OVO Hydro', 'OVO Hydro'],
    ['23', 'Aberdeen', 'Music Hall', 'Aberdeen Music Hall'],
    ['24', 'Dunfermline', 'Alhambra', 'Alhambra Theatre']
  ]) {
    const fresh = await ocean(config, `<article class="EventListingListItem">
      <a class="EventListingListItem-link" href="/events/2026-11-${day}-ocean">
      <span class="EventListingListItem-date-day">${day}</span><span class="EventListingListItem-date-month">Nov</span>
      <span class="EventListingListItem-venue-room">${label}</span><span class="EventListingListItem-venue-city">${city}, GB</span>
      </a></article>`, observedAt);
    const existing: Partial<Concert> = { artist: 'Ocean Colour Scene', date: `2026-11-${day}`,
      city, country: 'GB', venue, originalSource: 'bandsintown.com', scrapedAt: observedAt,
      ticketUrl: 'https://tickets.example/event', lat: 56, lng: -4, startTime: '19:00', venueKind: 'theatre' };
    const [baseline] = await publish(t, [existing]);
    for (const events of [[...fresh, existing], [existing, ...fresh]]) {
      const result = await publish(t, events);
      assert.equal(result.length, 1);
      assert.deepEqual(result[0], baseline);
      assert.equal(result[0].originalSource, 'bandsintown.com');
    }
  }
});

test('Andrea Madrid correction does not inherit coordinates or time from a wrongly named venue', async (t) => {
  const config = JSON.parse(await readFile('scrapers/artists/artist-andrea-motis.json', 'utf8')) as ScraperConfig;
  const fresh = await andrea(config, `<figure class="wp-block-table"><table><tbody><tr>
    <td>20/11/2026</td><td>Guitar Trio</td><td>Teatro Monumental, Madrid</td>
    <td><a href="https://villanosdeljazz.es/evento/andrea-motis-guitar-trio/">Tickets</a></td>
    </tr></tbody></table></figure>`, observedAt);
  assert.equal(fresh.length, 1);
  const existing: Partial<Concert> = { artist: 'Andrea Motis', date: '2026-11-20', city: 'Madrid', country: 'ES',
    venue: 'ANDREA MOTIS', originalSource: 'bandsintown.com', scrapedAt: observedAt,
    ticketUrl: 'https://tickets.example/old-event', lat: 40, lng: -3, startTime: '20:00' };
  const result = await publish(t, [...fresh, existing]);
  assert.equal(result.length, 1);
  assert.equal(result[0].venue, 'Teatro Monumental');
  assert.equal(result[0].lat, undefined);
  assert.equal(result[0].lng, undefined);
  assert.equal(result[0].startTime, undefined);
});
