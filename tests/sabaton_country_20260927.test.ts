import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runScraper } from '../src/engine/runner.js';
import { normalizeCountry } from '../src/pipeline/process.js';
import { scrape } from '../src/engine/custom/artist-sabaton.js';

// Minimized from the official tour-page row inspected on 2026-09-27.
const html = `<div class="tour-wrapper"><table><tr>
<td><span class="tour-date">6 Dec<span>2026</span></span></td>
<td><span class="tour-location"><span class="tour-country-city"><img src="/flags/united-states.svg" />United States,&nbsp;<span class="tour-city">National Harbor, MD</span></span><span class="tour-venue">The Theater at MGM National Harbor</span></span></td>
<td><span class="tour-tickets"><a class="btn-primary" href="/tickets">Tickets</a></span></td>
</tr></table></div>`;

test('Sabaton separates country text from the nested city/state before normalization', async (t) => {
  const server = createServer((_, response) => response.end(html));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = JSON.parse(await readFile('scrapers/artist-sabaton.json', 'utf8'));
  config.url = `http://127.0.0.1:${address.port}/tour/`;
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 1);
  const event = result.concerts[0];
  assert.equal(event.country, 'United States');
  assert.equal(normalizeCountry(event.country!), 'US');
  assert.equal(event.city, 'National Harbor, MD');
  assert.equal(event.venue, 'The Theater at MGM National Harbor');
  assert.equal(event.date, '6 Dec2026');
  assert.equal(event.artist, 'Sabaton');
});

test('Sabaton does not use its Swedish fallback for a row with no country label', async () => {
  const config = JSON.parse(await readFile('scrapers/artist-sabaton.json', 'utf8'));
  const events = await scrape(config, html.replace('United States,&nbsp;', ''), '2026-09-27T00:00:00Z');
  assert.deepEqual(events, []);
});
