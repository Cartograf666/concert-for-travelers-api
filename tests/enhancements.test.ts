import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { runScraper } from '../src/engine/runner.js';
import { parseDate, buildApprovedMatcher } from '../src/pipeline/process.js';
import { extractJsonLd } from '../src/engine/structured.js';
import { ScraperConfig } from '../src/schemas/config.js';

function startMockServer(port: number, routes: Record<string, string>): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const p = req.url || '';
      if (routes[p] !== undefined) {
        const contentType = p.endsWith('.json') ? 'application/json' : 'text/html';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(routes[p]);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(port, () => resolve(server));
  });
}

const JSONLD_PAGE = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"MusicEvent","name":"Radiohead",
 "startDate":"2026-09-10T20:00:00",
 "location":{"@type":"MusicVenue","name":"Paradiso","address":{"@type":"PostalAddress","addressLocality":"Amsterdam","addressCountry":"NL"}},
 "offers":{"@type":"Offer","url":"/tickets/radiohead"}}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"MusicEvent","name":"Aphex Twin","startDate":"2026-09-12","location":{"name":"Melkweg","address":{"addressLocality":"Amsterdam","addressCountry":"Netherlands"}}}
]}
</script>
</head><body><div id="root"></div></body></html>`;

test('JSON-LD extractor pulls schema.org events (object + @graph, offer + fallback country)', () => {
  const config = {
    id: 'jsonld-test', domain: 'paradiso.nl',
    url: 'https://www.paradiso.nl/agenda', type: 'jsonld',
    selectors: { eventBlock: '', date: '', venueNameFallback: 'X', cityNameFallback: 'X', countryNameFallback: 'NL' }
  } as unknown as ScraperConfig;

  const out = extractJsonLd(config, JSONLD_PAGE, '2026-07-07T00:00:00.000Z');
  assert.strictEqual(out.length, 2);
  const rad = out.find((c) => c.artist === 'Radiohead')!;
  assert.strictEqual(rad.date, '2026-09-10T20:00:00');
  assert.strictEqual(rad.venue, 'Paradiso');
  assert.strictEqual(rad.city, 'Amsterdam');
  assert.strictEqual(rad.country, 'NL');
  assert.strictEqual(rad.ticketUrl, 'https://www.paradiso.nl/tickets/radiohead');

  // "Netherlands" is not a 2-letter code -> falls back to countryNameFallback.
  const aphex = out.find((c) => c.artist === 'Aphex Twin')!;
  assert.strictEqual(aphex.country, 'NL');
});

test('runScraper type=jsonld end to end', async () => {
  const PORT = 8231;
  const server = await startMockServer(PORT, { '/agenda': JSONLD_PAGE });
  const config: ScraperConfig = {
    id: 'jsonld-live', domain: 'paradiso.nl',
    url: `http://localhost:${PORT}/agenda`, type: 'jsonld' as any,
    selectors: { eventBlock: '', date: '', venueNameFallback: 'X', cityNameFallback: 'X', countryNameFallback: 'NL' }
  };
  const res = await runScraper(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.concerts.length, 2);
  await new Promise<void>((r) => server.close(() => r()));
});

test('static_selectors auto-recovers via JSON-LD when selectors match 0', async () => {
  const PORT = 8232;
  const server = await startMockServer(PORT, { '/agenda': JSONLD_PAGE });
  const config: ScraperConfig = {
    id: 'static-fallback', domain: 'paradiso.nl',
    url: `http://localhost:${PORT}/agenda`, type: 'static_selectors',
    selectors: {
      eventBlock: 'li.css-deadbeef', artist: 'h3', date: 'p',
      venueNameFallback: 'Paradiso', cityNameFallback: 'Amsterdam', countryNameFallback: 'NL'
    }
  };
  const res = await runScraper(config);
  assert.strictEqual(res.success, true, 'should recover via JSON-LD fallback');
  assert.strictEqual(res.concerts.length, 2);
  await new Promise<void>((r) => server.close(() => r()));
});

test('CSR shell (empty root, no data) is classified csr_detected', async () => {
  const PORT = 8233;
  const csrPage = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script></body></html>`;
  const server = await startMockServer(PORT, { '/spa': csrPage });
  const config: ScraperConfig = {
    id: 'csr', domain: 'spa.nl', url: `http://localhost:${PORT}/spa`, type: 'static_selectors',
    selectors: { eventBlock: '.event', artist: '.a', date: '.d', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'NL' }
  };
  const res = await runScraper(config);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.reason, 'csr_detected');
  await new Promise<void>((r) => server.close(() => r()));
});

test('next_data scraper reads __NEXT_DATA__ hydration JSON with array path', async () => {
  const PORT = 8234;
  const page = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { pages: [{ events: [
      { title: 'Muse', start: '2026-10-01', url: '/e/muse' },
      { title: 'Placebo', start: '2026-10-02' }
    ] }] } }
  })}</script></body></html>`;
  const server = await startMockServer(PORT, { '/x': page });
  const config: ScraperConfig = {
    id: 'nextdata', domain: 'venue.com', url: `http://localhost:${PORT}/x`, type: 'next_data' as any,
    selectors: {
      eventBlock: 'props.pageProps.pages[0].events', artist: 'title', date: 'start', ticketUrl: 'url',
      venueNameFallback: 'Hall', cityNameFallback: 'London', countryNameFallback: 'GB'
    }
  };
  const res = await runScraper(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.concerts.length, 2);
  assert.strictEqual(res.concerts[0].artist, 'Muse');
  assert.strictEqual(res.concerts[0].ticketUrl, `http://localhost:${PORT}/e/muse`);
  await new Promise<void>((r) => server.close(() => r()));
});

test('json_api supports bracket array indices in the events path', async () => {
  const PORT = 8235;
  const json = JSON.stringify({ data: { pages: [{ events: [{ t: 'A', d: '2026-01-01' }] }] } });
  const server = await startMockServer(PORT, { '/e.json': json });
  const config: ScraperConfig = {
    id: 'apidx', domain: 'api.com', url: `http://localhost:${PORT}/e.json`, type: 'json_api',
    selectors: {
      eventBlock: 'data.pages[0].events', artist: 't', date: 'd',
      venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'US'
    }
  };
  const res = await runScraper(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.concerts.length, 1);
  await new Promise<void>((r) => server.close(() => r()));
});

test('parseDate rolls year-less dates forward to next occurrence', () => {
  const base = '2026-12-15T12:00:00'; // mid-December, local
  assert.strictEqual(parseDate('5 jan', base), '2027-01-05');   // past this year -> next year
  assert.strictEqual(parseDate('20 dec', base), '2026-12-20');  // still ahead -> same year
  assert.strictEqual(parseDate('5.1.', base), '2027-01-05');    // DD.MM. no year
});

test('parseDate falls back to chrono for ordinal/natural formats', () => {
  const base = '2026-01-01T12:00:00';
  assert.strictEqual(parseDate('October 3rd 2026', base), '2026-10-03');
});

test('parseDate keeps a just-passed year-less date in the current year (grace window)', () => {
  const base = '2026-07-07T12:00:00';
  // 3 July, seen on the 7th -> a few days late, stays 2026 (not rolled to 2027).
  assert.strictEqual(parseDate('3 July', base), '2026-07-03');
  // Months in the past -> next year's occurrence.
  assert.strictEqual(parseDate('3 February', base), '2027-02-03');
});

test('short approved names match only exactly, longer names match whole-word', () => {
  const match = buildApprovedMatcher(['U2', 'Muse']);
  assert.strictEqual(match('U2')?.name, 'U2');
  assert.strictEqual(match('U2 and friends live'), null, 'short name not matched as a substring');
  assert.strictEqual(match('Muse at the O2')?.name, 'Muse', 'normal name matched whole-word');
  assert.strictEqual(match('Muse Tribute Night'), null, 'tribute filtered out');
});

test('substring matches require a minimum coverage of the cleaned string, not just a word-boundary hit', () => {
  // Real cases found by auditing live scraped output: approved-artist entries
  // that are also common dictionary words ("Darts", "Music", "Queer", "Mega")
  // must not swallow unrelated non-music event titles that merely contain that
  // word as a small fraction of a much longer title.
  const match = buildApprovedMatcher(['Darts', 'Music', 'Queer', 'Mega', 'Muse']);
  assert.strictEqual(match('World Series of Darts Finals'), null, 'a darts tournament is not a "Darts" concert');
  assert.strictEqual(match('QUEER WRESTLING CIRCUS'), null, 'a wrestling show is not a "Queer" concert');
  assert.strictEqual(match('WORLD PRIDE MUSIC FESTIVAL'), null, 'too little of the title is "Music" to be confident');
  // But a normal, mostly-just-the-name listing still matches (coverage is high enough).
  assert.strictEqual(match('Muse at the O2')?.name, 'Muse');
});

test('substring matches reject a name with an attached capitalized neighbor word', () => {
  // Real cases found auditing live published output (dist/concerts.json): a
  // short/common approved name absorbing a fragment of a longer, different,
  // NOT-approved artist's real name, because the fragment alone clears the
  // coverage bar. The true artist in each case simply isn't in the approved
  // list yet -- the correct behavior is to return null, not the fragment.
  const match = buildApprovedMatcher(['Baby', 'Anonymous', 'Band', 'Live', 'Muse']);
  assert.strictEqual(match('Baby Keem'), null, '"Baby" must not absorb "Baby Keem"');
  assert.strictEqual(match('Joy Anonymous'), null, '"Anonymous" must not absorb "Joy Anonymous"');
  assert.strictEqual(match('Gilla Band'), null, '"Band" must not absorb "Gilla Band"');
  assert.strictEqual(match('Peter Kay Live 2026'), null, '"Live" must not absorb "Peter Kay Live 2026"');
  // A standalone match with no attached capitalized word still works.
  assert.strictEqual(match('Baby')?.name, 'Baby');
  assert.strictEqual(match('Muse at the O2')?.name, 'Muse', 'lowercase neighbor ("at") does not trigger the guard');
});

test('phrase-connector words ("of"/"the") glued to a match reject the fragment', () => {
  const match = buildApprovedMatcher(['Fire', 'Songs', 'Muse', 'The Cure']);
  assert.strictEqual(match('Wall of Fire'), null, '"Fire" must not absorb "Wall of Fire"');
  assert.strictEqual(match('Songs of Love'), null, '"Songs" must not absorb "Songs of Love"');
  // Locational prepositions are NOT connectors -> real listings still match.
  assert.strictEqual(match('Muse at the O2')?.name, 'Muse');
  assert.strictEqual(match('The Cure in Berlin')?.name, 'The Cure');
});

test('substring/fuzzy tiers only consider the first " - "-delimited clause of the title', () => {
  // Real case: a genre tag trailing after a dash ("... - Alternative Rock")
  // wrongly matched an approved-artist entry that happens to also be a genre
  // name, because it was searched across the whole title instead of just the
  // artist-name clause.
  const match = buildApprovedMatcher(['Alternative rock', 'Muse']);
  assert.strictEqual(
    match('Headless Party - The Home Of Core - Alternative Rock'),
    null,
    'a trailing genre-tag clause must not be searched for a match'
  );
});

test('fuzzy fallback uses a tighter edit-distance tolerance for shorter names', () => {
  // Real cases: "Battery" (7 chars) wrongly absorbed "Baskery" and "Ariola"
  // (6 chars) wrongly absorbed "Akriila", both at edit distance 2 -- a much
  // larger relative change for a short name than for a long one.
  const match = buildApprovedMatcher(['Battery', 'Ariola', 'Rammstein']);
  assert.strictEqual(match('Baskery'), null, '"Battery" must not fuzzy-absorb "Baskery"');
  assert.strictEqual(match('Akriila'), null, '"Ariola" must not fuzzy-absorb "Akriila"');
  // A common single-transposition typo on a longer name still matches --
  // the tightened tolerance must not regress ordinary fuzzy noise handling.
  assert.strictEqual(match('Rammstien')?.name, 'Rammstein');
});

const CACHE_HTML = `<div class="event-card"><div class="artist-name">Muse</div><span class="event-date">2026-08-01</span></div>`;

test('runScraper reports contentHash and detects unchanged content by hash', async () => {
  const PORT = 8241;
  const server = await startMockServer(PORT, { '/e': CACHE_HTML });
  const config: ScraperConfig = {
    id: 'cache-hash', domain: 'v.de', url: `http://localhost:${PORT}/e`, type: 'static_selectors',
    selectors: { eventBlock: '.event-card', artist: '.artist-name', date: '.event-date', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'DE' }
  };
  const r1 = await runScraper(config);
  assert.strictEqual(r1.success, true);
  assert.ok(r1.contentHash, 'contentHash present');
  assert.ok(!r1.notModified);

  const cache = { contentHash: r1.contentHash!, scrapedAt: r1.scrapedAt, concerts: r1.concerts };
  const r2 = await runScraper(config, cache);
  assert.strictEqual(r2.notModified, true, 'second run detects unchanged content');
  await new Promise<void>((r) => server.close(() => r()));
});

test('runScraper reuses cached events on a 304 Not Modified', async () => {
  const PORT = 8242;
  const server = createServer((req, res) => {
    if (req.headers['if-none-match'] === '"v1"') {
      res.writeHead(304, { ETag: '"v1"' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html', ETag: '"v1"' });
      res.end(CACHE_HTML);
    }
  });
  await new Promise<void>((r) => server.listen(PORT, () => r()));

  const config: ScraperConfig = {
    id: 'cache-304', domain: 'v.de', url: `http://localhost:${PORT}/e`, type: 'static_selectors',
    selectors: { eventBlock: '.event-card', artist: '.artist-name', date: '.event-date', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'DE' }
  };
  const r1 = await runScraper(config);
  assert.strictEqual(r1.etag, '"v1"');
  assert.strictEqual(r1.concerts.length, 1);

  const cache = { etag: r1.etag, contentHash: r1.contentHash!, scrapedAt: r1.scrapedAt, concerts: r1.concerts };
  const r2 = await runScraper(config, cache);
  assert.strictEqual(r2.notModified, true, '304 -> notModified');
  assert.strictEqual(r2.concerts.length, 1, 'cached events reused');
  await new Promise<void>((r) => server.close(() => r()));
});
