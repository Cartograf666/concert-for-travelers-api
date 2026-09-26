import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const PAGE = `
  <table><tbody>
    <tr class="tour-row">
      <td><img alt="DE"></td>
      <td><span>2026-10-14</span></td>
      <td><strong>Columbiahalle</strong><span>Berlin</span></td>
      <td><a href="/tickets/arena">Tickets</a></td>
    </tr>
    <tr class="tour-row">
      <td><img alt="GB"></td>
      <td><span>2026-10-15</span></td>
      <td><strong>Roundhouse</strong><span>London</span></td>
      <td><a href="javascript:alert(1)">Unsafe ticket</a></td>
    </tr>
  </tbody></table>`;

function config(url: string, overrides: Partial<ScraperConfig['selectors']> = {}): ScraperConfig {
  return {
    id: 'selector-attr-recovery',
    domain: 'example.test',
    url,
    type: 'static_selectors',
    selectors: {
      eventBlock: '.tour-row',
      artistNameFallback: 'Arena',
      date: 'td:nth-child(2) span',
      ticketUrl: 'td:nth-child(4) a::attr(href)',
      venue: 'td:nth-child(3) strong',
      city: 'td:nth-child(3) span',
      country: 'td:nth-child(1) img::attr(alt)',
      venueNameFallback: '',
      cityNameFallback: '',
      countryNameFallback: 'GB',
      ...overrides
    }
  };
}

test('runScraper supports terminal ::attr() in static fields without weakening ticket URL safety', async (t) => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://localhost:${address.port}/tour`;

  const result = await runScraper(config(url));

  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 2);
  assert.equal(result.concerts[0].country, 'DE');
  assert.equal(result.concerts[0].ticketUrl, `http://localhost:${address.port}/tickets/arena`);
  assert.equal(result.concerts[1].country, 'GB');
  assert.equal(result.concerts[1].ticketUrl, undefined, 'unsafe URL remains rejected after attr extraction');
});

test('runScraper keeps ordinary CSS text extraction and rejects unsupported ::attr forms', async (t) => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://localhost:${address.port}/tour`;

  const plain = await runScraper(config(url, {
    country: 'td:nth-child(1) img',
    ticketUrl: 'td:nth-child(4) a'
  }));
  assert.equal(plain.success, true);
  assert.equal(plain.concerts[0].country, 'GB', 'plain CSS still extracts text and falls back when it is empty');

  const malformed = await runScraper(config(url, { country: 'td:nth-child(1) img::attr(123)' }));
  assert.equal(malformed.success, false);
  assert.equal(malformed.reason, 'parse_error');
  assert.match(malformed.error ?? '', /Pseudo-elements are not supported|Attribute selector/);

  const malformedTicket = await runScraper(config(url, { ticketUrl: 'td:nth-child(4) a::attr(123)' }));
  assert.equal(malformedTicket.success, false);
  assert.equal(malformedTicket.reason, 'parse_error');
  assert.match(malformedTicket.error ?? '', /Pseudo-elements are not supported|Attribute selector/);
});
