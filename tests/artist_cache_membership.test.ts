import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { filterArtistCacheForActiveConfigs } from '../src/engine/artist_cache.js';
import type { ScrapeCache, VenueCache } from '../src/engine/cache.js';

function cachedConcert(artist: string): VenueCache {
  return {
    contentHash: artist.toLowerCase().replace(/\s+/g, '-'),
    scrapedAt: '2026-09-25T00:00:00.000Z',
    concerts: [{ artist, date: '2026-10-01' }]
  };
}

async function tempConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'artist-cache-membership-'));
}

test('artist cache membership excludes orphaned IDs but retains active last-good data by config.id', async () => {
  const dir = await tempConfigDir();
  try {
    await fs.writeFile(path.join(dir, 'renamed-file.json'), JSON.stringify({
      id: 'artist-active',
      // The rest of the config is deliberately invalid. Membership follows a
      // usable config.id so a temporary config failure cannot erase last-good data.
      url: 'not-a-url'
    }));
    const cache: ScrapeCache = {
      'artist-active': cachedConcert('Active Artist'),
      'renamed-file': cachedConcert('Stale Filename Entry'),
      'artist-deleted': cachedConcert('Deleted Artist')
    };

    const filtered = await filterArtistCacheForActiveConfigs(cache, dir);

    assert.deepStrictEqual(Object.keys(filtered), ['artist-active']);
    assert.equal(filtered['artist-active'].concerts[0].artist, 'Active Artist');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('artist cache membership uses a safe filename fallback for malformed JSON', async () => {
  const dir = await tempConfigDir();
  try {
    await fs.writeFile(path.join(dir, 'artist-malformed.json'), '{broken');
    const cache: ScrapeCache = {
      'artist-malformed': cachedConcert('Malformed But Active'),
      'artist-orphan': cachedConcert('Orphan')
    };

    const filtered = await filterArtistCacheForActiveConfigs(cache, dir);

    assert.deepStrictEqual(Object.keys(filtered), ['artist-malformed']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('artist cache membership fails explicitly when the config directory cannot be listed', async () => {
  const dir = await tempConfigDir();
  await fs.rm(dir, { recursive: true, force: true });

  await assert.rejects(
    filterArtistCacheForActiveConfigs({ 'artist-active': cachedConcert('Active') }, dir),
    /Failed to list active artist scraper configs/
  );
});

test('artist cache membership fails explicitly on config read errors', async () => {
  const dir = await tempConfigDir();
  try {
    // A directory with a .json suffix is returned by readdir but cannot be read
    // as a file, giving us a deterministic filesystem read error on every OS.
    await fs.mkdir(path.join(dir, 'artist-unreadable.json'));

    await assert.rejects(
      filterArtistCacheForActiveConfigs({ 'artist-unreadable': cachedConcert('Unreadable') }, dir),
      /Failed to read artist scraper config artist-unreadable\.json/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('project artist membership excludes retired James Taylor misattributions and keeps the canonical config', async () => {
  const cache: ScrapeCache = {
    'artist-james-taylor': cachedConcert('James Taylor'),
    'artist-your-smiling-face': cachedConcert('Your Smiling Face'),
    'artist-youre-all-i-wanna-do': cachedConcert("You're All I Wanna Do")
  };

  const filtered = await filterArtistCacheForActiveConfigs(
    cache,
    path.join(process.cwd(), 'scrapers', 'artists')
  );

  assert.deepStrictEqual(Object.keys(filtered), ['artist-james-taylor']);
  assert.equal(filtered['artist-james-taylor'].concerts[0].date, '2026-10-01');
});
