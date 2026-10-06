import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const EVENT_HTML = '<div class="event"><span class="artist">The Cure</span><span class="date">2026-11-01</span></div>';

function config(url: string, id: string, httpClient: 'axios' | 'got-scraping'): ScraperConfig {
  return {
    id,
    domain: `${id}.test`,
    url,
    type: 'static_selectors',
    httpClient,
    maxRetries: 1,
    selectors: {
      eventBlock: '.event',
      artist: '.artist',
      date: '.date',
      venueNameFallback: 'Test Venue',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };
}

test('a 200 with an empty body is retried before parsing the schedule', async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(requests === 1 ? '' : EVENT_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const result = await runScraper(config(`http://127.0.0.1:${address.port}/events`, 'empty-then-full', 'axios'));
    assert.equal(requests, 2);
    assert.equal(result.success, true);
    assert.equal(result.concerts.length, 1);
    assert.equal(result.concerts[0].artist, 'The Cure');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('persistent whitespace-only 200 is a fetch error even for allowEmpty schedules', async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(' \n\t ');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const result = await runScraper({
      ...config(`http://127.0.0.1:${address.port}/events`, 'always-empty', 'got-scraping'),
      allowEmpty: true
    });
    assert.equal(requests, 2);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'fetch_error');
    assert.match(result.error ?? '', /empty response body/i);
    assert.equal(result.htmlSample, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
