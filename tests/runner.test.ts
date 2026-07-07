import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { runScraper, runAllScrapers, loadConfigs, closeBrowser, isRetryableError } from '../src/engine/runner.js';
import { ScraperConfig, ScraperConfigSchema } from '../src/schemas/config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Helper to start a local HTTP server
function startMockServer(port: number, routes: Record<string, string>): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = req.url || '';
      if (routes[path]) {
        const contentType = path.endsWith('.json') ? 'application/json' : 'text/html';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(routes[path]);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    server.listen(port, () => {
      resolve(server);
    });
  });
}

test('Runner Engine - scrape and parse static selectors', async (t) => {
  const PORT = 8123;
  const mockHtml = `
    <html>
      <body>
        <div class="event-card">
          <div class="artist-name">The Cure</div>
          <span class="event-date">12. Okt 2026</span>
          <a class="ticket-link" href="/tickets/cure">Buy Tickets</a>
        </div>
        <div class="event-card">
          <div class="artist-name">Rammstein</div>
          <span class="event-date">2026-10-15</span>
          <a class="ticket-link" href="https://example.com/tickets/rammstein">Tickets</a>
        </div>
      </body>
    </html>
  `;

  const server = await startMockServer(PORT, { '/club-arena': mockHtml });

  await t.test('Successfully extracts concerts with selectors', async () => {
    const config: ScraperConfig = {
      id: 'test-club-arena',
      domain: 'test-club.de',
      url: `http://localhost:${PORT}/club-arena`,
      type: 'static_selectors',
      selectors: {
        eventBlock: '.event-card',
        artist: '.artist-name',
        date: '.event-date',
        ticketUrl: '.ticket-link',
        venueNameFallback: 'Test Club Arena',
        cityNameFallback: 'Berlin',
        countryNameFallback: 'DE'
      }
    };

    const res = await runScraper(config);
    
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.concerts.length, 2);
    
    const [c1, c2] = res.concerts;
    assert.strictEqual(c1.artist, 'The Cure');
    assert.strictEqual(c1.date, '12. Okt 2026');
    assert.strictEqual(c1.ticketUrl, `http://localhost:${PORT}/tickets/cure`); // absolute resolution check
    
    assert.strictEqual(c2.artist, 'Rammstein');
    assert.strictEqual(c2.date, '2026-10-15');
    assert.strictEqual(c2.ticketUrl, 'https://example.com/tickets/rammstein');
  });

  await t.test('Fails and captures HTML sample when selectors match 0 events', async () => {
    const config: ScraperConfig = {
      id: 'test-club-arena',
      domain: 'test-club.de',
      url: `http://localhost:${PORT}/club-arena`,
      type: 'static_selectors',
      selectors: {
        eventBlock: '.non-existent-block',
        artist: '.artist-name',
        date: '.event-date',
        ticketUrl: '.ticket-link',
        venueNameFallback: 'Test Club Arena',
        cityNameFallback: 'Berlin',
        countryNameFallback: 'DE'
      }
    };

    const res = await runScraper(config);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.concerts.length, 0);
    assert.ok(res.error?.includes('Parsed 0 concerts'));
    assert.ok(res.htmlSample?.includes('event-card'));
  });

  // Stop the server
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Runner Engine - run all concurrently', async () => {
  const PORT = 8124;
  const page1 = `<div class="event-card"><div class="artist-name">Metallica</div><span class="event-date">2026-08-01</span></div>`;
  const page2 = `<div class="event-card"><div class="artist-name">Coldplay</div><span class="event-date">2026-08-02</span></div>`;

  const server = await startMockServer(PORT, {
    '/p1': page1,
    '/p2': page2
  });

  const configs: ScraperConfig[] = [
    {
      id: 'p1',
      domain: 'p1.de',
      url: `http://localhost:${PORT}/p1`,
      type: 'static_selectors',
      selectors: {
        eventBlock: '.event-card',
        artist: '.artist-name',
        date: '.event-date',
        venueNameFallback: 'Venue 1',
        cityNameFallback: 'City 1',
        countryNameFallback: 'DE'
      }
    },
    {
      id: 'p2',
      domain: 'p2.de',
      url: `http://localhost:${PORT}/p2`,
      type: 'static_selectors',
      selectors: {
        eventBlock: '.event-card',
        artist: '.artist-name',
        date: '.event-date',
        venueNameFallback: 'Venue 2',
        cityNameFallback: 'City 2',
        countryNameFallback: 'DE'
      }
    }
  ];

  const results = await runAllScrapers(configs, 2);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => r.success));
  
  // Close the server
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Runner Engine - artist tour page (per-row city/venue + artistNameFallback)', async () => {
  const PORT = 8126;
  // An artist's own tour page: rows carry date/city/venue but no per-row artist name.
  const mockHtml = `
    <html><body>
      <div class="tour-date">
        <span class="d">2026-09-01</span>
        <span class="c">Berlin</span>
        <span class="v">Waldbühne</span>
        <a class="tix" href="/tickets/berlin">Tickets</a>
      </div>
      <div class="tour-date">
        <span class="d">2026-09-04</span>
        <span class="c">Paris</span>
        <span class="v">Accor Arena</span>
        <a class="tix" href="/tickets/paris">Tickets</a>
      </div>
    </body></html>
  `;

  const server = await startMockServer(PORT, { '/tour': mockHtml });

  const config: ScraperConfig = {
    id: 'artist-metallica',
    domain: 'metallica.com',
    url: `http://localhost:${PORT}/tour`,
    type: 'static_selectors',
    selectors: {
      eventBlock: '.tour-date',
      artistNameFallback: 'Metallica',
      date: '.d',
      city: '.c',
      venue: '.v',
      ticketUrl: '.tix',
      venueNameFallback: '',
      cityNameFallback: '',
      countryNameFallback: 'DE'
    }
  };

  const res = await runScraper(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.concerts.length, 2);

  const [c1, c2] = res.concerts;
  assert.strictEqual(c1.artist, 'Metallica');
  assert.strictEqual(c1.city, 'Berlin');
  assert.strictEqual(c1.venue, 'Waldbühne');
  assert.strictEqual(c1.country, 'DE'); // per-row country absent -> fallback
  assert.strictEqual(c1.ticketUrl, `http://localhost:${PORT}/tickets/berlin`);

  assert.strictEqual(c2.artist, 'Metallica');
  assert.strictEqual(c2.city, 'Paris');
  assert.strictEqual(c2.venue, 'Accor Arena');

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Runner Engine - scrape and parse json_api', async (t) => {
  const PORT = 8125;
  const mockJson = JSON.stringify({
    success: true,
    data: {
      events: [
        {
          title: 'The Cure',
          start_date: '2026-10-12',
          ticket_link: 'https://example.com/tickets/cure'
        },
        {
          title: 'Rammstein',
          start_date: '2026-10-15',
          ticket_link: 'https://example.com/tickets/rammstein'
        }
      ]
    }
  });

  const server = await startMockServer(PORT, { '/events.json': mockJson });

  const config: ScraperConfig = {
    id: 'test-json-api',
    domain: 'test-api.com',
    url: `http://localhost:${PORT}/events.json`,
    type: 'json_api',
    selectors: {
      eventBlock: 'data.events',
      artist: 'title',
      date: 'start_date',
      ticketUrl: 'ticket_link',
      venueNameFallback: 'JSON Venue',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };

  const res = await runScraper(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.concerts.length, 2);

  const [c1, c2] = res.concerts;
  assert.strictEqual(c1.artist, 'The Cure');
  assert.strictEqual(c1.date, '2026-10-12');
  assert.strictEqual(c1.ticketUrl, 'https://example.com/tickets/cure');

  assert.strictEqual(c2.artist, 'Rammstein');
  assert.strictEqual(c2.date, '2026-10-15');
  assert.strictEqual(c2.ticketUrl, 'https://example.com/tickets/rammstein');

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Runner Engine - allowEmpty treats 0 parsed events as a valid empty schedule', async () => {
  const PORT = 8127;
  const server = await startMockServer(PORT, { '/empty': '<html><body><div class="none-here"></div></body></html>' });

  const config: ScraperConfig = {
    id: 'sparse-venue',
    domain: 'sparse-venue.test',
    url: `http://localhost:${PORT}/empty`,
    type: 'static_selectors',
    allowEmpty: true,
    selectors: {
      eventBlock: '.event-card',
      artist: '.artist-name',
      date: '.event-date',
      venueNameFallback: 'Sparse Venue',
      cityNameFallback: 'Tbilisi',
      countryNameFallback: 'GE'
    }
  };

  const res = await runScraper(config);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.concerts.length, 0);
  assert.strictEqual(res.reason, 'empty_schedule');

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Runner Engine - unsupported scraper type fails with a clear error instead of silently parsing 0 events', async () => {
  const PORT = 8128;
  const server = await startMockServer(PORT, { '/x': '<html></html>' });

  const config = {
    id: 'future-type',
    domain: 'future-type.test',
    url: `http://localhost:${PORT}/x`,
    type: 'graphql_api', // not a real, handled type -- exercises the runtime else-branch
    selectors: {
      eventBlock: '.e',
      date: '.d',
      venueNameFallback: 'V',
      cityNameFallback: 'C',
      countryNameFallback: 'DE'
    }
  } as unknown as ScraperConfig;

  const res = await runScraper(config);
  assert.strictEqual(res.success, false);
  assert.match(res.error ?? '', /Unsupported scraper type/);

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('Runner Engine - circuit breaker opens after 3 consecutive failures on the same domain', async () => {
  // Nothing listens on this port -- every attempt fails at the network layer.
  const CLOSED_PORT = 8129;
  const config: ScraperConfig = {
    id: 'circuit-test',
    domain: 'circuit-breaker-test.invalid',
    url: `http://127.0.0.1:${CLOSED_PORT}/x`,
    type: 'static_selectors',
    maxRetries: 0,
    selectors: {
      eventBlock: '.e',
      artist: '.a',
      date: '.d',
      venueNameFallback: 'V',
      cityNameFallback: 'C',
      countryNameFallback: 'DE'
    }
  };

  for (let i = 0; i < 3; i++) {
    const res = await runScraper(config);
    assert.strictEqual(res.success, false);
    assert.notStrictEqual(res.reason, 'circuit_open', `attempt ${i + 1} should fail normally, not via the breaker`);
  }

  // The breaker is now open: this call must be short-circuited without a real attempt.
  const res = await runScraper(config);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.reason, 'circuit_open');
});

test('Schema - rejects localhost/private-network/link-local/metadata scraper URLs (SSRF guard)', () => {
  const base = {
    id: 'x',
    domain: 'x.com',
    selectors: { eventBlock: '.e', date: '.d', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'DE' }
  };
  const blocked = [
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://localhost:1337/x',
    'http://127.0.0.1/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://[::1]/x',
    'file:///etc/passwd'
  ];
  for (const url of blocked) {
    const result = ScraperConfigSchema.safeParse({ ...base, url });
    assert.strictEqual(result.success, false, `${url} should be rejected`);
  }

  const allowed = ['https://www.melkweg.nl/en/agenda/', 'https://arenabeograd.com/wp-json/tribe/events/v1/events'];
  for (const url of allowed) {
    const result = ScraperConfigSchema.safeParse({ ...base, url });
    assert.strictEqual(result.success, true, `${url} should be accepted`);
  }
});

test('Runner Engine - loadConfigs skips a single malformed config instead of aborting the whole batch', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrapers-test-'));
  try {
    const valid: ScraperConfig = {
      id: 'valid-one',
      domain: 'valid-one.com',
      url: 'https://valid-one.com/events',
      type: 'static_selectors',
      selectors: { eventBlock: '.e', date: '.d', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'DE' }
    };
    await fs.writeFile(path.join(dir, 'valid-one.json'), JSON.stringify(valid), 'utf-8');
    // Malformed JSON (a real risk: a community PR with a typo'd config).
    await fs.writeFile(path.join(dir, 'broken.json'), '{ not valid json', 'utf-8');
    // Well-formed JSON that fails schema validation (SSRF-blocked host).
    await fs.writeFile(path.join(dir, 'ssrf-attempt.json'), JSON.stringify({ ...valid, id: 'ssrf', url: 'http://169.254.169.254/x' }), 'utf-8');

    const configs = await loadConfigs(dir);
    assert.strictEqual(configs.length, 1);
    assert.strictEqual(configs[0].id, 'valid-one');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Runner Engine - playwright_render renders the page with a headless browser then reuses static CSS extraction', async (t) => {
  const PORT = 8130;
  // A page whose events are injected by client-side JS after load -- a plain
  // axios GET would only ever see the empty shell, not the '.event-card' markup.
  const server = await startMockServer(PORT, {
    '/spa': `
      <html><body>
        <div id="root"></div>
        <script>
          document.getElementById('root').innerHTML =
            '<div class="event-card"><h2 class="artist-name">The Cure</h2><span class="event-date">12. Okt 2026</span></div>';
        </script>
      </body></html>
    `
  });

  const config: ScraperConfig = {
    id: 'spa-venue',
    domain: 'spa-venue.test',
    url: `http://localhost:${PORT}/spa`,
    type: 'playwright_render',
    selectors: {
      eventBlock: '.event-card',
      artist: '.artist-name',
      date: '.event-date',
      venueNameFallback: 'SPA Venue',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };

  try {
    const res = await runScraper(config);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.concerts.length, 1);
    assert.strictEqual(res.concerts[0].artist, 'The Cure');
  } finally {
    await closeBrowser();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Runner Engine - custom_js dispatches to a real custom module via dynamic import (melkweg-amsterdam)', async () => {
  // Exercises the previously-untested custom_js branch end-to-end: runScraper's
  // dynamic import of src/engine/custom/{id}.js, using the real melkweg-amsterdam
  // module (not a fixture stand-in) against a synthetic __NEXT_DATA__ payload
  // shaped like the real site's.
  const PORT = 8131;
  const nextData = {
    props: {
      pageProps: {
        pageData: {
          attributes: {
            content: [
              {
                attributes: {
                  layout: 'agenda',
                  initialEvents: [
                    { attributes: { name: 'Young Miko', startDate: '2026-07-06T21:00:00.000000Z', url: '/en/agenda/young-miko' } }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  };
  const server = await startMockServer(PORT, {
    '/agenda': `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`
  });

  const config: ScraperConfig = {
    id: 'melkweg-amsterdam',
    domain: 'www.melkweg.nl',
    url: `http://localhost:${PORT}/agenda`,
    type: 'custom_js',
    selectors: {
      eventBlock: '__NEXT_DATA__',
      artist: 'attributes.name',
      date: 'attributes.startDate',
      venueNameFallback: 'Melkweg',
      cityNameFallback: 'Amsterdam',
      countryNameFallback: 'NL'
    }
  };

  try {
    const res = await runScraper(config);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.concerts.length, 1);
    assert.strictEqual(res.concerts[0].artist, 'Young Miko');
    assert.strictEqual(res.concerts[0].date, '2026-07-06T21:00:00.000000Z');
    // Resolved against config.url (the mock server), not the real melkweg.nl domain.
    assert.strictEqual(res.concerts[0].ticketUrl, `http://localhost:${PORT}/en/agenda/young-miko`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Runner Engine - custom_js rejects a config missing selectors before even attempting the module', async () => {
  const PORT = 8132;
  const server = await startMockServer(PORT, { '/agenda': '<html></html>' });

  const config = {
    id: 'melkweg-amsterdam',
    domain: 'www.melkweg.nl',
    url: `http://localhost:${PORT}/agenda`,
    type: 'custom_js'
    // selectors intentionally omitted
  } as unknown as ScraperConfig;

  try {
    const res = await runScraper(config);
    assert.strictEqual(res.success, false);
    assert.match(res.error ?? '', /Selectors are missing/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Runner Engine - closeBrowser is idempotent and crash-safe', async () => {
  await closeBrowser();
  await closeBrowser();
});

test('Runner Engine - isRetryableError handles ENOTFOUND correctly', () => {
  const dnsError = { code: 'ENOTFOUND' };
  const timeoutError = { code: 'ETIMEDOUT' };
  
  assert.strictEqual(isRetryableError(dnsError), false);
  assert.strictEqual(isRetryableError(timeoutError), true);
});


