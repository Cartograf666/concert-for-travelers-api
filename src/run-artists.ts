import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfigs, runAllScrapers, closeBrowser } from './engine/runner.js';
import { loadCache, saveCache } from './engine/cache.js';
import { fetchBandsintownConcerts, loadBandsintownCache, saveBandsintownCache } from './engine/bandsintown.js';
import { fetchEventbriteConcerts, loadEventbriteCache, saveEventbriteCache } from './engine/eventbrite.js';

/** Reads the newline-delimited artist target list, dropping blanks/dupes. */
async function loadArtistTargets(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const seen = new Set<string>();
    for (const line of raw.split('\n')) {
      const name = line.trim();
      if (name) seen.add(name);
    }
    return Array.from(seen);
  } catch (err: any) {
    console.warn(`[ArtistScrape] Could not read artist target list at ${filePath}: ${err.message}`);
    return [];
  }
}

/**
 * Scrapes artist tour-page configs (scrapers/artists/*.json) into their own cache
 * file, on their own schedule (see artist-scrape.yml) -- deliberately separate from
 * the daily venue + Ticketmaster run.ts. There can be hundreds/thousands of these,
 * and tour dates don't change hour to hour, so running them daily alongside
 * everything else would blow the daily job's time budget for little gain. This
 * script does NOT normalize, enrich, or publish -- run.ts picks up whatever this
 * writes to artist-scrape-cache.json on its next run and merges it in.
 */
async function main() {
  const scrapersDir = path.join(process.cwd(), 'scrapers', 'artists');
  const reportsDir = path.join(process.cwd(), 'reports');

  console.log('[ArtistScrape] Starting artist tour-page scrape...');

  try {
    await fs.mkdir(scrapersDir, { recursive: true });
    const configs = await loadConfigs(scrapersDir);
    if (configs.length === 0) {
      console.log('[ArtistScrape] No configs found in scrapers/artists/. Nothing to do.');
      return;
    }
    console.log(`[ArtistScrape] Loaded ${configs.length} artist tour-page configs.`);

    await fs.mkdir(reportsDir, { recursive: true });
    const cachePath = path.join(reportsDir, 'artist-scrape-cache.json');
    const cache = await loadCache(cachePath);

    const results = await runAllScrapers(configs, 5, cache);

    let changedCount = 0;
    let failedCount = 0;
    for (const r of results) {
      if (r.success) {
        if (!r.notModified) changedCount++;
        cache[r.configId] = {
          etag: r.etag,
          lastModified: r.lastModified,
          contentHash: r.contentHash ?? cache[r.configId]?.contentHash ?? '',
          scrapedAt: r.scrapedAt,
          concerts: r.concerts
        };
      } else {
        failedCount++;
        // Leave any existing cache entry untouched -- same fallback-to-last-good
        // behavior run.ts uses for venues, so a transient failure doesn't wipe an
        // artist's tour dates from the eventual publish.
        console.warn(`[ArtistScrape] ${r.configId} failed (${r.reason}); keeping last cached result if any.`);
      }
    }
    await saveCache(cachePath, cache);
    console.log(`[ArtistScrape] Tour-page pass done. ${changedCount}/${configs.length} changed, ${failedCount} failed. Cache saved to ${cachePath}.`);

    // Bandsintown public-widget sweep -- the artist-keyed, worldwide source (covers
    // markets the venue/Ticketmaster sources miss). Batched + resumable via its own
    // cache, so a big list is worked across successive runs. Separate cache file
    // from the tour-page configs above; run.ts merges both into the daily publish.
    const artistTargets = await loadArtistTargets(path.join(process.cwd(), 'data', 'artist_scrape_targets.txt'));
    if (artistTargets.length > 0) {
      const maxPerRun = process.env.BANDSINTOWN_MAX_PER_RUN ? parseInt(process.env.BANDSINTOWN_MAX_PER_RUN, 10) : undefined;
      const bitCachePath = path.join(reportsDir, 'bandsintown-cache.json');
      const bitCache = await loadBandsintownCache(bitCachePath);
      console.log(`[ArtistScrape] Starting Bandsintown sweep over ${artistTargets.length} artist targets...`);
      const bitConcerts = await fetchBandsintownConcerts(artistTargets, { cache: bitCache, maxPerRun });
      await saveBandsintownCache(bitCachePath, bitCache);
      console.log(`[ArtistScrape] Bandsintown sweep done -> ${bitConcerts.length} raw events cached across ${Object.keys(bitCache).length} artists.`);

      // Eventbrite public-discovery-page sweep -- see src/engine/eventbrite.ts for
      // why this scrapes public search pages instead of calling an API (Eventbrite
      // has none for third-party multi-organizer search), and the ToS-risk tradeoff
      // that implies. Own cache, own (smaller/gentler) per-run cap.
      const ebMaxPerRun = process.env.EVENTBRITE_MAX_PER_RUN ? parseInt(process.env.EVENTBRITE_MAX_PER_RUN, 10) : undefined;
      const ebCachePath = path.join(reportsDir, 'eventbrite-cache.json');
      const ebCache = await loadEventbriteCache(ebCachePath);
      console.log(`[ArtistScrape] Starting Eventbrite sweep over ${artistTargets.length} artist targets...`);
      const ebConcerts = await fetchEventbriteConcerts(artistTargets, { cache: ebCache, maxPerRun: ebMaxPerRun });
      await saveEventbriteCache(ebCachePath, ebCache);
      console.log(`[ArtistScrape] Eventbrite sweep done -> ${ebConcerts.length} raw events cached across ${Object.keys(ebCache).length} artists.`);
    } else {
      console.log('[ArtistScrape] No artist targets found -- skipping Bandsintown/Eventbrite sweeps.');
    }
  } catch (error: any) {
    console.error(`[ArtistScrape] Critical error: ${error.message}`);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

main();
