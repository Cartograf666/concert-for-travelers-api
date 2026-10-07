import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import * as cheerio from 'cheerio';
import { ScraperConfigSchema, type ScraperConfig } from '../src/schemas/config.js';
import { runScraper, closeBrowser } from '../src/engine/runner.js';
import { scrape } from '../src/engine/custom/artist-iron-maidens-the.js';

const SCRAPED_AT = '2026-09-28T06:00:00.000Z';
const fixturePath = 'tests/fixtures/artist-iron-maidens-upcoming-20260928.html';

async function source() {
  const [html, json] = await Promise.all([
    readFile(fixturePath, 'utf8'),
    readFile('scrapers/artist-iron-maidens-the.json', 'utf8')
  ]);
  return { html, config: ScraperConfigSchema.parse(JSON.parse(json)) as ScraperConfig };
}

test('official EventON fixture yields ten verified single-day shows and holds the cruise', async () => {
  const { html, config } = await source();
  assert.equal(config.type, 'playwright_render');
  assert.equal(config.renderParser, 'custom_js');
  assert.equal(config.renderWaitSelector, '.eventon_list_event.scheduled');
  const concerts = await scrape(config, html, SCRAPED_AT);
  assert.deepEqual(concerts.map(({ date, city, venue, country, startTime }) =>
    ({ date, city, venue, country, startTime })), [
    ['2026-10-23', 'Las Vegas', 'The Brooklyn Bowl Las Vegas', undefined],
    ['2026-10-29', 'Cleveland', 'Beachland Ballroom and Tavern', undefined],
    ['2026-10-30', 'Bowling Green', 'Cla-Zel Theater', '18:00'],
    ['2026-11-05', 'Newton', 'Newton Performing Arts Center', '18:00'],
    ['2026-11-13', 'San Antonio', "Sam's Burger Joint", undefined],
    ['2026-11-14', 'Katy', 'The Wildcatter Saloon', '07:00'],
    ['2026-11-15', 'Dallas', 'AM/FM', undefined],
    ['2026-12-04', 'San Francisco', 'DNA Lounge', '18:00'],
    ['2026-12-13', 'Warrendale', 'Jergel’s Rhythm Grille', undefined],
    ['2027-04-09', 'Wisconsin Dells', 'Crystal Grand Music Theatre', '20:00']
  ].map(([date, city, venue, startTime]) => ({ date, city, venue, country: 'US', startTime })));
  assert.ok(concerts.every(c => c.artist === 'The Iron Maidens' &&
    c.originalSource === config.domain && c.scrapedAt === SCRAPED_AT &&
    c.ticketUrl?.startsWith('https://')));
  assert.deepEqual(concerts.map(c => c.ticketUrl), [
    'https://www.ticketmaster.com/the-iron-maidens-las-vegas-nevada-10-23-2026/event/170064F1AFAB0BBC',
    'https://www.beachlandballroom.com/shows/iron-maidens-29-oct#tickets',
    'https://www.etix.com/ticket/p/59618884/the-iron-maidens-bowling-green-clazel-theater',
    'https://ncauditorium.com/ironmaidens',
    'https://wl.eventim.us/event/the-iron-maidens/690560?afflky=SamsBurgerJointSanAntonio',
    'https://www.eventim.us/event/THE-IRON-MAIDENS-ALL-FEMALE-TRIBUTE-TO-IRON-MAIDEN-wVICTIM/697407?utm_id=97758_v0_s00_e0_tv2_a1demonlau0rzk&fbclid=IwY2xjawSz13BleHRuA2FlbQIxMABicmlkETF4OWpsbjlZTFV3VWhpNjRjc3J0YwZhcHBfaWQQMjIyMDM5MTc4ODIwMDg5MgABHlmNU5fiU7Bp7HrO48F_JoV5s0U2DPsOcFNu56bkc4UBTgKRPOzTASj060Fg_aem_eUvpwuBmlxCdFQDYNkoqlw',
    'https://wl.eventim.us/event/the-iron-maidens/700964?afflky=FerrisWheelers',
    'https://www.dnalounge.com/calendar/2026/12-04.html',
    'https://www.etix.com/ticket/p/39614103/the-iron-maidens-warrendale-jergels-rhythm-grille',
    'https://www.etix.com/ticket/p/77824812/queensryche-with-the-iron-maidens-wisconsin-dells-crystal-grand-music-theatre'
  ]);
});

test('configured runner dispatches to the custom parser on saved HTML', async (t) => {
  const { html, config } = await source();
  const server = createServer((_, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await closeBrowser();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await runScraper({ ...config, url: `http://127.0.0.1:${address.port}/events` });
  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 10);
  assert.equal(result.concerts[0].artist, 'The Iron Maidens');
});

test('uncertain dates, status, and changed locations cannot acquire a default US location', async () => {
  const { html, config } = await source();
  const $ = cheerio.load(html);
  const ids = ['event_2581_0', 'event_2582_0', 'event_2563_0', 'event_2583_0',
    'event_2565_0', 'event_2570_0', 'event_2585_0', 'event_2586_0', 'event_2587_0', 'event_2554_0'];
  $(`#${ids[0]} .evcal_cblock`).removeAttr('data-syr');
  $(`#${ids[1]} .evcal_cblock`).attr('data-smon', 'nonesuch');
  $(`#${ids[2]} .evo_start .date`).text('31');
  $(`#${ids[2]} .evo_start .month`).text('feb');
  $(`#${ids[2]} .evcal_cblock`).attr('data-smon', 'february'); // Invalid February 31.
  $(`#${ids[3]}`).addClass('cancelled');
  $(`#${ids[4]} .evcal_cblock`).append('<span class="evo_end"><em class="date">14</em></span>');
  $(`#${ids[5]} .evcal_desc`).attr('data-location_address', 'moved to another city');
  $(`#${ids[6]} .evcal_desc`).attr('data-location_name', 'Unknown venue');
  $(`#${ids[7]} .evcal_desc`).removeAttr('data-location_address');
  $(`#${ids[8]}`).removeClass('scheduled').addClass('postponed');
  $(`#${ids[9]} .evo_start .month`).text('may');
  assert.deepEqual(await scrape(config, $.html(), SCRAPED_AT), []);
  assert.deepEqual(await scrape({ ...config, selectors: {
    ...config.selectors!, countryNameFallback: 'DE'
  } }, $.html(), SCRAPED_AT), []);
});

test('conflicting card fields remain held and a second start time is not guessed', async () => {
  const { html, config } = await source();
  const $ = cheerio.load(html);
  $('#event_2581_0 .evcal_desc').attr('data-location_status', 'false');
  $('#event_2582_0 .evo_start').append('<em class="date">30</em>');
  $('#event_2563_0 .evo_end').append('<em class="date">31</em>');
  $('#event_2583_0 .evo_start').append('<em class="time">7:00 pm</em>');
  $('#event_2565_0').append('<span class="evcal_cblock" data-syr="2026" data-smon="november"><span class="evo_start"><em class="date">13</em><em class="month">nov</em></span></span>');
  $('#event_2570_0 .evcal_cblock').append('<span class="evo_start"><em class="date">14</em><em class="month">nov</em></span>');
  $('#event_2585_0 .evo_start .time').text('8:00 pm'); // The card still says All Day.
  const concerts = await scrape(config, $.html(), SCRAPED_AT);
  assert.equal(concerts.length, 5);
  assert.equal(concerts.find(c => c.date === '2026-11-05')?.startTime, undefined);
  assert.equal(concerts.find(c => c.date === '2026-11-15')?.startTime, undefined);
});

test('calendar validates leap days from explicit card year and month', async () => {
  const { html, config } = await source();
  const $ = cheerio.load(html);
  const block = $('#event_2581_0 .evcal_cblock');
  block.attr('data-syr', '2028').attr('data-smon', 'february');
  block.find('.evo_start .month').text('feb');
  block.find('.evo_start .date').text('29');
  assert.equal((await scrape(config, $.html(), SCRAPED_AT))[0].date, '2028-02-29');
  block.attr('data-syr', '2027');
  assert.equal((await scrape(config, $.html(), SCRAPED_AT)).length, 9);
});

test('tickets require the labelled link and an exact HTTPS vendor host', async () => {
  const { html, config } = await source();
  for (const href of [
    'javascript:alert(1)', 'data:text/html,hi', 'http://www.etix.com/event',
    'https://user@www.etix.com/event', 'https://www.etix.com:8443/event',
    'https://www.etix.com.evil.test/event', 'https://127.0.0.1/event',
    'https://metadata.google.internal/event', '/tickets/local'
  ]) {
    const $ = cheerio.load(html);
    $('#event_2581_0 a.evo_cusmeta_btn').attr('href', href);
    const result = await scrape(config, $.html(), SCRAPED_AT);
    assert.equal(result.length, 10);
    assert.equal(result[0].ticketUrl, undefined, href);
  }
  const $ = cheerio.load(html);
  $('#event_2581_0 a.evo_cusmeta_btn').text('Info');
  assert.equal((await scrape(config, $.html(), SCRAPED_AT))[0].ticketUrl, undefined);
});
