import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { runScraper, runAllScrapers, loadConfigs } from '../src/engine/runner.js';
import { ScraperConfig } from '../src/schemas/config.js';
import * as fs from 'fs/promises';
import * as path from 'path';

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
