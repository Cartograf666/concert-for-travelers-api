import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape as scrapePharis } from '../src/engine/custom/artist-pharis-and-jason-romero.js';
import { scrape as scrapeHootie } from '../src/engine/custom/artist-hootie-and-the-blowfish.js';
import { scrape as scrapeJoan } from '../src/engine/custom/artist-joan-jett-and-the-blackhearts.js';

const root = process.cwd();
const fixtures = path.join(root, 'tests/fixtures/tour-widgets-recovery-20261006');
const scrapedAt = '2026-10-06T12:00:00.000Z';

async function config(id: string) {
  return ScraperConfigSchema.parse(JSON.parse(await readFile(path.join(root, 'scrapers', `${id}.json`), 'utf8')));
}

test('Pharis official rendered Tour Dates block yields a dated CA concert and rejects unrelated performer', async () => {
  const source = await config('artist-pharis-and-jason-romero');
  assert.equal(source.type, 'playwright_render');
  assert.equal(source.renderParser, 'custom_js');
  const html = await readFile(path.join(fixtures, 'pharis-rendered-block.html'), 'utf8');
  const concerts = await scrapePharis(source, html, scrapedAt);
  assert.equal(concerts.length, 1);
  assert.deepEqual([concerts[0].artist, concerts[0].date, concerts[0].startTime,
    concerts[0].venue, concerts[0].city, concerts[0].country],
  ['Pharis and Jason Romero', '2027-04-17', '19:30', 'The Anvil Theatre Presents', 'New Westminster', 'CA']);
  assert.match(concerts[0].ticketUrl || '', /^https:\/\/www\.bandsintown\.com\/t\/108652899/);
  assert.deepEqual(await scrapePharis(source, html.replace('"name": "Pharis & Jason Romero",', '"name": "Other Artist",'), scrapedAt), []);
});

test('Pharis maps per-event country and drops a row with an unknown country', async () => {
  const source = await config('artist-pharis-and-jason-romero');
  const html = await readFile(path.join(fixtures, 'pharis-rendered-block.html'), 'utf8');
  const us = html.replace('"addressCountry": "Canada"', '"addressCountry": "United States"');
  assert.equal((await scrapePharis(source, us, scrapedAt))[0]?.country, 'US');
  const unknown = html.replace('"addressCountry": "Canada"', '"addressCountry": "Unknownland"');
  assert.deepEqual(await scrapePharis(source, unknown, scrapedAt), []);
});

test('Hootie official widget ID and visible empty state agree with an empty public feed', async () => {
  const source = await config('artist-hootie-and-the-blowfish');
  assert.equal(source.type, 'custom_js');
  assert.equal(source.url, 'https://rest.bandsintown.com/artists/id_3749/events?app_id=js_www.hootie.com&date=upcoming');
  assert.equal(source.allowEmpty, true);
  const html = await readFile(path.join(fixtures, 'hootie-rendered-empty.html'), 'utf8');
  assert.match(html, /No Upcoming Shows/);
  assert.match(html, /artist-subscribe\/3749-hootie-and-the-blowfish/);
  assert.deepEqual(await scrapeHootie(source, '[]', scrapedAt), []);
  await assert.rejects(() => scrapeHootie(source, '{}', scrapedAt), /not an event array/);
});

test('Joan Blackheart official tour widget proves empty and keeps future country per row', async () => {
  const source = await config('artist-joan-jett-and-the-blackhearts');
  assert.equal(source.url, 'https://blackheart.com/joan-jett-and-the-blackhearts-1');
  assert.equal(source.renderParser, 'custom_js');
  assert.equal(source.emptyScheduleText, 'There are no upcoming tour dates.');
  const empty = await readFile(path.join(fixtures, 'joan-blackheart-rendered-empty.html'), 'utf8');
  assert.match(empty, /There are no upcoming tour dates\./);
  assert.deepEqual(await scrapeJoan(source, empty, scrapedAt), []);
  // A synthetic future row on the same Squarespace block checks identity and
  // per-row country if the currently empty official widget gains dates.
  const pharis = await readFile(path.join(fixtures, 'pharis-rendered-block.html'), 'utf8');
  const future = pharis.replaceAll('Pharis & Jason Romero', 'Joan Jett and the Blackhearts')
    .replaceAll('Pharis &amp; Jason Romero', 'Joan Jett and the Blackhearts');
  const concerts = await scrapeJoan(source, future, scrapedAt);
  assert.deepEqual(concerts.map(({ artist, date, country }) => [artist, date, country]),
    [['Joan Jett and The Blackhearts', '2027-04-17', 'CA']]);
});

test('Hootie future public feed maps country and fails on spoofed or malformed rows', async () => {
  const source = await config('artist-hootie-and-the-blowfish');
  // The present official feed is empty. Synthetic rows verify its future path.
  const event = (id: string, country: string) => ({
    id, artist: { id: '3749', name: 'Hootie & The Blowfish' }, datetime: '2027-04-17T19:30:00',
    url: `https://www.bandsintown.com/e/${id}`,
    venue: { name: 'Anvil Theatre', city: 'New Westminster', country }
  });
  const payload = [event('123', 'Canada'), event('124', 'United States')];
  const concerts = await scrapeHootie(source, JSON.stringify(payload), scrapedAt);
  assert.deepEqual(concerts.map(({ artist, country, date }) => [artist, country, date]), [
    ['Hootie & The Blowfish', 'CA', '2027-04-17'], ['Hootie & The Blowfish', 'US', '2027-04-17']
  ]);
  await assert.rejects(() => scrapeHootie(source,
    JSON.stringify([{ ...payload[0], artist: { id: '9999', name: 'Other Artist' } }]), scrapedAt), /different artist identity/);
  await assert.rejects(() => scrapeHootie(source,
    JSON.stringify([{ ...payload[0], venue: { ...payload[0].venue, country: 'Unknownland' } }]), scrapedAt), /valid venue, city or country/);
  await assert.rejects(() => scrapeHootie(source,
    JSON.stringify([payload[0], payload[0]]), scrapedAt), /duplicate/);
});
