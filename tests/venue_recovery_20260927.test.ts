import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { scrape as scrapeAkvarium } from '../src/engine/custom/akvarium-klub-budapest.js';
import { runScraper } from '../src/engine/runner.js';
import { ScraperConfigSchema, type ScraperConfig } from '../src/schemas/config.js';

const FIXTURES = 'tests/fixtures/venue-recovery-20260927';

async function loadConfig(path: string): Promise<ScraperConfig> {
  return ScraperConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

test('Akvárium accepts the abbreviated September label used by the current official page', async () => {
  const [config, html] = await Promise.all([
    loadConfig('scrapers/akvarium-klub-budapest.json'),
    readFile(`${FIXTURES}/akvarium-september-card.html`, 'utf8')
  ]);

  const concerts = await scrapeAkvarium(config, html, '2026-09-27T10:09:36.387Z');

  assert.equal(concerts.length, 2, 'abbreviated live month labels must not be discarded as unknown');
  assert.equal(concerts[0].artist, 'Beretka Ádám Nyíló virágok turné');
  assert.match(concerts[0].date ?? '', /-09-26$/);
  assert.equal(
    concerts[0].ticketUrl,
    'https://akvariumklub.hu/en/events/beretka-adam-nyilo-viragok-turne/'
  );
  assert.equal(concerts[0].country, 'HU');
  assert.equal(concerts[1].date, '2027-02-13', 'the explicit year displayed by the venue must win');
});

test('Majestic keeps its current event-card extraction inside the 90-second scraper budget', async (t) => {
  const [config, html] = await Promise.all([
    loadConfig('scrapers/majestic-music-club-bratislava.json'),
    readFile(`${FIXTURES}/majestic-event-card.html`, 'utf8')
  ]);

  const retries = config.maxRetries ?? 2;
  const attempts = retries + 1;
  const fetchBudgetMs = attempts * 15_000;
  const politenessBudgetMs = attempts * (config.requestDelayMs ?? 0);
  const exponentialBackoffCeilingMs = Array.from(
    { length: retries },
    (_, index) => Math.min(15_000, 500 * 2 ** index) + 249
  ).reduce((sum, value) => sum + value, 0);
  assert.ok(
    fetchBudgetMs + politenessBudgetMs + exponentialBackoffCeilingMs < 90_000,
    'retry policy must leave room below the runner wall-clock ceiling'
  );

  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  config.url = `http://localhost:${address.port}/program/`;

  const result = await runScraper(config);

  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 1);
  assert.equal(result.concerts[0].artist, 'OZZY FOREVER TRIBUTE TO THE LEGENDARY PRINCE OF DARKNESS');
  assert.equal(result.concerts[0].date, 'nedeľa 27.09.2026 @20:00');
  assert.equal(result.concerts[0].country, 'SK');
  assert.equal(
    result.concerts[0].ticketUrl,
    'https://majestic.sk/event-detail/6a99df46a115892b6b333249/'
  );
});
