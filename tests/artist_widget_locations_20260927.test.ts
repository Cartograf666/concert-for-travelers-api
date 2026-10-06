import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { ScraperConfig } from '../src/schemas/config.js';

type Case = {
  id: string;
  fixture: string;
  artist: string;
  rawCount: number;
  futureCount: number;
  samples: Array<{ venue: string; city: string; country: string }>;
};

const CASES: Case[] = [
  {
    id: 'artist-amber-run',
    fixture: 'artist-amber-run-location.html',
    artist: 'Amber Run',
    rawCount: 16,
    futureCount: 16,
    samples: [
      { venue: 'The Glasshouse', city: 'Gateshead', country: 'GB' },
      { venue: 'La Madeleine', city: 'Brussels', country: 'BE' },
      { venue: 'WUK', city: 'Vienna', country: 'AT' }
    ]
  },
  {
    id: 'artist-barbara-dickson',
    fixture: 'artist-barbara-dickson-location.html',
    artist: 'Barbara Dickson',
    rawCount: 13,
    futureCount: 13,
    samples: [
      { venue: 'Carnegie Hall', city: 'Dunfermline', country: 'GB' },
      { venue: "The Queen's Hall", city: 'Edinburgh', country: 'GB' },
      { venue: 'The Stables', city: 'Milton Keynes', country: 'GB' }
    ]
  },
  {
    id: 'artist-emancipator',
    fixture: 'artist-sources-recovery-20261006/artist-emancipator.json',
    artist: 'Emancipator',
    rawCount: 12,
    futureCount: 12,
    samples: [
      { venue: 'Crystal Ballroom at Somerville Theatre', city: 'Somerville', country: 'US' },
      { venue: 'Hollywood Theatre', city: 'Vancouver', country: 'CA' },
      { venue: 'The Ave Live', city: 'Philadelphia', country: 'US' }
    ]
  }
];

async function runFixture(t: test.TestContext, c: Case) {
  const html = await readFile(path.join('tests', 'fixtures', c.fixture), 'utf8');
  const config = JSON.parse(await readFile(path.join('scrapers', 'artists', `${c.id}.json`), 'utf8')) as ScraperConfig;
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return runScraper({ ...config, url: `http://localhost:${address.port}/tour` });
}

for (const c of CASES) {
  test(`${c.id} extracts only evidence-backed city/country pairs through runScraper`, async (t) => {
    const result = await runFixture(t, c);

    assert.equal(result.success, true);
    assert.equal(result.concerts.length, c.rawCount, 'ambiguous location rows must be rejected');
    for (const expected of c.samples) {
      const actual = result.concerts.find((concert) => concert.venue === expected.venue);
      assert.deepEqual(
        actual && { venue: actual.venue, city: actual.city, country: actual.country },
        expected
      );
    }
    assert.ok(result.concerts.every((concert) => /^[A-Z]{2}$/.test(concert.country ?? '')));

    const dir = await mkdtemp(path.join(tmpdir(), 'artist-widget-locations-'));
    const approved = path.join(dir, 'artists.json');
    await writeFile(approved, JSON.stringify([{ name: c.artist }]));
    const future = await processConcerts(result.concerts, approved, '2026-09-27T12:00:00.000Z');
    assert.equal(future.length, c.futureCount);
  });
}

test('artist-emancipator preserves the API explicit next-year date', async (t) => {
  const c: Case = {
    id: 'artist-emancipator',
    fixture: 'artist-sources-recovery-20261006/artist-emancipator-next-year.json',
    artist: 'Emancipator',
    rawCount: 1,
    futureCount: 1,
    samples: [{ venue: 'Crystal Ballroom at Somerville Theatre', city: 'Somerville', country: 'US' }]
  };
  const result = await runFixture(t, c);
  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 1);

  const dir = await mkdtemp(path.join(tmpdir(), 'artist-widget-next-year-'));
  const approved = path.join(dir, 'artists.json');
  await writeFile(approved, JSON.stringify([{ name: c.artist }]));
  const future = await processConcerts(result.concerts, approved, '2026-09-27T12:00:00.000Z');
  assert.equal(future.length, 1);
  assert.equal(future[0].date, '2027-01-02');
});
