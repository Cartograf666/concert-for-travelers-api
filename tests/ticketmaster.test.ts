import test from 'node:test';
import assert from 'node:assert';
import { createServer, Server } from 'node:http';
import { fetchTicketmasterConcerts, mapEventToConcert, TicketmasterCache } from '../src/engine/ticketmaster.js';

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
    startTime: undefined,
    venue: 'Paradiso',
    city: 'Amsterdam',
    country: 'NL',
    lat: 52.3641,
    lng: 4.8837,
    festival: undefined,
    lineup: undefined,
    priceRange: undefined,
    ticketUrl: 'https://ticketmaster.com/event/abc',
    originalSource: 'ticketmaster.com',
    scrapedAt: '2026-07-07T00:00:00.000Z'
  });
});

test('Ticketmaster - mapEventToConcert captures startTime and festival/lineup for a multi-attraction event', () => {
  const event = {
    name: 'Rock am Ring 2026',
    url: 'https://ticketmaster.com/event/festival',
    dates: { start: { localDate: '2026-06-05', localTime: '18:30:00' } },
    _embedded: {
      venues: [{ name: 'Nurburgring', city: { name: 'Nurburg' }, country: { countryCode: 'DE' } }],
      attractions: [{ name: 'Muse' }, { name: 'Rammstein' }, { name: 'The Cure' }]
    }
  };
  const concert = mapEventToConcert(event, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(concert?.artist, 'Muse', 'first attraction is treated as the headliner artist');
  assert.strictEqual(concert?.startTime, '18:30');
  assert.deepStrictEqual(concert?.festival, { name: 'Rock am Ring 2026', url: 'https://ticketmaster.com/event/festival' });
  // Muse is already `artist` -- must not also appear in its own lineup.
  assert.deepStrictEqual(concert?.lineup, ['Rammstein', 'The Cure']);
});

test('Ticketmaster - a single-attraction event has no festival/lineup', () => {
  const event = {
    name: 'Muse at Nurburgring',
    dates: { start: { localDate: '2026-06-05' } },
    _embedded: {
      venues: [{ name: 'Nurburgring', city: { name: 'Nurburg' }, country: { countryCode: 'DE' } }],
      attractions: [{ name: 'Muse' }]
    }
  };
  const concert = mapEventToConcert(event, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(concert?.festival, undefined);
  assert.strictEqual(concert?.lineup, undefined);
});

test('Ticketmaster - mapEventToConcert extracts priceRange, collapsing multiple tiers to the overall min/max', () => {
  const event = {
    name: 'Muse at Nurburgring',
    dates: { start: { localDate: '2026-06-05' } },
    priceRanges: [
      { type: 'standard', currency: 'EUR', min: 45, max: 90 },
      { type: 'VIP', currency: 'EUR', min: 120, max: 250 }
    ],
    _embedded: {
      venues: [{ name: 'Nurburgring', city: { name: 'Nurburg' }, country: { countryCode: 'DE' } }],
      attractions: [{ name: 'Muse' }]
    }
  };
  const concert = mapEventToConcert(event, '2026-01-01T00:00:00.000Z');
  assert.deepStrictEqual(concert?.priceRange, { min: 45, max: 250, currency: 'EUR' });
});

test('Ticketmaster - mapEventToConcert omits priceRange when absent, empty, or missing numeric values', () => {
  const base = {
    name: 'Muse at Nurburgring',
    dates: { start: { localDate: '2026-06-05' } },
    _embedded: {
      venues: [{ name: 'Nurburgring', city: { name: 'Nurburg' }, country: { countryCode: 'DE' } }],
      attractions: [{ name: 'Muse' }]
    }
  };
  assert.strictEqual(mapEventToConcert(base, 'now')?.priceRange, undefined, 'no priceRanges field at all');
  assert.strictEqual(mapEventToConcert({ ...base, priceRanges: [] }, 'now')?.priceRange, undefined, 'empty priceRanges array');
  assert.strictEqual(
    mapEventToConcert({ ...base, priceRanges: [{ type: 'standard' }] }, 'now')?.priceRange,
    undefined,
    'priceRanges entry with no numeric min/max'
  );
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
      Array.from({ length: 200 }, (_, index) => ({ id: `a-${index}`, name: 'Show A', dates: { start: { localDate: '2026-09-01' } }, _embedded: { venues: [{ name: 'V1', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }], attractions: [{ name: 'Artist A' }] } })),
      [{ id: 'b-0', name: 'Show B', dates: { start: { localDate: '2026-09-02' } }, _embedded: { venues: [{ name: 'V2', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }], attractions: [{ name: 'Artist B' }] } }]
    ]
  });
  const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`);
  assert.strictEqual(concerts.length, 201);
  assert.equal(concerts[0].artist, 'Artist A');
  assert.equal(concerts.at(-1)?.artist, 'Artist B');
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

test('Ticketmaster - rate limit halts remaining countries and uses their caches', async () => {
  const PORT = 8348;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(429);
    res.end('rate limited');
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const cache: TicketmasterCache = {
    DE: { fetchedAt: '2025-01-01T00:00:00.000Z', concerts: [{ artist: 'Cached DE' }] },
    FR: { fetchedAt: '2025-01-01T00:00:00.000Z', concerts: [{ artist: 'Cached FR' }] }
  };
  let health: any;
  const concerts = await fetchTicketmasterConcerts('fake-key', ['DE', 'FR'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; });
  assert.equal(requests, 1);
  assert.deepStrictEqual(concerts.map((concert) => concert.artist), ['Cached DE', 'Cached FR']);
  assert.equal(health.halted.category, 'rate_limited');
  assert.equal(health.counts.cacheFallbacks, 2);
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - a country that fails falls back to its cached results instead of contributing nothing', async () => {
  const PORT = 8343;
  // DE always 500s; FR succeeds normally.
  const server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    if (url.searchParams.get('countryCode') === 'DE') {
      res.writeHead(500);
      res.end('server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      _embedded: { events: [{ id: 'fr-0', name: 'Fresh FR Show', dates: { start: { localDate: '2026-09-05' } }, _embedded: { venues: [{ name: 'V3', city: { name: 'Paris' }, country: { countryCode: 'FR' } }], attractions: [{ name: 'Fresh Artist' }] } }] },
      page: { size: 200, totalElements: 1, totalPages: 1, number: 0 }
    }));
  });
  await new Promise<void>((r) => server.listen(PORT, () => r()));

  const cache: TicketmasterCache = {
    DE: {
      fetchedAt: '2026-07-06T00:00:00.000Z',
      concerts: [{ artist: 'Cached DE Artist', date: '2026-09-01', venue: 'V1', city: 'Berlin', country: 'DE', originalSource: 'ticketmaster.com', scrapedAt: '2026-07-06T00:00:00.000Z' }]
    }
  };

  let health: any;
  const concerts = await fetchTicketmasterConcerts(
    'fake-key', ['DE', 'FR'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; }
  );

  assert.deepStrictEqual(concerts.map((c) => c.artist).sort(), ['Cached DE Artist', 'Fresh Artist']);
  // Cache for the country that actually succeeded must be refreshed with the new data.
  assert.strictEqual(cache.FR.concerts[0].artist, 'Fresh Artist');
  // Cache for the failed country must be left untouched (still the old entry, not wiped).
  assert.strictEqual(cache.DE.concerts[0].artist, 'Cached DE Artist');
  assert.equal(health.counts.failed, 1);
  assert.equal(health.counts.cacheFallbacks, 1);
  assert.equal(health.counts.succeeded, 1);
  assert.equal(health.completeness, 'partial');

  await new Promise<void>((r) => server.close(() => r()));
});

test('Ticketmaster - a country failing after page one is reported as partial', async () => {
  const PORT = 8344;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const page = Number(url.searchParams.get('page') || 0);
    if (page === 1) {
      res.writeHead(500);
      res.end('server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      _embedded: { events: Array.from({ length: 200 }, (_, index) => ({
        id: `partial-${index}`, name: 'Partial Show', dates: { start: { localDate: '2026-09-05' } },
        _embedded: { venues: [{ name: 'V', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }] }
      })) },
      page: { size: 200, totalElements: 201, totalPages: 2, number: 0 }
    }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  let health: any;
  const concerts = await fetchTicketmasterConcerts(
    'fake-key', ['DE'], `http://localhost:${PORT}/events.json`, {},
    (report) => { health = report; }
  );
  assert.equal(concerts.length, 200, 'preserve partial output without a cache');
  assert.equal(health.counts.failed, 1);
  assert.equal(health.counts.partial, 1);
  assert.equal(health.counts.cacheFallbacks, 0);
  assert.equal(health.completeness, 'partial');
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - splits more than 1000 future events and deduplicates the overlap by event ID', async () => {
  const PORT = 8345;
  let events: Array<any> = [];
  let splitRequests = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const start = url.searchParams.get('startDateTime')!;
    const end = url.searchParams.get('endDateTime');
    if (events.length === 0) {
      const base = Date.parse(start);
      events = Array.from({ length: 1201 }, (_, index) => {
        const instant = new Date(base + (index + 1) * 24 * 60 * 60 * 1000).toISOString();
        return {
          id: `event-${index}`,
          instant,
          name: `Show ${index}`,
          url: `https://ticketmaster.example/event/${index}`,
          dates: { start: { localDate: instant.slice(0, 10) } },
          _embedded: { venues: [{ name: 'V', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }] }
        };
      });
    }
    if (end) splitRequests++;
    const matches = events.filter((event) => event.instant >= start && (!end || event.instant <= end));
    const page = Number(url.searchParams.get('page') || 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      _embedded: { events: matches.slice(page * 200, (page + 1) * 200) },
      page: { size: 200, totalElements: matches.length, totalPages: Math.ceil(matches.length / 200), number: page }
    }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  let health: any;
  const cache: TicketmasterCache = {};
  const concerts = await fetchTicketmasterConcerts(
    'fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; }
  );
  assert.ok(splitRequests > 0, 'dense country was split into date windows');
  assert.equal(concerts.length, 1201);
  assert.equal(new Set(concerts.map((event) => event.ticketUrl)).size, 1201);
  assert.equal(health.counts.succeeded, 1);
  assert.equal(health.counts.partial, 0);
  assert.equal(health.completeness, 'complete');
  assert.equal(cache.DE.concerts.length, 1201);
  assert.ok(cache.DE.verifiedAt);
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - incomplete split keeps last-good cache and verification time', async () => {
  const PORT = 8346;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const page = Number(url.searchParams.get('page') || 0);
    if (url.searchParams.has('endDateTime') && page === 1) {
      res.writeHead(500);
      res.end('server error');
      return;
    }
    const start = Date.parse(url.searchParams.get('startDateTime')!);
    const end = url.searchParams.get('endDateTime');
    const count = end ? 600 : 1201;
    const events = Array.from({ length: Math.min(200, count - page * 200) }, (_, index) => ({
      id: `event-${start}-${page * 200 + index}`,
      name: 'Fresh partial', dates: { start: { localDate: new Date(start + 86400000).toISOString().slice(0, 10) } },
      _embedded: { venues: [{ name: 'V', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }] }
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _embedded: { events }, page: { size: 200, totalElements: count, totalPages: Math.ceil(count / 200), number: page } }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const previous = {
    fetchedAt: '2025-01-01T00:00:00.000Z', verifiedAt: '2025-01-01T00:00:00.000Z',
    concerts: [{ artist: 'Last good', date: '2027-01-01', venue: 'V', city: 'Berlin', country: 'DE' }]
  };
  const cache: TicketmasterCache = { DE: structuredClone(previous) };
  let health: any;
  const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; });
  assert.deepStrictEqual(cache.DE, previous);
  assert.deepStrictEqual(concerts, previous.concerts);
  assert.equal(health.counts.cacheFallbacks, 1);
  assert.equal(health.completeness, 'partial');
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - malformed 200 and short or drifting pages preserve last-good cache', async () => {
  const PORT = 8349;
  let mode: 'missing_metadata' | 'short_last_page' | 'drifting_total' = 'missing_metadata';
  const rawEvent = (id: string) => ({
    id, name: 'Fresh', dates: { start: { localDate: '2027-09-05' } },
    _embedded: { venues: [{ name: 'V', city: { name: 'Berlin' }, country: { countryCode: 'DE' } }] }
  });
  const server = createServer((req, res) => {
    const page = Number(new URL(req.url || '', `http://localhost:${PORT}`).searchParams.get('page') || 0);
    const events = page === 0 ? Array.from({ length: 200 }, (_, index) => rawEvent(`fresh-${index}`)) :
      mode === 'short_last_page' ? [] : [rawEvent('fresh-last'), rawEvent('extra')];
    const metadata = mode === 'missing_metadata' ? undefined : {
      size: 200, totalElements: mode === 'drifting_total' && page === 1 ? 202 : 201,
      totalPages: 2, number: page
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _embedded: { events }, page: metadata }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  for (const nextMode of ['missing_metadata', 'short_last_page', 'drifting_total'] as const) {
    mode = nextMode;
    const previous = {
      fetchedAt: '2025-01-01T00:00:00.000Z', verifiedAt: '2025-01-01T00:00:00.000Z',
      concerts: [{ artist: 'Last good', date: '2027-01-01', venue: 'V', city: 'Berlin', country: 'DE' }]
    };
    const cache: TicketmasterCache = { DE: structuredClone(previous) };
    let health: any;
    const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
      (report) => { health = report; });
    assert.deepStrictEqual(cache.DE, previous, `${mode} must not replace the cache`);
    assert.deepStrictEqual(concerts, previous.concerts);
    assert.equal(health.counts.failed, 1);
    assert.equal(health.completeness, 'partial');
    assert.deepStrictEqual(health.issues, [{ reason: 'invalid_response', count: 1, action: 'retry_next_scheduled_sweep' }]);
  }
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - malformed event rows do not erase last-good cache or advance verification', async () => {
  const PORT = 8351;
  let row: unknown = {};
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _embedded: { events: [row] },
      page: { size: 200, totalElements: 1, totalPages: 1, number: 0 } }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const previous = {
    fetchedAt: '2026-10-05T00:00:00.000Z', verifiedAt: '2026-10-05T00:00:00.000Z',
    concerts: [{ artist: 'Last good', date: '2027-01-01', venue: 'V', city: 'Berlin', country: 'DE' }]
  };
  for (const invalidRow of [{}, [], { id: 'truncated' },
    { id: 'truncated', name: 'No dates' }, { id: 'truncated', name: 'Bad dates', dates: { start: {} } }]) {
    row = invalidRow;
    const cache: TicketmasterCache = { DE: structuredClone(previous) };
    let health: any;
    const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
      (report) => { health = report; });
    assert.deepStrictEqual(concerts, previous.concerts);
    assert.deepStrictEqual(cache.DE, previous);
    assert.equal(health.counts.failed, 1);
    assert.equal(health.counts.cacheFallbacks, 1);
    assert.equal(health.counts.succeeded, 0);
    assert.equal(health.completeness, 'partial');
    assert.deepStrictEqual(health.issues, [{ reason: 'invalid_response', count: 1, action: 'retry_next_scheduled_sweep' }]);
  }
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - valid date-TBA event without venue is not a malformed response', async () => {
  const PORT = 8352;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ _embedded: { events: [
      { id: 'tba-1', name: 'Upcoming Music Show', dates: { start: { dateTBA: true } } }
    ] }, page: { size: 200, totalElements: 1, totalPages: 1, number: 0 } }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const cache: TicketmasterCache = {};
  let health: any;
  const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; });
  assert.deepStrictEqual(concerts, [], 'a TBA event is not a dated concert');
  assert.deepStrictEqual(cache.DE.concerts, []);
  assert.ok(cache.DE.verifiedAt);
  assert.equal(health.counts.succeeded, 1);
  assert.equal(health.counts.failed, 0);
  assert.equal(health.completeness, 'complete');
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - valid zero-event envelope can verify an empty country', async () => {
  const PORT = 8350;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ page: { size: 200, totalElements: 0, totalPages: 0, number: 0 } }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  const cache: TicketmasterCache = { DE: {
    fetchedAt: '2026-10-05T00:00:00.000Z', verifiedAt: '2026-10-05T00:00:00.000Z',
    concerts: [{ artist: 'Last good' }]
  } };
  let health: any;
  const concerts = await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; });
  assert.deepStrictEqual(concerts, []);
  assert.deepStrictEqual(cache.DE.concerts, []);
  assert.notEqual(cache.DE.verifiedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(health.counts.cacheFallbacks, 0);
  assert.equal(health.counts.empty, 1);
  assert.equal(health.completeness, 'complete');
  await new Promise<void>((resolve) => server.close(resolve));
});

test('Ticketmaster - same-instant density stays partial instead of claiming full coverage', async () => {
  const PORT = 8347;
  let eventInstant: number | undefined;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const start = Date.parse(url.searchParams.get('startDateTime')!);
    if (eventInstant === undefined) eventInstant = start + 1;
    const end = url.searchParams.get('endDateTime');
    const hasDenseInstant = start <= eventInstant && (!end || Date.parse(end) >= eventInstant);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      _embedded: { events: hasDenseInstant ? Array.from({ length: 200 }, (_, index) => ({ id: `dense-${index}`, name: 'Dense', dates: { start: { localDate: '2027-09-05' } } })) : [] },
      page: { size: 200, totalElements: hasDenseInstant ? 1001 : 0, totalPages: hasDenseInstant ? 6 : 0, number: 0 }
    }));
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  let health: any;
  const cache: TicketmasterCache = {
    DE: { fetchedAt: '2025-01-01T00:00:00.000Z', verifiedAt: '2025-01-01T00:00:00.000Z', concerts: [] }
  };
  await fetchTicketmasterConcerts('fake-key', ['DE'], `http://localhost:${PORT}/events.json`, cache,
    (report) => { health = report; });
  assert.equal(health.counts.succeeded, 0);
  assert.equal(health.counts.partial, 1);
  assert.equal(health.completeness, 'partial');
  assert.equal(cache.DE.verifiedAt, '2025-01-01T00:00:00.000Z');
  assert.deepStrictEqual(health.issues, [{
    reason: 'pagination_limit', count: 1, action: 'treat_source_coverage_as_partial'
  }]);
  await new Promise<void>((resolve) => server.close(resolve));
});
