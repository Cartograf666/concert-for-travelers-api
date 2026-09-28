import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import { scrape } from '../src/engine/custom/artist-showaddywaddy.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const clocks = ['2026-09-27T15:01:41.892Z', '2026-09-28T00:39:44.219Z'];
const verifiedLocations = [
  ['Drogheda - Tommy Leddy Theatre (TLT)', 'Drogheda', 'Tommy Leddy Theatre (TLT)', 'IE'],
  ['Letterkenny - Mount Errigal', 'Letterkenny', 'Mount Errigal Hotel', 'IE'],
  ['Dublin - The Helix', 'Dublin', 'The Helix', 'IE'],
  ['Castlebar - TF Royal', 'Castlebar', 'TF Royal Theatre', 'IE'],
  ['Dragsmervej, Denmark - Fuglsocentrel', 'Knebel', 'Hotel Fuglsøcentret', 'DK'],
  ['Wakefield - WX (Wakefield Exchange)', 'Wakefield', 'WX (Wakefield Exchange)', 'GB'],
  ['Whitley Bay - Playhouse', 'Whitley Bay', 'Playhouse', 'GB'],
  ['Holmfirth - Picturedrome', 'Holmfirth', 'Picturedrome', 'GB'],
  ['Derby - Vaillant Live', 'Derby', 'Vaillant Live', 'GB'],
  ['Exeter - Corn Exchange', 'Exeter', 'Corn Exchange', 'GB'],
  ['Aberdeen - Tivoli Theatre', 'Aberdeen', 'Tivoli Theatre', 'GB'],
  ['Dunfermline - Alhambra', 'Dunfermline', 'Alhambra', 'GB'],
  ['Port Talbot - Princess Royal Theatre', 'Port Talbot', 'Princess Royal Theatre', 'GB']
] as const;

async function config(): Promise<ScraperConfig> {
  return JSON.parse(await readFile('scrapers/artists/artist-showaddywaddy.json', 'utf8')) as ScraperConfig;
}

function row(date: string, place = 'Port Talbot - Princess Royal Theatre', href?: string): string {
  return `<tr class="tableBuilderRow"><td class="tableBuilderCell1">${date}</td>` +
    `<td class="tableBuilderCell2">${place}</td><td class="tableBuilderCell3">` +
    (href ? `<a href="${href}">Tickets</a>` : '') + '</td></tr>';
}

function heading(text: string, extra = ''): string {
  return `<tr class="tableBuilderRow uniqueStyleRow"><td class="tableBuilderCell1">${text}</td>` +
    `<td class="tableBuilderCell2">${extra}</td></tr>`;
}

function table(...rows: string[]): string {
  return `<table class="tableBuilder"><tbody>${rows.join('')}</tbody></table>`;
}

test('official table uses heading years and survives both strict processing clocks', async (t) => {
  const html = await readFile('tests/fixtures/artist-showaddywaddy-gigs.html', 'utf8');
  const cfg = await config();
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(cfg);
  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 113, '115 official rows less a weekday conflict and the Castlebar hold');
  assert.equal(result.concerts.filter(c => c.country !== undefined).length, 21);
  assert.equal(result.concerts.filter(c => c.country === undefined).length, 92);
  assert.equal(result.concerts.some(c => c.city === 'Castlebar'), false,
    'the dated Castlebar provider conflict remains held');
  assert.equal(result.concerts.filter(c => c.ticketUrl !== undefined).length, 0,
    'the current configured ticket selector must retain its omission behavior');
  assert.equal(result.concerts.some(c => c.venue === 'Sevenoaks - The Stag' && c.date === '2027-09-24'), false);
  const portTalbot = result.concerts.find(c => c.venue === 'Princess Royal Theatre');
  assert.deepEqual(portTalbot && {
    artist: portTalbot.artist, date: portTalbot.date, venue: portTalbot.venue,
    city: portTalbot.city, country: portTalbot.country, ticketUrl: portTalbot.ticketUrl,
    originalSource: portTalbot.originalSource
  }, {
    artist: 'Showaddywaddy', date: '2027-11-27',
    venue: 'Princess Royal Theatre', city: 'Port Talbot',
    country: 'GB', ticketUrl: undefined, originalSource: cfg.domain
  });
  const afternoon = result.concerts.find(c => c.venue === 'Glenrothes - CISWO');
  assert.equal(afternoon?.date, '2027-02-14');
  assert.equal(afternoon?.startTime, undefined);
  const dir = await mkdtemp(path.join(tmpdir(), 'showaddywaddy-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const approved = path.join(dir, 'artists.json');
  await writeFile(approved, JSON.stringify([{ name: 'Showaddywaddy' }]));
  for (const clock of clocks) {
    const processed = await processConcerts(result.concerts, approved, clock);
    assert.equal(processed.length, 21);
    assert.equal(processed.find(c => c.venue === 'Princess Royal Theatre')?.date, '2027-11-27');
  }
});

test('month context is explicit, unambiguous and isolated per table', async () => {
  const html = table(
    row('Sat 27h'), heading('November 2027'), row('Sat 27h'),
    heading('November 2027 / December 2027'), row('Sat 27h'),
    heading('Unknown 2027'), row('Sat 27h'),
    heading('November 2027', 'December 2027'), row('Sat 27h'),
    heading('November'), row('Sat 27h'), heading('2027'), row('Sat 27h'),
    heading('December 2027'), row('Sat 4th', 'Harrogate - Royal Hall')
  ) + table(row('Sat 27h'), heading('January 2028'), row('Sat 8th', 'Christchurch - The Regent'));
  const concerts = await scrape(await config(), html, clocks[0]);
  assert.deepEqual(concerts.map(c => c.date), ['2027-11-27', '2027-12-04', '2028-01-08']);
});

test('a nested table does not replace its parent month context', async () => {
  const nested = table(heading('January 2028'), row('Sat 8th', 'Christchurch - The Regent'));
  const html = `<table class="tableBuilder"><tbody>${heading('November 2027')}${row('Sat 27h')}` +
    `<tr><td>${nested}</td></tr>${row('Sat 27h')}</tbody></table>`;
  const concerts = await scrape(await config(), html, clocks[0]);
  assert.deepEqual(concerts.map(c => c.date), ['2027-11-27', '2027-11-27', '2028-01-08']);
});

test('invalid days, ambiguous lists, weekday conflicts and unknown day shapes are rejected', async () => {
  const html = table(
    heading('February 2027'), row('Mon 29th'), row('Sun 14th (afternoon)', 'Glenrothes - CISWO'),
    heading('September 2027'), row('Thu 24th', 'Sevenoaks - The Stag'),
    row('Fri 10th, Sat 11th'), row('Fri 10th / Sat 11th'), row('Fri 10st'), row('Fri 10th')
  );
  const concerts = await scrape(await config(), html, clocks[0]);
  assert.deepEqual(concerts.map(c => c.date), ['2027-02-14', '2027-09-10']);
});

test('verified locations use exact evidence and unknown labels cannot inherit GB', async () => {
  const cfg = await config();
  const html = table(heading('November 2027'),
    ...verifiedLocations.map(([label]) => row('Sat 27h', label)),
    row('Sat 27h', 'Unverified - Unknown Hall'));
  const concerts = await scrape(cfg, html, clocks[0]);
  assert.deepEqual(concerts.slice(0, verifiedLocations.length).map(c => [c.city, c.venue, c.country]),
    verifiedLocations.map(([, city, venue, country]) => [city, venue, country]));
  assert.deepEqual([concerts.at(-1)?.city, concerts.at(-1)?.venue, concerts.at(-1)?.country],
    ['Unverified - Unknown Hall', 'Unverified - Unknown Hall', undefined]);
});

test('only the conflicting Castlebar date is held', async () => {
  const concerts = await scrape(await config(), table(
    heading('December 2026'), row('Sun 6th', 'Castlebar - TF Royal'),
    heading('November 2027'), row('Sat 27h', 'Castlebar - TF Royal')
  ), clocks[0]);
  assert.deepEqual(concerts.map(c => [c.date, c.city, c.venue, c.country]),
    [['2027-11-27', 'Castlebar', 'TF Royal Theatre', 'IE']]);
});

test('eight proven venue labels recover their exact dates without trusting nearby labels', async () => {
  const proof = JSON.parse(await readFile('tests/fixtures/artist-showaddywaddy-locations-20260928.json', 'utf8')) as {
    locations: { label: string; city: string; venue: string; country: string; dates: string[] }[];
  };
  assert.equal(proof.locations.length, 8);
  const cfg = await config();
  const concerts = await scrape(cfg, await readFile('tests/fixtures/artist-showaddywaddy-gigs.html', 'utf8'), clocks[0]);
  for (const location of proof.locations) {
    const recovered = concerts.filter(c => c.city === location.city && c.venue === location.venue);
    assert.deepEqual(recovered.map(c => c.date), location.dates);
    assert.ok(recovered.every(c => c.country === location.country && c.startTime === undefined &&
      c.lat === undefined && c.lng === undefined && c.ticketUrl === undefined));
  }
  const unknown = await scrape(cfg, table(heading('October 2026'),
    ...proof.locations.map(place => row('Fri 2nd', `${place.label} Annex`))
  ), clocks[0]);
  assert.equal(unknown.length, 8);
  assert.ok(unknown.every(c => c.country === undefined), 'proof for one venue must not extend to a similar label');
});

test('ticket URLs are resolved safely while verified location fields retain their source identity', async () => {
  const cfg = await config();
  cfg.selectors!.ticketUrl = '.tableBuilderCell3 a';
  const concerts = await scrape(cfg, table(
    heading('November 2027'), row('Sat 27h', 'Port Talbot - Princess Royal Theatre', '/tickets/port-talbot'),
    row('Sat 27h', 'Port Talbot - Princess Royal Theatre', 'javascript:alert(1)'),
    row('Sat 27h', 'Port Talbot - Princess Royal Theatre', '#')
  ), clocks[0]);
  assert.equal(concerts.length, 3);
  assert.equal(concerts[0].ticketUrl, 'https://www.showaddywaddy.net/tickets/port-talbot');
  assert.equal(concerts[1].ticketUrl, undefined);
  assert.equal(concerts[2].ticketUrl, 'https://www.showaddywaddy.net/gigs/#');
  assert.deepEqual(concerts.map(c => [c.artist, c.venue, c.city, c.country, c.originalSource]),
    Array(3).fill(['Showaddywaddy', 'Princess Royal Theatre',
      'Port Talbot', 'GB', cfg.domain]));
});
