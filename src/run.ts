import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfigs, runAllScrapers, ScraperResult, closeBrowser } from './engine/runner.js';
import { loadCache, saveCache } from './engine/cache.js';
import { Concert } from './schemas/concert.js';
import { processConcerts } from './pipeline/process.js';
import { enrichMissingArtistMetadata } from './pipeline/enrich.js';
import { publishConcerts } from './generator/publish.js';

async function main() {
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  const distDir = path.join(process.cwd(), 'dist');
  const reportsDir = path.join(process.cwd(), 'reports');
  const approvedArtistsPath = path.join(process.cwd(), 'data', 'approved_artists.json');

  console.log('[Orchestrator] Starting Daily Concert Scrape...');

  try {
    // 1. Ensure scrapers folder exists
    await fs.mkdir(scrapersDir, { recursive: true });

    // 2. Load configurations
    const configs = await loadConfigs(scrapersDir);
    if (configs.length === 0) {
      console.log('[Orchestrator] No scrapers found in scrapers/. Exiting.');
      // Create empty index.json in dist to avoid client fetch crashes
      await publishConcerts([], distDir);
      return;
    }

    console.log(`[Orchestrator] Loaded ${configs.length} scraper configurations.`);

    // 3. Load the per-venue cache and run scrapers with conditional requests + change detection
    await fs.mkdir(reportsDir, { recursive: true });
    const cachePath = path.join(reportsDir, 'scrape-cache.json');
    const cache = await loadCache(cachePath);

    const results = await runAllScrapers(configs, 5, cache);

    // 4. Build the effective concert set and update the cache. Changed venues use
    //    fresh events; unchanged (304/hash-match) and temporarily-failed venues reuse
    //    their last-good cached events so they never vanish from the output.
    let changedCount = 0;
    const allScrapedConcerts: Partial<Concert>[] = [];
    for (const r of results) {
      if (r.success) {
        if (!r.notModified) changedCount++;
        allScrapedConcerts.push(...r.concerts);
        cache[r.configId] = {
          etag: r.etag,
          lastModified: r.lastModified,
          contentHash: r.contentHash ?? cache[r.configId]?.contentHash ?? '',
          scrapedAt: r.scrapedAt,
          concerts: r.concerts
        };
      } else {
        const cached = cache[r.configId];
        if (cached) {
          console.warn(`[Orchestrator] ${r.configId} failed (${r.reason}); reusing ${cached.concerts.length} cached events.`);
          allScrapedConcerts.push(...cached.concerts);
        }
      }
    }
    await saveCache(cachePath, cache);
    console.log(`[Orchestrator] ${changedCount}/${configs.length} venues changed since last run.`);

    // 5. Always record failures for the separate self-healing run.
    const failures = results
      .filter((r) => !r.success)
      .map((r) => ({
        id: r.configId,
        configPath: path.join(scrapersDir, `${r.configId}.json`),
        error: r.error,
        reason: r.reason,
        htmlSample: r.htmlSample
      }));
    const failLogPath = path.join(reportsDir, 'fail-log.json');
    await fs.writeFile(failLogPath, JSON.stringify(failures, null, 2), 'utf-8');

    // 6. Short-circuit: if no venue changed (and no uncached venue needs publishing),
    //    the published output is already current — skip normalization, enrichment,
    //    and publish entirely so a daily run does nothing when nothing updated.
    const failureWithoutCache = results.some((r) => !r.success && !(cache[r.configId]?.concerts?.length));
    if (changedCount === 0 && !failureWithoutCache) {
      console.log('[Orchestrator] No venue changed — skipping normalization, enrichment, and publish.');
      console.log(`[Orchestrator] Scrape complete (no-op). Failures logged: ${failures.length}.`);
      return;
    }

    console.log(`[Orchestrator] Gathered ${allScrapedConcerts.length} raw events before processing.`);

    // Anchor both normalization passes to a single instant so relative/year-less
    // dates and their dedupe keys stay identical even if the run crosses midnight.
    const runDate = new Date().toISOString();

    // 7. First-pass normalization and deduplication
    let normalizedConcerts = await processConcerts(allScrapedConcerts, approvedArtistsPath, runDate);
    console.log(`[Orchestrator] First pass: parsed ${normalizedConcerts.length} valid events.`);

    // 8. JIT Metadata Enrichment (if API Key is present)
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const touringArtists = Array.from(new Set(normalizedConcerts.map((c) => c.artist)));
      console.log(`[Orchestrator] Running JIT metadata enrichment for ${touringArtists.length} active artists...`);
      await enrichMissingArtistMetadata(touringArtists, approvedArtistsPath, apiKey);

      // Re-run normalization to pick up updated website and social links from disk
      normalizedConcerts = await processConcerts(allScrapedConcerts, approvedArtistsPath, runDate);
      console.log(`[Orchestrator] Second pass (post-enrichment): loaded updated metadata.`);
    } else {
      console.log('[Orchestrator] GEMINI_API_KEY not found. Skipping JIT metadata enrichment.');
    }

    // 9. Write static API files to dist/
    await publishConcerts(normalizedConcerts, distDir);

    console.log(`[Orchestrator] Scrape complete. Successful scrapers: ${configs.length - failures.length}/${configs.length}.`);
    console.log(`[Orchestrator] Failed scrapers log saved to: ${failLogPath}`);

  } catch (error: any) {
    console.error(`[Orchestrator] Critical error during scrape run: ${error.message}`);
    process.exit(1);
  } finally {
    // No-op if no 'playwright_render' scraper ran this run (browser never launched).
    await closeBrowser();
  }
}

main();
