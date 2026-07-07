import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfigs, runAllScrapers, closeBrowser } from './engine/runner.js';
import { loadCache, saveCache } from './engine/cache.js';

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

    console.log(`[ArtistScrape] Done. ${changedCount}/${configs.length} changed, ${failedCount} failed. Cache saved to ${cachePath}.`);
  } catch (error: any) {
    console.error(`[ArtistScrape] Critical error: ${error.message}`);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

main();
