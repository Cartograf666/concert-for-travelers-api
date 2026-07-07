import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { runScraper } from '../src/engine/runner.js';
import { parseDate } from '../src/pipeline/process.js';
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
