import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { runScraper, resolveHttpBackend } from '../src/engine/runner.js';
import { ScraperConfig } from '../src/schemas/config.js';

// The `npm test` script exports SCRAPER_ALLOW_LOCAL_HOSTS=1, so the SSRF guard
// permits the localhost mock server below on BOTH backends (got-scraping routes
// through the same DNS-validating agent that respects this flag).

function startMockServer(port: number, html: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(port, () => resolve(server));
  });
}

const MOCK_HTML = `
  <html><body>
    <div class="event-card">
      <div class="artist-name">The Cure</div>
      <span class="event-date">2026-10-15</span>
      <a class="ticket-link" href="https://example.com/tickets/cure">Tickets</a>
    </div>
    <div class="event-card">
      <div class="artist-name">Rammstein</div>
      <span class="event-date">2026-10-16</span>
      <a class="ticket-link" href="https://example.com/tickets/rammstein">Tickets</a>
    </div>
  </body></html>
`;

function mockConfig(port: number, backend?: 'axios' | 'got-scraping'): ScraperConfig {
  return {
    id: 'test-backend-venue',
    domain: 'test-backend.de',
    url: `http://localhost:${port}/agenda`,
    type: 'static_selectors',
    ...(backend ? { httpClient: backend } : {}),
    selectors: {
      eventBlock: '.event-card',
      artist: '.artist-name',
      date: '.event-date',
      ticketUrl: '.ticket-link',
      venueNameFallback: 'Test Backend Venue',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };
}

test('resolveHttpBackend precedence: env > config > default', () => {
  const base = mockConfig(0); // no httpClient -> default
  const withCfg = mockConfig(0, 'got-scraping');

  const saved = process.env.SCRAPER_HTTP_BACKEND;
  try {
    delete process.env.SCRAPER_HTTP_BACKEND;
    assert.strictEqual(resolveHttpBackend(base), 'axios', 'defaults to axios');
    assert.strictEqual(resolveHttpBackend(withCfg), 'got-scraping', 'per-config wins over default');

    process.env.SCRAPER_HTTP_BACKEND = 'axios';
    assert.strictEqual(resolveHttpBackend(withCfg), 'axios', 'env override beats per-config');

    process.env.SCRAPER_HTTP_BACKEND = 'garbage';
    assert.strictEqual(resolveHttpBackend(withCfg), 'got-scraping', 'invalid env is ignored, falls back to config');
  } finally {
    if (saved === undefined) delete process.env.SCRAPER_HTTP_BACKEND;
    else process.env.SCRAPER_HTTP_BACKEND = saved;
  }
});

test('got-scraping backend parses events at parity with axios', async () => {
  const PORT = 8137;
  const server = await startMockServer(PORT, MOCK_HTML);
  try {
    const axiosRes = await runScraper(mockConfig(PORT, 'axios'));
    const gotRes = await runScraper(mockConfig(PORT, 'got-scraping'));

    assert.strictEqual(axiosRes.success, true, 'axios succeeds');
    assert.strictEqual(gotRes.success, true, 'got-scraping succeeds');
    assert.strictEqual(gotRes.concerts.length, axiosRes.concerts.length, 'same event count');
    assert.strictEqual(gotRes.concerts.length, 2);
    assert.strictEqual(gotRes.concerts[0].artist, 'The Cure');
    assert.strictEqual(gotRes.concerts[1].artist, 'Rammstein');
    // ticketUrl absolute-resolution parity
    assert.strictEqual(gotRes.concerts[0].ticketUrl, 'https://example.com/tickets/cure');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
