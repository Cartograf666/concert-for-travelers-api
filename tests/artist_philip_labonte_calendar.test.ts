import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { scrape } from '../src/engine/custom/artist-philip-labonte.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const page = 'https://allthatremainsonline.com/pages/tour';
const profileUrl = 'https://rest.bandsintown.com/V3.1/artists/All%20That%20Remains?app_id=js_allthatremainsonline.com';
const eventsUrl = 'https://rest.bandsintown.com/V3.1/artists/All%20That%20Remains/events/?app_id=js_allthatremainsonline.com';
const officialHtml = '<html><head><title>Tour – All That Remains Official</title>' +
  `<link rel="canonical" href="${page}"></head><body><h1>Tour</h1>` +
  '<a class="bit-widget-initializer" data-artist-name="All That Remains" data-display-past-dates="false"></a>' +
  '<script src="https://widget.bandsintown.com/main.min.js"></script></body></html>';
const nativeProfile = {
  id: '513', name: 'All That Remains', mbid: '4f8b7186-b2a2-40db-97ae-6e1cd46d57b1',
  upcoming_event_count: 0
};
const nativeEvent = {
  id: 'fixture-event-1', artist_id: '513', artist: nativeProfile,
  lineup: ['All That Remains'], starts_at: '2030-10-07T20:00:00', datetime: '2030-10-07T20:00:00',
  venue: { name: 'Fixture Music Hall', city: 'Boston', country: 'United States' },
  url: 'https://www.bandsintown.com/e/fixture-event-1'
};

async function config() {
  return ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-philip-labonte.json', 'utf8')));
}

function feed(profile: unknown = nativeProfile, events: unknown = []) {
  const urls: string[] = [];
  const fetch = async (url: string): Promise<string> => {
    urls.push(url);
    if (url === profileUrl) return typeof profile === 'string' ? profile : JSON.stringify(profile);
    if (url === eventsUrl) return typeof events === 'string' ? events : JSON.stringify(events);
    throw new Error(`Unexpected network destination: ${url}`);
  };
  return { urls, fetch };
}

test('official native group profile and empty event array establish a genuinely empty tour', async () => {
  const source = await config();
  assert.equal(source.type, 'custom_js');
  assert.equal(source.allowEmpty, true);
  assert.equal(source.skipConditionalRequests, true);
  assert.equal(source.httpClient, 'got-scraping');
  assert.equal(source.selectors?.artistNameFallback, 'All That Remains');
  assert.equal(source.selectors?.countryNameFallback, 'ZZ');
  const { urls, fetch } = feed();
  assert.deepEqual(await scrape(source, officialHtml, '2026-10-07T00:00:00Z', fetch), []);
  assert.deepEqual(urls, [profileUrl, eventsUrl]);
});

test('wrong page or widget identity cannot turn an absent calendar into valid empty', async () => {
  const source = await config();
  for (const html of [
    officialHtml.replace('Tour – All That Remains Official', 'Tour – Other Act'),
    officialHtml.replace('data-artist-name="All That Remains"', 'data-artist-name="Philip Labonte"'),
    officialHtml.replace('widget.bandsintown.com/main.min.js', 'other.example/widget.js'),
    officialHtml.replace('data-display-past-dates="false"', ''),
    '<html><title>Checking your browser</title></html>'
  ]) {
    const { urls, fetch } = feed();
    await assert.rejects(scrape(source, html, '2026-10-07T00:00:00Z', fetch), /identity/);
    assert.deepEqual(urls, []);
  }
});

test('wrong profile, malformed JSON and unavailable API never certify empty', async () => {
  const source = await config();
  for (const profile of [
    { ...nativeProfile, id: '999' },
    { ...nativeProfile, name: 'Philip Labonte' },
    { ...nativeProfile, mbid: 'ed3fdcca-5deb-440c-89b6-639d0c5184ef' },
    { ...nativeProfile, upcoming_event_count: undefined },
    '<html>blocked</html>'
  ]) {
    await assert.rejects(scrape(source, officialHtml, '2026-10-07T00:00:00Z', feed(profile).fetch),
      /profile|JSON/);
  }
  await assert.rejects(scrape(source, officialHtml, '2026-10-07T00:00:00Z', async () => {
    throw new Error('HTTP 403');
  }), /403/);
});

test('profile/feed count disagreement, non-array and malformed feed reject empty', async () => {
  const source = await config();
  for (const [profile, events] of [
    [{ ...nativeProfile, upcoming_event_count: 1 }, []],
    [nativeProfile, [nativeEvent]],
    [nativeProfile, {}],
    [nativeProfile, '<html>blocked</html>']
  ] as const) {
    await assert.rejects(scrape(source, officialHtml, '2026-10-07T00:00:00Z', feed(profile, events).fetch),
      /count mismatch|not an array|not JSON/);
  }
});

test('populated native contract keeps group identity and explicit worldwide location', async () => {
  const source = await config();
  const profile = { ...nativeProfile, upcoming_event_count: 1 };
  const result = await scrape(source, officialHtml, '2030-10-01T00:00:00Z', feed(profile, [nativeEvent]).fetch);
  assert.deepEqual(result.map(row => [row.artist, row.date, row.venue, row.city, row.country]),
    [['All That Remains', '2030-10-07', 'Fixture Music Hall', 'Boston', 'US']]);
  assert.equal(result[0].originalSource, source.domain);
  assert.equal(result[0].ticketUrl, nativeEvent.url);
});

test('future populated rows fail as a whole for false identity, invalid dates and incomplete geography', async () => {
  const source = await config();
  const profile = { ...nativeProfile, upcoming_event_count: 1 };
  for (const change of [
    { artist_id: '999' }, { lineup: ['Philip Labonte'] },
    { starts_at: '2030-02-30T20:00:00', datetime: '2030-02-30T20:00:00' },
    { venue: { ...nativeEvent.venue, country: '' } },
    { venue: { ...nativeEvent.venue, city: '' } },
    { venue: { ...nativeEvent.venue, country: 'ZZ' } },
    { venue: { ...nativeEvent.venue, country: 'Unidentified Region' } }
  ]) {
    await assert.rejects(scrape(source, officialHtml, '2030-10-01T00:00:00Z',
      feed(profile, [{ ...nativeEvent, ...change }]).fetch), /identity|lineup|date|country|city/);
  }
});

test('repeat parsing requests both native endpoints when unchanged HTML gains an event', async () => {
  const source = await config();
  const first = feed();
  assert.deepEqual(await scrape(source, officialHtml, '2030-10-01T00:00:00Z', first.fetch), []);
  const second = feed({ ...nativeProfile, upcoming_event_count: 1 }, [nativeEvent]);
  assert.equal((await scrape(source, officialHtml, '2030-10-02T00:00:00Z', second.fetch)).length, 1);
  assert.deepEqual(first.urls, [profileUrl, eventsUrl]);
  assert.deepEqual(second.urls, [profileUrl, eventsUrl]);
});
