import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../src/pipeline/artistDb.js';
import { matchApprovedArtist, processConcerts } from '../src/pipeline/process.js';
import { scrape } from '../src/engine/custom/artist-bucks-fizz.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const officialSpotify = 'https://open.spotify.com/artist/1fyj6rE8Dw2eLkmdflawvG';

test('The Fizz official calendar publishes under its exact canonical identity, correcting the reproduced The Firm collision', async () => {
  const approved = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  const fizz = approved.filter(row => row.name === 'The Fizz');
  assert.equal(fizz.length, 1);
  assert.equal(fizz[0].website, 'https://www.thefizzofficial.com');
  assert.equal(fizz[0].socials.spotify, officialSpotify);
  assert.equal(fizz[0].mbid, undefined, 'do not inherit the legacy Bucks Fizz MBID');
  const prior = approved.map(row => row === fizz[0] ? {
    ...row, name: "Buck's Fizz", socials: { ...row.socials, spotify: 'https://open.spotify.com/artist/4XgN3a5Q4Kj7cKkR3V525T' }
  } : row);
  assert.equal(matchApprovedArtist('The Fizz', prior)?.name, 'The Firm', 'reproduce the old wrong match using the full real catalog');
  assert.equal(matchApprovedArtist('The Fizz', approved)?.name, 'The Fizz');
  assert.equal(matchApprovedArtist('THE FIZZ', approved)?.name, 'The Fizz');
  const config = ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-bucks-fizz.json', 'utf8')));
  const raw = await scrape(config, await readFile('tests/fixtures/artist-bucks-fizz-tour-20261006.html', 'utf8'), '2026-10-06T12:00:00Z');
  const published = await processConcerts(raw, PRODUCTION_ARTIST_DB_DIR, '2026-10-06T12:00:00Z');
  assert.equal(published.length, 14);
  assert.ok(published.every(row => row.artist === 'The Fizz' && row.spotifyId === '1fyj6rE8Dw2eLkmdflawvG' &&
    row.artistWebsite === 'https://www.thefizzofficial.com' && row.ticketUrl === 'https://www.thefizzofficial.com' &&
    !row.mbid && !('sourceEventUrl' in row)));
});

test('The Fizz correction preserves the separate legacy Bucks Fizz and The Firm identities', async () => {
  const approved = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  for (const name of ['Bucks Fizz', "Buck's Fizz"]) {
    const legacy = matchApprovedArtist(name, approved);
    assert.equal(legacy?.name, 'Bucks Fizz');
    assert.equal(legacy?.mbid, '81b9c72d-8d46-446b-a420-ba618d89636e');
    assert.equal(legacy?.socials?.spotify, 'https://open.spotify.com/artist/5ZfzzHE7rxONfoksJsLXrX');
  }
  const firm = matchApprovedArtist('The Firm', approved);
  assert.equal(firm?.mbid, 'c08ced1f-d248-4368-90e5-bf579b3bf5de');
  assert.equal(firm?.socials?.spotify, 'https://open.spotify.com/artist/0k2s5f9c4zM7wZ9lP4L8Y1');
});
