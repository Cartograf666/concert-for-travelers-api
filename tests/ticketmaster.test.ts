import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { fetchTicketmasterConcerts, mapEventToConcert } from '../src/engine/ticketmaster.js';

function startMockDiscoveryServer(port: number, pagesByCountry: Record<string, any[]>): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${port}`);
      const countryCode = url.searchParams.get('countryCode') || '';
      const page = parseInt(url.searchParams.get('page') || '0', 10);
      const pages = pagesByCountry[countryCode] || [];
      const events = pages[page] || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        _embedded: events.length ? { events } : undefined,
        page: { size: 200, totalElements: pages.flat().length, totalPages: pages.length, number: page }
      }));
    });
    server.listen(port, () => resolve(server));
  });
}

test('Ticketmaster - mapEventToConcert prefers the attraction name over the raw event title', () => {
  const event = {
    name: 'Radiohead at Paradiso',
    url: 'https://ticketmaster.com/event/abc',
    dates: { start: { localDate: '2026-09-10' } },
    _embedded: {
      venues: [{
        name: 'Paradiso',
        city: { name: 'Amsterdam' },
        country: { countryCode: 'NL' },
        location: { latitude: '52.3641', longitude: '4.8837' }
      }],
      attractions: [{ name: 'Radiohead' }]
    }
  };
  const concert = mapEventToConcert(event, '2026-07-07T00:00:00.000Z');
  assert.deepStrictEqual(concert, {
    artist: 'Radiohead',
    date: '2026-09-10',
    venue: 'Paradiso',
    city: 'Amsterdam',
    country: 'NL',
    lat: 52.3641,
    lng: 4.8837,
    ticketUrl: 'https://ticketmaster.com/event/abc',
    originalSource: 'ticketmaster.com',
    scrapedAt: '2026-07-07T00:00:00.000Z'
  });
});

test('Ticketmaster - mapEventToConcert falls back to the event name when no attraction is listed', () => {
  const event = {
    name: 'Local Jazz Night',
    dates: { start: { localDate: '2026-09-10' } },
    _embedded: {
      venues: [{ name: 'Blue Note', city: { name: 'Tokyo' }, country: { countryCode: 'JP' } }]
    }
  };
  const concert = mapEventToConcert(event, '2026-07-07T00:00:00.000Z');
  assert.strictEqual(concert?.artist, 'Local Jazz Night');
  assert.strictEqual(concert?.lat, undefined);
});

test('Ticketmaster - mapEventToConcert rejects an event missing required fields', () => {
  assert.strictEqual(mapEventToConcert({ name: 'No Venue Event', dates: { start: { localDate: '2026-09-10' } } }, 'now'), null);
  assert.strictEqual(mapEventToConcert({ name: 'No Date Event', _embedded: { venues: [{ name: 'V', city: { name: 'C' }, country: { countryCode: 'DE' } }] } }, 'now'), null);
});

test('Ticketmaster - fetchTicketmasterConcerts paginates within a country and stops at totalPages', async () => {
  const PORT = 8341;
  const server = await startMockDiscoveryServer(PORT, {
    DE: [
      [{ name: 'Show A', dates: { start: { localDate: '2026-09-01' } }, _embedded: { venues: [{ name: 'V1', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }], attractions: [{ name: 'Artist A' }] } }],
      [{ name: 'Show B', dates: { start: { localDate: '2026-09-02' } }, _embedded: { venues: [{ name: 'V2', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }], attractions: [{ name: 'Artist B' }] } }]
    ]
  });
  const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`);
  assert.strictEqual(concerts.length, 2);
  assert.deepStrictEqual(concerts.map((c) => c.artist), ['Artist A', 'Artist B']);
  await new Promise<void>((r) => server.close(() => r()));
});

test('Ticketmaster - fetchTicketmasterConcerts stops the whole sweep on a 401/403 auth error', async () => {
  const PORT = 8342;
  const server = createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fault: { faultstring: 'Invalid ApiKey' } }));
  });
  await new Promise<void>((r) => server.listen(PORT, () => r()));

  const concerts = await fetchTicketmasterConcerts('bad-key', ['DE', 'FR'], `http://localhost:${PORT}/events.json`);
  assert.strictEqual(concerts.length, 0);
  await new Promise<void>((r) => server.close(() => r()));
});
