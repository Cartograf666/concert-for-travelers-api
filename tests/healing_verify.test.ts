import test from 'node:test';
import assert from 'node:assert';
import { verifyEvents, verifyConfigLive, formatVerifyReport } from '../src/healing/verify.js';
import { ScraperConfig } from '../src/schemas/config.js';

const NOW = new Date('2026-07-28T00:00:00.000Z');

const config: ScraperConfig = {
  id: 'test-venue',
  domain: 'test-venue.de',
  url: 'https://test-venue.de/events',
  type: 'static_selectors',
  selectors: {
    eventBlock: '.event',
    artist: '.artist',
    date: '.date',
    venueNameFallback: 'Test Venue',
    cityNameFallback: 'Berlin',
    countryNameFallback: 'DE'
  }
};

function goodEvents(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    artist: `Real Band ${i}`,
    date: `2026-09-${String((i % 27) + 1).padStart(2, '0')}`,
    ticketUrl: `https://test-venue.de/tickets/${i}`
  }));
}

function check(report: ReturnType<typeof verifyEvents>, name: string) {
  const c = report.checks.find((x) => x.name === name);
  assert.ok(c, `expected a "${name}" check in the report`);
  return c!;
}

test('verify - plausible events pass every check', () => {
  const report = verifyEvents(goodEvents(10), config, { now: NOW, baselineCount: 12 });
  assert.strictEqual(report.ok, true, formatVerifyReport(report));
  assert.strictEqual(report.eventCount, 10);
});

test('verify - zero events fails immediately', () => {
  const report = verifyEvents([], config, { now: NOW });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(check(report, 'has_events').ok, false);
});

test('verify - rejects page chrome scraped as artist names', () => {
  // The exact failure mode the old gate allowed through: selectors that match the
  // "Buy Tickets" buttons instead of the artist headings still yield "events".
  const junk = Array.from({ length: 8 }, (_, i) => ({
    artist: 'Read more',
    date: `2026-09-0${(i % 9) + 1}`
  }));
  const report = verifyEvents(junk, config, { now: NOW });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(check(report, 'artist_names_plausible').ok, false);
});

test('verify - rejects the venue name repeated as the artist', () => {
  const rows = Array.from({ length: 5 }, () => ({ artist: 'Test Venue', date: '2026-09-01' }));
  const report = verifyEvents(rows, config, { now: NOW });
  assert.strictEqual(check(report, 'artist_names_plausible').ok, false);
});

test('verify - tolerates a minority of junk values', () => {
  const rows = [...goodEvents(9), { artist: 'Tickets', date: '2026-09-10' }];
  const report = verifyEvents(rows, config, { now: NOW });
  assert.strictEqual(check(report, 'artist_names_plausible').ok, true);
  assert.strictEqual(report.ok, true, formatVerifyReport(report));
});

test('verify - rejects unparseable dates', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ artist: `Band ${i}`, date: 'lorem ipsum dolor' }));
  const report = verifyEvents(rows, config, { now: NOW });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(check(report, 'dates_parse').ok, false);
});

test('verify - rejects an archive block where every date is in the past', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    artist: `Band ${i}`,
    date: `2019-03-0${i + 1}`
  }));
  const report = verifyEvents(rows, config, { now: NOW });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(check(report, 'has_future_dates').ok, false);
});

test('verify - rejects a collapse against the last good run', () => {
  // A venue that used to yield 40 events now yields 2: the selectors match
  // something, just not the schedule.
  const report = verifyEvents(goodEvents(2), config, { now: NOW, baselineCount: 40 });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(check(report, 'no_volume_collapse').ok, false);

  // Same two events with no baseline recorded: nothing to compare, so it passes.
  const noBaseline = verifyEvents(goodEvents(2), config, { now: NOW });
  assert.strictEqual(noBaseline.ok, true, formatVerifyReport(noBaseline));
});

test('verify - rejects relative ticket URLs', () => {
  const rows = goodEvents(6).map((e) => ({ ...e, ticketUrl: '/tickets/relative' }));
  const report = verifyEvents(rows, config, { now: NOW });
  assert.strictEqual(check(report, 'ticket_urls_absolute').ok, false);
});

test('verify - live gate fails when the scrape itself fails', async () => {
  const report = await verifyConfigLive(
    config,
    async () => ({ success: false, concerts: [], error: 'status code 403', reason: 'fetch_error' }),
    { now: NOW }
  );
  assert.strictEqual(report.ok, false);
  assert.match(formatVerifyReport(report), /live_fetch/);
});

test('verify - live gate surfaces a thrown scraper error instead of crashing', async () => {
  const report = await verifyConfigLive(
    config,
    async () => { throw new Error('boom'); },
    { now: NOW }
  );
  assert.strictEqual(report.ok, false);
  assert.match(report.checks[0].detail, /boom/);
});

test('verify - live gate passes a healthy scrape', async () => {
  const report = await verifyConfigLive(
    config,
    async () => ({ success: true, concerts: goodEvents(7) }),
    { now: NOW, baselineCount: 7 }
  );
  assert.strictEqual(report.ok, true, formatVerifyReport(report));
  assert.strictEqual(report.checks[0].name, 'live_fetch');
});

// --- The outage class the gate used to be blind to ---
//
// A `city` selector pointing at the same element as `venue` makes every "city"
// the whole event blurb. That is what froze the published API for 24 days, and
// before these checks it satisfied every rule in this file: real artists,
// parsing dates, holding volume. The healer would have accepted such a repair.

test('verify - rejects a repair whose city is the whole event blurb', () => {
  const blurb = '2026年9月21日(月・祝) 会場:東京Zepp DiverCity(TOKYO) OPEN 17:15 / START 18:00 出演:BONNIE PINK ほか多数のゲストミュージシャンが参加する特別公演';
  const events = goodEvents(10).map((e) => ({ ...e, city: blurb, venue: 'Zepp DiverCity' }));

  const report = verifyEvents(events, config, { now: NOW, baselineCount: 12 });
  assert.strictEqual(check(report, 'city_values_plausible').ok, false, formatVerifyReport(report));
  assert.strictEqual(report.ok, false);
});

test('verify - rejects a repair where city and venue are the same selector', () => {
  const events = goodEvents(10).map((e) => ({ ...e, city: 'Zepp DiverCity', venue: 'Zepp DiverCity' }));

  const report = verifyEvents(events, config, { now: NOW, baselineCount: 12 });
  assert.strictEqual(check(report, 'city_distinct_from_venue').ok, false, formatVerifyReport(report));
  assert.strictEqual(report.ok, false);
});

test('verify - rejects a repair whose country is prose rather than a code', () => {
  const events = goodEvents(10).map((e) => ({ ...e, city: 'Tokyo', country: 'Japan, Tokyo Prefecture' }));

  const report = verifyEvents(events, config, { now: NOW, baselineCount: 12 });
  assert.strictEqual(check(report, 'country_codes_valid').ok, false, formatVerifyReport(report));
  assert.strictEqual(report.ok, false);
});

test('verify - a genuinely good repair with place fields still passes', () => {
  const events = goodEvents(10).map((e, i) => ({
    ...e,
    city: i % 2 ? 'Berlin' : 'Hamburg',
    venue: 'Test Venue',
    country: 'DE'
  }));

  const report = verifyEvents(events, config, { now: NOW, baselineCount: 12 });
  assert.strictEqual(report.ok, true, formatVerifyReport(report));
  assert.strictEqual(check(report, 'city_values_plausible').ok, true);
  assert.strictEqual(check(report, 'city_distinct_from_venue').ok, true);
  assert.strictEqual(check(report, 'country_codes_valid').ok, true);
});

test('verify - place checks stay silent when the fields are absent', () => {
  // Absent city/venue is a fallback's job, not a mis-selection signal.
  const report = verifyEvents(goodEvents(10), config, { now: NOW, baselineCount: 12 });
  assert.strictEqual(report.ok, true, formatVerifyReport(report));
  assert.strictEqual(report.checks.some((c) => c.name === 'city_values_plausible'), false);
  assert.strictEqual(report.checks.some((c) => c.name === 'country_codes_valid'), false);
});
