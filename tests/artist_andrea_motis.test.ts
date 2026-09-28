import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

test('Andrea Motis agenda separates explicit countries and does not invent an absent venue or country', async () => {
  const html = await readFile('tests/fixtures/artist-andrea-motis-agenda.html', 'utf8');
  const config = JSON.parse(await readFile('scrapers/artists/artist-andrea-motis.json', 'utf8')) as ScraperConfig;
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    config.url = `http://localhost:${address.port}/agenda/`;
    const result = await runScraper(config);
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.concerts.map(({ venue, city, country, ticketUrl }) => ({ venue, city, country, ticketUrl })), [
      { venue: 'Blue Note Tokyo', city: 'Tokyo', country: 'JP', ticketUrl: 'https://www.bluenote.co.jp/jp/artists/andrea-motis/' },
      { venue: 'Blue Note Tokyo', city: 'Tokyo', country: 'JP', ticketUrl: undefined },
      { venue: 'Blue Note Milano', city: 'Milano', country: 'IT', ticketUrl: 'https://bluenotemilano.com/en/show/andrea-motis/' },
      { venue: 'Auditori Enric Granados', city: 'Lleida', country: 'ES', ticketUrl: 'https://www.raimatartsfestival.org/tienda' },
      { venue: 'Palau de la Música Catalana', city: 'Barcelona', country: 'ES', ticketUrl: 'https://www.jazz.barcelona/ca/andrea-motis-yamandu-costa' },
      { venue: 'Teatro Góngora', city: 'Córdoba', country: 'ES', ticketUrl: 'https://teatrocordoba.es/espectaculo/andrea-motis/' },
      { venue: 'Unknown Venue', city: 'Lleida', country: undefined, ticketUrl: undefined }
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
