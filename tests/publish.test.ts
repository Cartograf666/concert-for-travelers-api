import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { publishConcerts, publishArtistCatalog, CONCERT_SCHEMA_VERSION } from '../src/generator/publish.js';
import { Concert } from '../src/schemas/concert.js';

function makeConcert(overrides: Partial<Concert>): Concert {
  return {
    artist: 'The Cure',
    date: '2026-10-12',
    venue: 'Club Arena',
    city: 'Berlin',
    country: 'DE',
    originalSource: 'club-arena.de',
    scrapedAt: new Date().toISOString(),
    ...overrides
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('Publisher - writes concerts.json, per-artist/per-city files, and index.json', async () => {
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'The Cure', city: 'Berlin', date: '2026-10-12' }),
      makeConcert({ artist: 'Rammstein', city: 'Paris', date: '2026-11-01' })
    ];

    await publishConcerts(concerts, dir);

    const master = JSON.parse(await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8'));
    assert.strictEqual(master.length, 2);

    const theCure = JSON.parse(await fs.readFile(path.join(dir, 'artists', 'the-cure.json'), 'utf-8'));
    assert.strictEqual(theCure.length, 1);
    assert.strictEqual(theCure[0].artist, 'The Cure');

    const berlin = JSON.parse(await fs.readFile(path.join(dir, 'cities', 'berlin.json'), 'utf-8'));
    assert.strictEqual(berlin.length, 1);

    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    assert.strictEqual(index.schemaVersion, CONCERT_SCHEMA_VERSION);
    assert.strictEqual(index.stats.totalConcerts, 2);
    assert.strictEqual(index.stats.uniqueArtists, 2);
    assert.strictEqual(index.stats.uniqueCities, 2);
  });
});

test('Publisher - slugify collision merges distinct artists into one file (known limitation)', async () => {
  // "AC/DC" and "ACDC" both slugify to "acdc" -- this documents the current
  // behavior (both land in the same per-artist file) rather than asserting it's
  // desirable, so a future slugify change that silently reintroduces or changes
  // this collision is caught by a failing test either way.
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'AC/DC', date: '2026-10-12' }),
      makeConcert({ artist: 'ACDC', date: '2026-11-01' })
    ];

    await publishConcerts(concerts, dir);

    const files = await fs.readdir(path.join(dir, 'artists'));
    assert.deepStrictEqual(files, ['acdc.json']);
    const merged = JSON.parse(await fs.readFile(path.join(dir, 'artists', 'acdc.json'), 'utf-8'));
    assert.strictEqual(merged.length, 2);

    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    // uniqueArtists counts raw artist strings, not slugs, so this still reports 2
    // even though only one per-artist file was written -- a real discrepancy a
    // future fix should be aware of.
    assert.strictEqual(index.stats.uniqueArtists, 2);
  });
});

test('Publisher - pruneOrphans removes stale per-artist/city files no longer in the current run', async () => {
  await withTempDir(async (dir) => {
    await publishConcerts([makeConcert({ artist: 'The Cure', city: 'Berlin' })], dir);
    assert.ok(await fs.readFile(path.join(dir, 'artists', 'the-cure.json'), 'utf-8'));

    // Next run: The Cure stopped touring, only Rammstein remains.
    await publishConcerts([makeConcert({ artist: 'Rammstein', city: 'Paris', date: '2026-11-01' })], dir);

    const artistFiles = await fs.readdir(path.join(dir, 'artists'));
    assert.deepStrictEqual(artistFiles, ['rammstein.json']);
    const cityFiles = await fs.readdir(path.join(dir, 'cities'));
    assert.deepStrictEqual(cityFiles, ['paris.json']);
  });
});

test('Publisher - an empty concert list still produces a valid (zeroed) index.json', async () => {
  await withTempDir(async (dir) => {
    await publishConcerts([], dir);
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    assert.strictEqual(index.stats.totalConcerts, 0);
    const master = JSON.parse(await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8'));
    assert.deepStrictEqual(master, []);
  });
});

test('Publisher - sorts concerts by date, then artist, then city, and writes compact JSON', async () => {
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'Rammstein', city: 'Paris', date: '2026-11-01' }),
      makeConcert({ artist: 'The Cure', city: 'London', date: '2026-10-12' }),
      makeConcert({ artist: 'The Cure', city: 'Berlin', date: '2026-10-12' }),
      makeConcert({ artist: 'Aphex Twin', city: 'Berlin', date: '2026-10-12' })
    ];

    await publishConcerts(concerts, dir);

    const masterRaw = await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8');
    assert.strictEqual(masterRaw.includes('\n'), false);

    const master = JSON.parse(masterRaw);
    assert.strictEqual(master.length, 4);
    assert.strictEqual(master[0].artist, 'Aphex Twin');
    assert.strictEqual(master[1].artist, 'The Cure');
    assert.strictEqual(master[1].city, 'Berlin');
    assert.strictEqual(master[2].artist, 'The Cure');
    assert.strictEqual(master[2].city, 'London');
    assert.strictEqual(master[3].artist, 'Rammstein');
  });
});

test('Publisher - artist catalog: publishes the FULL whitelist (not just artists with a current concert), keyed by slug', async () => {
  await withTempDir(async (dir) => {
    const approvedArtists = [
      {
        name: 'Muse',
        website: 'https://www.muse.mu/',
        socials: { spotify: 'https://open.spotify.com/artist/12Chz98pHFMPJEknJQMWvI', instagram: 'https://www.instagram.com/museband/' },
        mbid: '9c9f1380-2516-4fc9-a3e6-f9f61941d090',
        genres: ['rock', 'alternative'],
        popularity: { listeners: 4500000, playcount: 900000000 },
        image: 'https://cdn.example/muse.jpg',
        similarArtists: [{ name: 'Radiohead', slug: 'radiohead', match: 0.92 }]
      },
      { name: 'Some Untoured Artist', website: null }, // no current concert -- must still be published
      'Legacy String Entry' // pre-metadata legacy shape
    ];

    await publishArtistCatalog(approvedArtists, dir);
    const catalog = JSON.parse(await fs.readFile(path.join(dir, 'artists.json'), 'utf-8'));

    assert.strictEqual(catalog.length, 3);
    const muse = catalog.find((a: any) => a.slug === 'muse');
    assert.strictEqual(muse.name, 'Muse');
    assert.strictEqual(muse.spotifyId, '12Chz98pHFMPJEknJQMWvI', 'spotifyId parsed from socials.spotify');
    assert.strictEqual(muse.mbid, '9c9f1380-2516-4fc9-a3e6-f9f61941d090');
    assert.deepStrictEqual(muse.genres, ['rock', 'alternative']);
    assert.deepStrictEqual(muse.popularity, { listeners: 4500000, playcount: 900000000 });
    assert.strictEqual(muse.image, 'https://cdn.example/muse.jpg');
    assert.deepStrictEqual(muse.similarArtists, [{ name: 'Radiohead', slug: 'radiohead', match: 0.92 }]);

    const untoured = catalog.find((a: any) => a.slug === 'some-untoured-artist');
    assert.ok(untoured, 'an artist with no current concert must still appear in the full directory');

    const legacy = catalog.find((a: any) => a.slug === 'legacy-string-entry');
    assert.deepStrictEqual(legacy, { slug: 'legacy-string-entry', name: 'Legacy String Entry' });
  });
});

test('Publisher - artist catalog: malformed similarArtists entries are dropped, and an all-malformed list omits the field entirely', async () => {
  await withTempDir(async (dir) => {
    const approvedArtists = [
      {
        name: 'Muse',
        website: null,
        similarArtists: [
          { name: 'Radiohead', slug: 'radiohead', match: 0.9 },
          { name: 'Missing Slug', match: 0.5 }, // malformed -- dropped
          { slug: 'missing-name', match: 0.5 } // malformed -- dropped
        ]
      },
      { name: 'All Malformed', website: null, similarArtists: [{ name: 'X' }] }
    ];
    await publishArtistCatalog(approvedArtists, dir);
    const catalog = JSON.parse(await fs.readFile(path.join(dir, 'artists.json'), 'utf-8'));

    const muse = catalog.find((a: any) => a.slug === 'muse');
    assert.deepStrictEqual(muse.similarArtists, [{ name: 'Radiohead', slug: 'radiohead', match: 0.9 }]);

    const allMalformed = catalog.find((a: any) => a.slug === 'all-malformed');
    assert.strictEqual('similarArtists' in allMalformed, false, 'an entry with zero valid candidates should omit the field, not publish an empty array');
  });
});

test('Publisher - artist catalog: a slug collision keeps the first entry, matching the per-artist concert file behavior', async () => {
  await withTempDir(async (dir) => {
    const approvedArtists = [
      { name: 'AC/DC', website: 'https://acdc.com' },
      { name: 'ACDC', website: 'https://different.example' }
    ];
    await publishArtistCatalog(approvedArtists, dir);
    const catalog = JSON.parse(await fs.readFile(path.join(dir, 'artists.json'), 'utf-8'));
    assert.strictEqual(catalog.length, 1);
    assert.strictEqual(catalog[0].website, 'https://acdc.com');
  });
});

test('Publisher - city grouping clusters nearby same-country venues (ward/kanji fragmentation) under one canonical bucket', async () => {
  await withTempDir(async (dir) => {
    // Tokorozawa (Belluna Dome) is a real ~30km-out Tokyo-metro venue that scraped
    // sources report under its own literal city string -- the exact case that
    // motivated geo-clustering (previously landed in its own dist/cities/*.json,
    // invisible to anyone browsing "Tokyo").
    const concerts = [
      makeConcert({ artist: 'A', city: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 }),
      makeConcert({ artist: 'B', city: 'Tokyo', country: 'JP', lat: 35.6762, lng: 139.6503 }),
      makeConcert({ artist: 'C', city: '所沢市', country: 'JP', lat: 35.7992, lng: 139.4690 }),
      // Different country, same coordinates as nothing else here -- must not be
      // pulled into the JP cluster just because a city string happens to match.
      makeConcert({ artist: 'D', city: 'Paris', country: 'FR', lat: 48.8566, lng: 2.3522 })
    ];

    await publishConcerts(concerts, dir);

    const cityFiles = (await fs.readdir(path.join(dir, 'cities'))).sort();
    // "所沢市" merges into the more-represented "Tokyo" bucket instead of getting
    // its own file; Paris (different country) stays separate.
    assert.deepStrictEqual(cityFiles, ['paris.json', 'tokyo.json']);

    const tokyo = JSON.parse(await fs.readFile(path.join(dir, 'cities', 'tokyo.json'), 'utf-8'));
    assert.strictEqual(tokyo.length, 3);
    assert.ok(tokyo.some((c: any) => c.artist === 'C'), 'the Tokorozawa concert must be included in the Tokyo bucket');

    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    assert.strictEqual(index.stats.uniqueCities, 2);
  });
});

test('Publisher - city grouping falls back to the raw city string when lat/lng is missing (unclusterable)', async () => {
  await withTempDir(async (dir) => {
    const concerts = [
      makeConcert({ artist: 'A', city: 'Tokyo', country: 'JP' }), // no lat/lng
      makeConcert({ artist: 'B', city: '所沢市', country: 'JP' }) // no lat/lng
    ];

    await publishConcerts(concerts, dir);

    // Without geocoding, each raw city string is its own singleton bucket -- same
    // as before city-clustering existed.
    const cityFiles = (await fs.readdir(path.join(dir, 'cities'))).sort();
    assert.strictEqual(cityFiles.length, 2);
  });
});

test('Publisher - paginates concerts into 500-sized pages additively and prunes orphans', async () => {
  await withTempDir(async (dir) => {
    const concerts = Array.from({ length: 1002 }, (_, i) =>
      makeConcert({ artist: `Artist ${String(i).padStart(4, '0')}`, date: '2026-10-12', city: 'Berlin' })
    );

    await publishConcerts(concerts, dir);

    // 1. Verify index.json has pageCount and pageSize
    const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8'));
    assert.strictEqual(index.stats.pageCount, 3);
    assert.strictEqual(index.stats.pageSize, 500);

    // 2. Verify all pages are written
    const page1 = JSON.parse(await fs.readFile(path.join(dir, 'concerts', 'page-1.json'), 'utf-8'));
    const page2 = JSON.parse(await fs.readFile(path.join(dir, 'concerts', 'page-2.json'), 'utf-8'));
    const page3 = JSON.parse(await fs.readFile(path.join(dir, 'concerts', 'page-3.json'), 'utf-8'));

    assert.strictEqual(page1.length, 500);
    assert.strictEqual(page2.length, 500);
    assert.strictEqual(page3.length, 2);

    // 3. Verify they concatenate back to the master list
    const master = JSON.parse(await fs.readFile(path.join(dir, 'concerts.json'), 'utf-8'));
    const concatenated = [...page1, ...page2, ...page3];
    assert.deepStrictEqual(concatenated, master);

    // 4. Verify no extra pages exist (e.g. pruneOrphanFiles works)
    await fs.writeFile(path.join(dir, 'concerts', 'page-4.json'), '[]');
    await publishConcerts(concerts, dir);
    const files = await fs.readdir(path.join(dir, 'concerts'));
    assert.deepStrictEqual(files.sort(), ['page-1.json', 'page-2.json', 'page-3.json']);
  });
});

