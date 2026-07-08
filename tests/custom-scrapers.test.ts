import test from 'node:test';
import assert from 'node:assert';
import { ScraperConfig } from '../src/schemas/config.js';

import { scrape as a38Scrape } from '../src/engine/custom/a38-ship-budapest.js';
import { scrape as akbankScrape } from '../src/engine/custom/akbank-sanat-istanbul.js';
import { scrape as akvariumScrape } from '../src/engine/custom/akvarium-klub-budapest.js';
import { scrape as clubQuattroScrape } from '../src/engine/custom/club-quattro-umeda-osaka.js';
import { scrape as drugstoreScrape } from '../src/engine/custom/drugstore-belgrade.js';
import { scrape as flexScrape } from '../src/engine/custom/flex-vienna.js';
import { scrape as jazzCafeScrape } from '../src/engine/custom/jazz-cafe-london.js';
import { scrape as kittySuScrape } from '../src/engine/custom/kitty-su-bangalore.js';
import { scrape as kolaracScrape } from '../src/engine/custom/kolarac-concert-hall-belgrade.js';
import { scrape as komnataScrape } from '../src/engine/custom/komnata-kultury-tour.js';
import { scrape as lacigaleScrape } from '../src/engine/custom/lacigale-paris.js';
import { scrape as liquidroomScrape } from '../src/engine/custom/liquidroom-tokyo.js';
import { scrape as lucernaScrape } from '../src/engine/custom/lucerna-music-bar-prague.js';
import { scrape as meetfactoryScrape } from '../src/engine/custom/meetfactory-prague.js';
import { scrape as melkwegScrape } from '../src/engine/custom/melkweg-amsterdam.js';
import { scrape as sagresScrape } from '../src/engine/custom/sagres-campo-pequeno-lisbon.js';
import { scrape as salaApoloScrape } from '../src/engine/custom/sala-apolo-barcelona.js';
import { scrape as so36Scrape } from '../src/engine/custom/so36-berlin.js';
import { scrape as tolhuistuinScrape } from '../src/engine/custom/tolhuistuin-amsterdam.js';
import { scrape as vintazhScrape } from '../src/engine/custom/vintazh-tour.js';
import { scrape as wukScrape } from '../src/engine/custom/wuk-vienna.js';
import { scrape as wwwShibuyaScrape } from '../src/engine/custom/www-shibuya-tokyo.js';
import { scrape as zhenyaScrape } from '../src/engine/custom/zhenya-trofimov-tour.js';

const dummyConfig = (id: string, domain: string, url: string, extraSelectors = {}): ScraperConfig => ({
  id,
  domain,
  url,
  type: 'custom_js',
  selectors: {
    venueNameFallback: 'Fallback Venue',
    cityNameFallback: 'Fallback City',
    countryNameFallback: 'Fallback Country',
    ...extraSelectors
  }
});

const scrapedAt = new Date().toISOString();

test('custom/a38-ship-budapest.ts', async (t) => {
  await t.test('parses events and filters hot spots', async () => {
    const html = `
      <html>
        <body>
          <a class="eventCard" href="/events/artist-one">
            <div class="eventCard__details__title">Artist One</div>
            <meta itemprop="startDate" content="2026-07-15T20:00:00" />
          </a>
          <a class="eventCard" href="/events/hot-spot">
            <div class="eventCard__details__title">hot spot</div>
            <meta itemprop="startDate" content="2026-07-16T20:00:00" />
          </a>
        </body>
      </html>
    `;
    const config = dummyConfig('a38', 'www.a38.hu', 'https://www.a38.hu/en');
    const result = await a38Scrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Artist One');
    assert.strictEqual(result[0].date, '2026-07-15');
    assert.strictEqual(result[0].ticketUrl, 'https://www.a38.hu/events/artist-one');
  });

  await t.test('edge case - empty/malformed meta', async () => {
    const html = `
      <a class="eventCard" href="/events/no-date">
        <div class="eventCard__details__title">Artist Two</div>
      </a>
    `;
    const config = dummyConfig('a38', 'www.a38.hu', 'https://www.a38.hu/en');
    const result = await a38Scrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/akbank-sanat-istanbul.ts', async (t) => {
  await t.test('parses data-category and traces parent data-day', async () => {
    const html = `
      <html>
        <body>
          <select id="cf-year">
            <option value="2026" selected>2026</option>
          </select>
          <div data-day="15.07">
            <div>
              <div data-category="music">
                <p>Jazz Event</p>
                <p><span>Performers:</span> <span>Jazzy Quartet</span></p>
                <p class="hour">20:00</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
    const config = dummyConfig('akbank', 'www.akbanksanat.com', 'https://www.akbanksanat.com');
    const result = await akbankScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Jazzy Quartet');
    assert.strictEqual(result[0].date, '15.07.2026 20:00');
  });

  await t.test('edge case - no date parent attribute', async () => {
    const html = `
      <div data-category="music">
        <p>No Date Event</p>
        <p><span>Performers:</span> <span>Lonely Guitarist</span></p>
      </div>
    `;
    const config = dummyConfig('akbank', 'www.akbanksanat.com', 'https://www.akbanksanat.com');
    const result = await akbankScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/akvarium-klub-budapest.ts', async (t) => {
  await t.test('parses grid items and maps English month names', async () => {
    const html = `
      <a class="grid-item m-card" href="/event/cool-show">
        <div class="m-card__description">
          <div class="h5">Cool Band</div>
        </div>
        <span class="date__month">October.</span>
        <span class="date__day">15.</span>
      </a>
    `;
    const config = dummyConfig('akvarium', 'akvariumklub.hu', 'https://akvariumklub.hu');
    const result = await akvariumScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Cool Band');
    assert.match(result[0].date || '', /-10-15$/);
    assert.strictEqual(result[0].ticketUrl, 'https://akvariumklub.hu/event/cool-show');
  });

  await t.test('edge case - invalid month name', async () => {
    const html = `
      <a class="grid-item m-card" href="/event/show2">
        <div class="m-card__description">
          <div class="h5">Wrong Month</div>
        </div>
        <span class="date__month">NotAMonth</span>
        <span class="date__day">15</span>
      </a>
    `;
    const config = dummyConfig('akvarium', 'akvariumklub.hu', 'https://akvariumklub.hu');
    const result = await akvariumScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/club-quattro-umeda-osaka.ts', async (t) => {
  await t.test('parses list items', async () => {
    const html = `
      <li class="list-item" data-event-date="2026-08-20">
        <p class="txt-01"><span class="hv-elm">Haru Nemuri</span></p>
        <a class="event-box" href="/tickets/haru">Details</a>
      </li>
    `;
    const config = dummyConfig('club-quattro', 'www.club-quattro.com', 'https://www.club-quattro.com/umeda');
    const result = await clubQuattroScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Haru Nemuri');
    assert.strictEqual(result[0].date, '2026-08-20');
    assert.strictEqual(result[0].ticketUrl, 'https://www.club-quattro.com/tickets/haru');
  });

  await t.test('edge case - missing date attribute', async () => {
    const html = `
      <li class="list-item">
        <p class="txt-01"><span class="hv-elm">No Date</span></p>
      </li>
    `;
    const config = dummyConfig('club-quattro', 'www.club-quattro.com', 'https://www.club-quattro.com/umeda');
    const result = await clubQuattroScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/drugstore-belgrade.ts', async (t) => {
  await t.test('parses title link and removes span to clean artist', async () => {
    const html = `
      <h2 class="entry-title">
        <a href="/hardcore-v">
          <span>19/09/2026</span>
          XAOC INDOOR HARDCORE VOL. V
        </a>
      </h2>
    `;
    const config = dummyConfig('drugstore', 'drugstore-belgrade.com', 'https://drugstore-belgrade.com');
    const result = await drugstoreScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'XAOC INDOOR HARDCORE VOL. V');
    assert.strictEqual(result[0].date, '19/09/2026');
    assert.strictEqual(result[0].ticketUrl, 'https://drugstore-belgrade.com/hardcore-v');
  });

  await t.test('edge case - missing date span', async () => {
    const html = `
      <h2 class="entry-title">
        <a href="/hardcore-v">XAOC INDOOR HARDCORE</a>
      </h2>
    `;
    const config = dummyConfig('drugstore', 'drugstore-belgrade.com', 'https://drugstore-belgrade.com');
    const result = await drugstoreScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/flex-vienna.ts', async (t) => {
  await t.test('parses events and extracts German month names', async () => {
    const html = `
      <div class="ewpe-inner-wrapper">
        <a class="event-link" href="/event/techno-night">
          <div class="ewpe-event-title">Techno Night</div>
        </a>
        <div class="ewpe-events-schedule">12. oktober</div>
      </div>
    `;
    const config = dummyConfig('flex-vienna', 'flex.at', 'https://flex.at');
    const result = await flexScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Techno Night');
    assert.match(result[0].date || '', /-10-12$/);
    assert.strictEqual(result[0].ticketUrl, 'https://flex.at/event/techno-night');
  });

  await t.test('edge case - invalid schedule string', async () => {
    const html = `
      <div class="ewpe-inner-wrapper">
        <div class="ewpe-event-title">Invalid Schedule</div>
        <div class="ewpe-events-schedule">tuesday evening</div>
      </div>
    `;
    const config = dummyConfig('flex-vienna', 'flex.at', 'https://flex.at');
    const result = await flexScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/jazz-cafe-london.ts', async (t) => {
  await t.test('parses events, replaces internal spans, filters soul city', async () => {
    const html = `
      <li class="event">
        <h2 class="event-title">Yussef Dayes</h2>
        <div class="event-date">Tue<span>07</span>Jul</div>
        <a href="/tickets-yussef">Tickets</a>
      </li>
      <li class="event">
        <h2 class="event-title">soul city</h2>
        <div class="event-date">Wed<span>08</span>Jul</div>
      </li>
    `;
    const config = dummyConfig('jazz-cafe', 'thejazzcafelondon.com', 'https://thejazzcafelondon.com');
    const result = await jazzCafeScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Yussef Dayes');
    assert.strictEqual(result[0].date, 'Tue 07 Jul');
    assert.strictEqual(result[0].ticketUrl, 'https://thejazzcafelondon.com/tickets-yussef');
  });

  await t.test('edge case - missing date', async () => {
    const html = `
      <li class="event">
        <h2 class="event-title">Yussef Dayes</h2>
      </li>
    `;
    const config = dummyConfig('jazz-cafe', 'thejazzcafelondon.com', 'https://thejazzcafelondon.com');
    const result = await jazzCafeScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/kitty-su-bangalore.ts', async (t) => {
  await t.test('parses bangalore events and maps details', async () => {
    const html = `
      <ul class="event-list">
        <li>
          <div class="event-list-img">
            <a href="/event-slug">Flyer</a>
          </div>
          <div class="event-list-text">
            <h3>Girish and The Chronicles | Bangalore</h3>
            <p>Bangalore | India | 12 July - 13 July | 08:30 PM</p>
          </div>
        </li>
        <li>
          <div class="event-list-text">
            <h3>Delhi Event | Delhi</h3>
            <p>Delhi | India | 15 July | 09:00 PM</p>
          </div>
        </li>
      </ul>
    `;
    const config = dummyConfig('kitty-su', 'www.kittysu.com', 'https://www.kittysu.com/bangalore');
    const result = await kittySuScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Girish and The Chronicles');
    assert.match(result[0].date || '', /^12 July/);
    assert.strictEqual(result[0].ticketUrl, 'https://www.kittysu.com/event-slug');
  });

  await t.test('edge case - malformed pText split', async () => {
    const html = `
      <ul class="event-list">
        <li>
          <div class="event-list-text">
            <h3>Girish | Bangalore</h3>
            <p>Short String</p>
          </div>
        </li>
      </ul>
    `;
    const config = dummyConfig('kitty-su', 'www.kittysu.com', 'https://www.kittysu.com/bangalore');
    const result = await kittySuScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/kolarac-concert-hall-belgrade.ts', async (t) => {
  await t.test('parses title attribute split by DATE_RE', async () => {
    const html = `
      <article class="post">
        <h3 class="entry-title">
          <a title="Belgrade Philharmonic Orchestra8 June 2026 at 18Music Gallery" href="/post1">Link</a>
        </h3>
      </article>
    `;
    const config = dummyConfig('kolarac', 'kolarac.rs', 'https://kolarac.rs');
    const result = await kolaracScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Belgrade Philharmonic Orchestra');
    assert.strictEqual(result[0].date, '8 June 2026 at 18');
    assert.strictEqual(result[0].ticketUrl, 'https://kolarac.rs/post1');
  });

  await t.test('edge case - no regex match', async () => {
    const html = `
      <article class="post">
        <h3 class="entry-title">
          <a title="No Date Event Title" href="/post1">Link</a>
        </h3>
      </article>
    `;
    const config = dummyConfig('kolarac', 'kolarac.rs', 'https://kolarac.rs');
    const result = await kolaracScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/komnata-kultury-tour.ts (delegates to zhenya-trofimov-tour)', async (t) => {
  await t.test('parses tilda blocks', async () => {
    const html = `
      <div class="t-rec">
        <div class="tn-elem" data-elem-id="1709639269253">15.07.2026</div>
        <div class="tn-elem" data-elem-id="1709639269261">Алматы, Казахстан</div>
        <div class="tn-elem" data-elem-id="1709639269247">TBA Club</div>
        <div class="tn-elem" data-elem-type="button">
          <a href="https://example.com/almaty-tix">Buy</a>
        </div>
      </div>
    `;
    const config = dummyConfig('komnata-kultury', 'komnatakultury.ru', 'https://komnatakultury.ru');
    const result = await komnataScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Комната культуры');
    assert.strictEqual(result[0].date, '15.07.2026');
    assert.strictEqual(result[0].city, 'Алматы');
    assert.strictEqual(result[0].country, 'KZ');
    assert.strictEqual(result[0].ticketUrl, 'https://example.com/almaty-tix');
  });

  await t.test('edge case - missing date', async () => {
    const html = `
      <div class="t-rec">
        <div class="tn-elem" data-elem-id="1709639269261">Москва</div>
      </div>
    `;
    const config = dummyConfig('komnata-kultury', 'komnatakultury.ru', 'https://komnatakultury.ru');
    const result = await komnataScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/lacigale-paris.ts', async (t) => {
  await t.test('parses event items with data-date', async () => {
    const html = `
      <li class="artiste-event__item" data-date="20260905">
        <h3 class="artiste-event__title">Chassol</h3>
        <a class="artiste-event__link" href="/chassol">Tickets</a>
      </li>
    `;
    const config = dummyConfig('lacigale', 'lacigale.fr', 'https://lacigale.fr/en');
    const result = await lacigaleScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Chassol');
    assert.strictEqual(result[0].date, '2026-09-05');
    assert.strictEqual(result[0].ticketUrl, 'https://lacigale.fr/chassol');
  });

  await t.test('edge case - incorrect data-date length', async () => {
    const html = `
      <li class="artiste-event__item" data-date="202609">
        <h3 class="artiste-event__title">Short Date</h3>
      </li>
    `;
    const config = dummyConfig('lacigale', 'lacigale.fr', 'https://lacigale.fr/en');
    const result = await lacigaleScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/liquidroom-tokyo.ts', async (t) => {
  await t.test('extracts date from s_link href suffix', async () => {
    const html = `
      <article>
        <h2>Boris</h2>
        <a class="s_link" href="/schedule/boris_20261015/">Link</a>
      </article>
    `;
    const config = dummyConfig('liquidroom', 'liquidroom.net', 'https://www.liquidroom.net');
    const result = await liquidroomScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Boris');
    assert.strictEqual(result[0].date, '2026-10-15');
    assert.strictEqual(result[0].ticketUrl, 'https://www.liquidroom.net/schedule/boris_20261015/');
  });

  await t.test('edge case - no date suffix pattern', async () => {
    const html = `
      <article>
        <h2>Boris</h2>
        <a class="s_link" href="/schedule/boris/">Link</a>
      </article>
    `;
    const config = dummyConfig('liquidroom', 'liquidroom.net', 'https://www.liquidroom.net');
    const result = await liquidroomScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/lucerna-music-bar-prague.ts', async (t) => {
  await t.test('parses timestamp and filters video party', async () => {
    const html = `
      <a class="program-item" href="/event/parcels">
        <p>Parcels</p>
        <div class="timestamp">18.11.2026</div>
      </a>
      <a class="program-item" href="/event/video">
        <p>Friday Video Party</p>
        <div class="timestamp">20.11.2026</div>
      </a>
    `;
    const config = dummyConfig('lucerna', 'musicbar.cz', 'https://musicbar.cz/en');
    const result = await lucernaScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Parcels');
    assert.strictEqual(result[0].date, '2026-11-18');
    assert.strictEqual(result[0].ticketUrl, 'https://musicbar.cz/event/parcels');
  });

  await t.test('edge case - no timestamp matched', async () => {
    const html = `
      <a class="program-item" href="/event/parcels">
        <p>Parcels</p>
        <div>No Timestamp</div>
      </a>
    `;
    const config = dummyConfig('lucerna', 'musicbar.cz', 'https://musicbar.cz/en');
    const result = await lucernaScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/meetfactory-prague.ts', async (t) => {
  await t.test('parses events and meta tags', async () => {
    const html = `
      <div class="action-boxes">
        <div itemscope itemtype="http://schema.org/Event">
          <div class="abb-text">
            <h3><span itemprop="name">Alcest</span></h3>
          </div>
          <meta itemprop="startDate" content="2026-11-25T20:00:00" />
          <a class="abbl-detail" href="/alcest">Link</a>
        </div>
      </div>
    `;
    const config = dummyConfig('meetfactory', 'meetfactory.cz', 'https://www.meetfactory.cz/en');
    const result = await meetfactoryScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Alcest');
    assert.strictEqual(result[0].date, '2026-11-25');
    assert.strictEqual(result[0].ticketUrl, 'https://www.meetfactory.cz/alcest');
  });

  await t.test('edge case - missing meta tag content', async () => {
    const html = `
      <div class="action-boxes">
        <div itemscope itemtype="http://schema.org/Event">
          <div class="abb-text">
            <h3><span itemprop="name">Alcest</span></h3>
          </div>
        </div>
      </div>
    `;
    const config = dummyConfig('meetfactory', 'meetfactory.cz', 'https://www.meetfactory.cz/en');
    const result = await meetfactoryScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/melkweg-amsterdam.ts', async (t) => {
  await t.test('parses __NEXT_DATA__ block from HTML', async () => {
    const nextData = {
      props: {
        pageProps: {
          pageData: {
            attributes: {
              content: [
                {
                  attributes: {
                    layout: 'agenda',
                    initialEvents: [
                      {
                        attributes: {
                          name: 'Dry Cleaning',
                          startDate: '2026-07-20T20:30:00Z',
                          url: '/agenda/dry-cleaning'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    };
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
    const config = dummyConfig('melkweg', 'www.melkweg.nl', 'https://www.melkweg.nl/en');
    const result = await melkwegScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Dry Cleaning');
    assert.strictEqual(result[0].date, '2026-07-20T20:30:00Z');
    assert.strictEqual(result[0].ticketUrl, 'https://www.melkweg.nl/agenda/dry-cleaning');
  });

  await t.test('edge case - no script tag', async () => {
    const html = `<html><body>No Data</body></html>`;
    const config = dummyConfig('melkweg', 'www.melkweg.nl', 'https://www.melkweg.nl/en');
    await assert.rejects(
      async () => melkwegScrape(config, html, scrapedAt),
      /Could not find __NEXT_DATA__ script tag/
    );
  });
});

test('custom/sagres-campo-pequeno-lisbon.ts', async (t) => {
  await t.test('parses MM.DD.YYYY as YYYY-MM-DD', async () => {
    const html = `
      <div class="event">
        <div class="card-title">Mariza</div>
        <div class="date">09.17.2026</div>
        <a href="/mariza">Link</a>
      </div>
    `;
    const config = dummyConfig('sagres', 'sagrescampopequeno.pt', 'https://sagrescampopequeno.pt');
    const result = await sagresScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Mariza');
    assert.strictEqual(result[0].date, '2026-09-17');
    assert.strictEqual(result[0].ticketUrl, 'https://sagrescampopequeno.pt/mariza');
  });

  await t.test('edge case - invalid date format', async () => {
    const html = `
      <div class="event">
        <div class="card-title">Mariza</div>
        <div class="date">17.09.26</div>
      </div>
    `;
    const config = dummyConfig('sagres', 'sagrescampopequeno.pt', 'https://sagrescampopequeno.pt');
    const result = await sagresScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/sala-apolo-barcelona.ts', async (t) => {
  await t.test('extracts date from event URL', async () => {
    const html = `
      <div class="c-results__event">
        <a class="c-results__event__title" href="/es/evento/idles-20260707-1234">Idles</a>
      </div>
    `;
    const config = dummyConfig('apolo', 'sala-apolo.com', 'https://www.sala-apolo.com');
    const result = await salaApoloScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Idles');
    assert.strictEqual(result[0].date, '2026-07-07');
    assert.strictEqual(result[0].ticketUrl, 'https://www.sala-apolo.com/es/evento/idles-20260707-1234');
  });

  await t.test('edge case - URL missing date pattern', async () => {
    const html = `
      <div class="c-results__event">
        <a class="c-results__event__title" href="/es/evento/idles">Idles</a>
      </div>
    `;
    const config = dummyConfig('apolo', 'sala-apolo.com', 'https://www.sala-apolo.com');
    const result = await salaApoloScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/so36-berlin.ts', async (t) => {
  await t.test('parses products and filters concerts', async () => {
    const data = {
      products: [
        {
          supertitle: 'Konzert',
          title: 'Idles',
          valid_start_on: '2026-08-10',
          url: '/tickets/idles'
        },
        {
          supertitle: 'Party',
          title: '80s Disco',
          valid_start_on: '2026-08-11',
          url: '/tickets/80s'
        }
      ]
    };
    const jsonStr = JSON.stringify(data);
    const config = dummyConfig('so36', 'so36.de', 'https://so36.de');
    const result = await so36Scrape(config, jsonStr, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Idles');
    assert.strictEqual(result[0].date, '2026-08-10');
    assert.strictEqual(result[0].ticketUrl, 'https://so36.de/tickets/idles');
  });

  await t.test('edge case - empty products list', async () => {
    const config = dummyConfig('so36', 'so36.de', 'https://so36.de');
    const result = await so36Scrape(config, JSON.stringify({ products: [] }), scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/tolhuistuin-amsterdam.ts', async (t) => {
  await t.test('parses agenda-filter-component all-items attribute', async () => {
    const items = [
      {
        title: 'BCNR',
        eventStartDate: '2026-09-15',
        eventType: { label: 'Muziek', value: 'muziekPerformance' },
        ticketLink: '/tickets/bcnr'
      },
      {
        title: 'Poetry',
        eventStartDate: '2026-09-16',
        eventType: { label: 'Poetry', value: 'poetry' }
      }
    ];
    const html = `<agenda-filter-component :all-items='${JSON.stringify(items)}'></agenda-filter-component>`;
    const config = dummyConfig('tolhuistuin', 'tolhuistuin.nl', 'https://www.tolhuistuin.nl');
    const result = await tolhuistuinScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'BCNR');
    assert.strictEqual(result[0].date, '2026-09-15');
    assert.strictEqual(result[0].ticketUrl, 'https://www.tolhuistuin.nl/tickets/bcnr');
  });

  await t.test('edge case - missing attribute', async () => {
    const html = `<agenda-filter-component></agenda-filter-component>`;
    const config = dummyConfig('tolhuistuin', 'tolhuistuin.nl', 'https://www.tolhuistuin.nl');
    await assert.rejects(
      async () => tolhuistuinScrape(config, html, scrapedAt),
      /Could not find :all-items attribute/
    );
  });
});

test('custom/vintazh-tour.ts', async (t) => {
  await t.test('parses Tilda absolute layout columns', async () => {
    const html = `
      <div class="t396__artboard">
        <span>АФИША</span>
        <!-- Col A -->
        <div class="tn-elem" data-elem-id="date1" data-elem-type="text" data-field-top-value="100" data-field-left-value="100">15.07</div>
        <div class="tn-elem" data-elem-id="loc1" data-elem-type="text" data-field-top-value="120" data-field-left-value="120">МОСКВА, СТАДИУМ</div>
        <div class="tn-elem" data-elem-id="btn1" data-elem-type="button" data-field-top-value="110" data-field-left-value="200">
          <a href="https://example.com/vintazh-moscow">Tickets</a>
        </div>
        
        <!-- Col B -->
        <div class="tn-elem" data-elem-id="date2" data-elem-type="text" data-field-top-value="200" data-field-left-value="600">20.07</div>
        <div class="tn-elem" data-elem-id="loc2" data-elem-type="text" data-field-top-value="210" data-field-left-value="620">Турция, kemer Club Aqua</div>
      </div>
    `;
    const config = dummyConfig('vintazh', 'vintage-play.ru', 'https://vintage-play.ru');
    const result = await vintazhScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 2);
    
    // Check Moscow event
    assert.strictEqual(result[0].artist, 'Винтаж');
    assert.strictEqual(result[0].date, '15.07');
    assert.strictEqual(result[0].city, 'Москва');
    assert.strictEqual(result[0].venue, 'СТАДИУМ');
    assert.strictEqual(result[0].country, 'RU');
    assert.strictEqual(result[0].ticketUrl, 'https://example.com/vintazh-moscow');

    // Check Turkey event
    assert.strictEqual(result[1].city, 'Kemer');
    assert.strictEqual(result[1].country, 'TR');
  });

  await t.test('edge case - missing artboard', async () => {
    const html = `<div>No Artboard</div>`;
    const config = dummyConfig('vintazh', 'vintage-play.ru', 'https://vintage-play.ru');
    await assert.rejects(
      async () => vintazhScrape(config, html, scrapedAt),
      /Could not find Tilda artboard/
    );
  });
});

test('custom/wuk-vienna.ts', async (t) => {
  await t.test('parses event items', async () => {
    const html = `
      <div class="event-list-item">
        <h2><a href="/events/wuk-show">Weyes Blood</a></h2>
        <div class="event-list-item-meta-info">18.10.2026</div>
      </div>
    `;
    const config = dummyConfig('wuk', 'wuk.at', 'https://wuk.at/en');
    const result = await wukScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Weyes Blood');
    assert.strictEqual(result[0].date, '2026-10-18');
    assert.strictEqual(result[0].ticketUrl, 'https://wuk.at/events/wuk-show');
  });

  await t.test('edge case - no date matched', async () => {
    const html = `
      <div class="event-list-item">
        <h2><a href="/events/wuk-show">Weyes Blood</a></h2>
        <div class="event-list-item-meta-info">October afternoon</div>
      </div>
    `;
    const config = dummyConfig('wuk', 'wuk.at', 'https://wuk.at/en');
    const result = await wukScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});

test('custom/www-shibuya-tokyo.ts', async (t) => {
  await t.test('infers year/month and parses days', async () => {
    const html = `
      <div class="pagination">
        <a class="pageLink" href="/schedule/202608.php">Next Month</a>
      </div>
      <div id="eventList">
        <article class="column">
          <h3 class="title">Otoboke Beaver</h3>
          <div class="date">
            <span class="day">15</span>
          </div>
          <a class="pageLink" href="/events/otoboke">Details</a>
        </article>
      </div>
    `;
    const config = dummyConfig('www-shibuya', 'www-shibuya.jp', 'https://www.www-shibuya.jp');
    const result = await wwwShibuyaScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Otoboke Beaver');
    assert.strictEqual(result[0].date, '2026-07-15');
    assert.strictEqual(result[0].ticketUrl, 'https://www.www-shibuya.jp/events/otoboke');
  });

  await t.test('edge case - missing pagination links', async () => {
    const html = `
      <div id="eventList">
        <article class="column">
          <h3 class="title">Otoboke Beaver</h3>
          <div class="date"><span class="day">15</span></div>
        </article>
      </div>
    `;
    const config = dummyConfig('www-shibuya', 'www-shibuya.jp', 'https://www.www-shibuya.jp');
    await assert.rejects(
      async () => wwwShibuyaScrape(config, html, scrapedAt),
      /Could not infer WWW schedule year\/month/
    );
  });
});

test('custom/zhenya-trofimov-tour.ts', async (t) => {
  await t.test('parses Tilda blocks and handles Belarus country mapping', async () => {
    const html = `
      <div class="t-rec">
        <div class="tn-elem" data-elem-id="1709639269253">25.08.2026</div>
        <div class="tn-elem" data-elem-id="1709639269261">Минск, Беларусь</div>
        <div class="tn-elem" data-elem-id="1709639269247">Prime Hall</div>
        <div class="tn-elem" data-elem-type="button">
          <a href="https://example.com/minsk-tix">Tickets</a>
        </div>
      </div>
    `;
    const config = dummyConfig('zhenya', 'zhenyatrofimov.ru', 'https://zhenyatrofimov.ru', { artistNameFallback: 'Zhenya Trofimov' });
    const result = await zhenyaScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].artist, 'Zhenya Trofimov');
    assert.strictEqual(result[0].date, '25.08.2026');
    assert.strictEqual(result[0].city, 'Минск');
    assert.strictEqual(result[0].country, 'BY');
    assert.strictEqual(result[0].ticketUrl, 'https://example.com/minsk-tix');
  });

  await t.test('edge case - empty/missing element', async () => {
    const html = `
      <div class="t-rec">
        <div class="tn-elem" data-elem-id="1709639269261">Москва</div>
      </div>
    `;
    const config = dummyConfig('zhenya', 'zhenyatrofimov.ru', 'https://zhenyatrofimov.ru');
    const result = await zhenyaScrape(config, html, scrapedAt);
    assert.strictEqual(result.length, 0);
  });
});
