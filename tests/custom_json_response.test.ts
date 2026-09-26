import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const SO36_RESPONSE = JSON.stringify({
  products: [
    { supertitle: 'Konzert', title: 'SO36 Fixture Band', valid_start_on: '2026-10-14', url: '/tickets/fixture-band' },
    { supertitle: 'Party', title: 'Not a concert', valid_start_on: '2026-10-15', url: '/tickets/party' }
  ]
});

const JSON_API_RESPONSE = JSON.stringify({
  data: { events: [{ title: 'API Fixture Band', date: '2026-10-16' }] }
});

test('axios-backed runner passes raw JSON text to custom_js while json_api still parses JSON', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(request.url === '/tickets.json' ? SO36_RESPONSE : JSON_API_RESPONSE);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://localhost:${address.port}`;

  // Load the exact production config so this exercises the existing custom module
  // and its JSON.parse(html) contract, while replacing only the network origin.
  const so36 = JSON.parse(await readFile('scrapers/so36-berlin.json', 'utf8')) as ScraperConfig;
  so36.url = `${baseUrl}/tickets.json`;
  so36.domain = 'so36.fixture.test';
  const customResult = await runScraper(so36);
  assert.equal(customResult.success, true);
  assert.equal(customResult.concerts.length, 1);
  assert.equal(customResult.concerts[0].artist, 'SO36 Fixture Band');
  assert.equal(customResult.concerts[0].ticketUrl, `${baseUrl}/tickets/fixture-band`);

  const jsonApi: ScraperConfig = {
    id: 'json-response-fixture',
    domain: 'json-response.fixture.test',
    url: `${baseUrl}/api.json`,
    type: 'json_api',
    selectors: {
      eventBlock: 'data.events',
      artist: 'title',
      date: 'date',
      venueNameFallback: 'Fixture venue',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };
  const jsonApiResult = await runScraper(jsonApi);
  assert.equal(jsonApiResult.success, true);
  assert.equal(jsonApiResult.concerts.length, 1);
  assert.equal(jsonApiResult.concerts[0].artist, 'API Fixture Band');
});
