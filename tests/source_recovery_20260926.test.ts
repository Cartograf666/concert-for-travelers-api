import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { scrape as scrapeA38 } from '../src/engine/custom/a38-ship-budapest.js';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const A38_PAGE = `
  <main>
    <div class="program-row flex" itemscope itemtype="http://schema.org/MusicEvent">
      <meta itemprop="url" content="/en/program/new-band" />
      <meta itemprop="startDate" content="2026-10-03T19:00:01+02:00" />
      <p class="program-title" itemprop="name">New Band</p>
    </div>
    <div class="program-row program-canceled" itemscope itemtype="http://schema.org/MusicEvent">
      <meta itemprop="url" content="/en/program/cancelled-band" />
      <meta itemprop="startDate" content="2026-10-04T19:00:01+02:00" />
      <p class="program-title" itemprop="name">Cancelled Band</p>
    </div>
    <div class="program-row" itemscope itemtype="http://schema.org/MusicEvent">
      <meta itemprop="url" content="/en/program/hot-spot" />
      <meta itemprop="startDate" content="2026-10-05T19:00:01+02:00" />
      <p class="program-title" itemprop="name">HØT SPØT Every Wednesday</p>
    </div>
    <a class="eventCard" href="/events/legacy-band">
      <div class="eventCard__details__title">Legacy Band</div>
      <meta itemprop="startDate" content="2026-10-06T20:00:00+02:00" />
    </a>
  </main>`;

const GRANDWEST_PAGE = `
  <main>
    <a href="/grandwest/events/new-band">
      <div data-testid="molecule-offer-card" class="OfferCard_offer-card__ZDBso">
        <div class="OfferCard_offer-card__content__anZos">
          <p class="Typography_typography__xwIyr OfferCard_offer-card__title__xdp2U">New Band</p>
          <p class="Typography_typography__xwIyr OfferCard_offer-card__date__cCMa_">17 October 2026</p>
        </div>
      </div>
    </a>
    <a href="/grandwest/events/future-band">
      <div data-testid="molecule-offer-card" class="OfferCard_offer-card__ZDBso">
        <div class="OfferCard_offer-card__content__anZos">
          <p class="Typography_typography__xwIyr OfferCard_offer-card__title__xdp2U">Future Band</p>
          <p class="Typography_typography__xwIyr OfferCard_offer-card__date__cCMa_">16 January 2027</p>
        </div>
      </div>
    </a>
  </main>`;

test('A38 recovers the current program-row markup, excludes cancelled/house-series rows, and keeps legacy cards', async () => {
  const config = JSON.parse(await readFile('scrapers/a38-ship-budapest.json', 'utf8')) as ScraperConfig;
  const concerts = await scrapeA38(config, A38_PAGE, '2026-09-26T06:00:00.000Z');

  assert.deepEqual(concerts.map((concert) => concert.artist), ['New Band', 'Legacy Band']);
  assert.equal(concerts[0].date, '2026-10-03');
  assert.equal(concerts[0].ticketUrl, 'https://www.a38.hu/en/program/new-band');
  assert.equal(concerts[1].ticketUrl, 'https://www.a38.hu/events/legacy-band');
});

test('GrandWest production config parses the current server-rendered cards without inventing years', async (t) => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(GRANDWEST_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const config = JSON.parse(await readFile('scrapers/grandwest-arena-cape-town.json', 'utf8')) as ScraperConfig;
  config.url = `http://localhost:${address.port}/grandwest/events`;
  const result = await runScraper(config);

  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 2);
  assert.deepEqual(result.concerts.map((concert) => concert.artist), ['New Band', 'Future Band']);
  assert.deepEqual(result.concerts.map((concert) => concert.date), ['17 October 2026', '16 January 2027']);
  assert.equal(result.concerts[0].ticketUrl, `http://localhost:${address.port}/grandwest/events/new-band`);
  assert.equal(result.concerts[0].country, 'ZA');
});
