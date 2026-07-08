import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfigs, runAllScrapers, ScraperResult, closeBrowser } from './engine/runner.js';
import { loadCache, saveCache, shouldSkipPublish, isCacheStale } from './engine/cache.js';
import { Concert } from './schemas/concert.js';
import { processConcerts } from './pipeline/process.js';
import { enrichMissingArtistMetadata } from './pipeline/enrich.js';
import { geocodeConcerts, loadGeocodeCache, saveGeocodeCache } from './pipeline/geocode.js';
import { getGeminiKeys } from './engine/gemini_keys.js';
import { publishConcerts, publishArtistCatalog } from './generator/publish.js';
import { publishChangelog, loadChangelogCache, saveChangelogCache } from './generator/changelog.js';
import { fetchTicketmasterConcerts, loadTicketmasterCache, saveTicketmasterCache } from './engine/ticketmaster.js';
import { PRODUCTION_ARTIST_DB_DIR } from './pipeline/artistDb.js';

/**
 * Writes dist/status.json — a small machine-readable health surface so a watchdog /
 * dashboard can tell whether the daily run is healthy or silently rotting (venues
 * failing, everything served from stale cache) without scraping the Actions logs.
 */
/**
 * Counts recent entries in data/conflict-drops.json (see
 * src/scripts/record_conflict_drop.ts) -- a previously silent failure mode (a
 * workflow's git-push retry loop giving up on an unresolvable rebase conflict,
 * logged only as a `::warning::` annotation) surfaced here instead, so a rising
 * count is visible on the dashboard rather than buried in Actions logs.
 * Best-effort: a missing/unreadable file just means zero, not a failure.
 */
async function countRecentConflictDrops(days: number): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'data', 'conflict-drops.json'), 'utf-8');
    const data: { events?: Array<{ at: string }> } = JSON.parse(raw);
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return (data.events ?? []).filter((e) => new Date(e.at).getTime() > cutoffMs).length;
  } catch {
    return 0;
  }
}

async function writeStatus(
  distDir: string,
  results: ScraperResult[],
  changedCount: number,
  ticketmasterCount: number,
  publishedConcerts: number | null,
  staleVenueIds: string[]
): Promise<void> {
  const failed = results.filter((r) => !r.success);
  const status = {
    generatedAt: new Date().toISOString(),
    scrapersTotal: results.length,
    scrapersOk: results.length - failed.length,
    scrapersFailed: failed.length,
    venuesChanged: changedCount,
    venuesUnchanged: results.filter((r) => r.success && r.notModified).length,
    failedVenueIds: failed.map((r) => r.configId),
    // Venues whose events are being served from a cache older than the staleness
    // bound — a scraper that broke weeks ago hiding behind the health gate.
    staleVenues: staleVenueIds,
    ticketmasterEvents: ticketmasterCount,
    publishedConcerts, // null when the run short-circuited (published set unchanged)
    conflictDropsLast7Days: await countRecentConflictDrops(7)
  };
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(distDir, 'status.json'), JSON.stringify(status, null, 2), 'utf-8');
}

async function main() {
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  const distDir = path.join(process.cwd(), 'dist');
  const reportsDir = path.join(process.cwd(), 'reports');
  const approvedArtistsPath = PRODUCTION_ARTIST_DB_DIR;

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

    // 4b. Ticketmaster Discovery API sweep -- a broad additive source alongside the
    // per-venue scrapers, covering many venues Ticketmaster itself already tracks
    // in one paginated pass per country instead of one scraper config per venue.
    // Goes through the same approved-artist whitelist filter as everything else.
    let ticketmasterCount = 0;
    const tmApiKey = process.env.TICKETMASTER_API_KEY;
    if (tmApiKey) {
      const tmCachePath = path.join(reportsDir, 'ticketmaster-cache.json');
      const tmCache = await loadTicketmasterCache(tmCachePath);
      const tmConcerts = await fetchTicketmasterConcerts(tmApiKey, undefined, undefined, tmCache);
      await saveTicketmasterCache(tmCachePath, tmCache);
      ticketmasterCount = tmConcerts.length;
      allScrapedConcerts.push(...tmConcerts);
    } else {
      console.log('[Orchestrator] TICKETMASTER_API_KEY not found. Skipping Ticketmaster sweep.');
    }

    // 4c. Artist tour-page scrapers (scrapers/artists/*.json) run on their own,
    // less-frequent schedule (see artist-scrape.yml) -- there can be hundreds of
    // them, and re-fetching every one daily alongside venues + Ticketmaster would
    // blow this job's time budget for little gain (tour dates don't change hour to
    // hour). This job only READS whatever that job last cached, never scrapes
    // artists/ itself, so artist-tour data still flows into today's publish even
    // on a day the artist-scrape job didn't run.
    const artistCache = await loadCache(path.join(reportsDir, 'artist-scrape-cache.json'));
    let artistConcertCount = 0;
    for (const entry of Object.values(artistCache)) {
      allScrapedConcerts.push(...entry.concerts);
      artistConcertCount += entry.concerts.length;
    }
    if (artistConcertCount > 0) {
      console.log(`[Orchestrator] Loaded ${artistConcertCount} cached events from ${Object.keys(artistCache).length} artist tour-page scrapers.`);
    }

    // 4d. Same read-only merge for the Bandsintown artist sweep cache (also owned
    // and written by run-artists.ts / artist-scrape.yml, never by this daily job).
    // Same on-disk shape (values carry a `concerts` array), so loadCache reads it too.
    const bitCache = await loadCache(path.join(reportsDir, 'bandsintown-cache.json'));
    let bitConcertCount = 0;
    for (const entry of Object.values(bitCache)) {
      allScrapedConcerts.push(...entry.concerts);
      bitConcertCount += entry.concerts.length;
    }
    if (bitConcertCount > 0) {
      console.log(`[Orchestrator] Loaded ${bitConcertCount} cached events from ${Object.keys(bitCache).length} Bandsintown artists.`);
    }

    // 4e. Same read-only merge for the Eventbrite artist sweep cache (also owned
    // and written by run-artists.ts / artist-scrape.yml, never by this daily job).
    const ebCache = await loadCache(path.join(reportsDir, 'eventbrite-cache.json'));
    let ebConcertCount = 0;
    for (const entry of Object.values(ebCache)) {
      allScrapedConcerts.push(...entry.concerts);
      ebConcertCount += entry.concerts.length;
    }
    if (ebConcertCount > 0) {
      console.log(`[Orchestrator] Loaded ${ebConcertCount} cached events from ${Object.keys(ebCache).length} Eventbrite artists.`);
    }

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
    //    Ticketmaster has no per-item change-detection cache (it's a fresh sweep
    //    every run), so any Ticketmaster results always count as "changed".
    // Venues whose events are served from a cache older than the staleness bound
    // (a scraper that broke long ago still serving frozen shows) — surfaced in status.json.
    const nowMs = Date.now();
    const staleVenueIds = results
      .filter((r) => isCacheStale(cache[r.configId], nowMs))
      .map((r) => r.configId);
    if (staleVenueIds.length) {
      console.warn(`[Orchestrator] ${staleVenueIds.length} venue(s) served from stale cache: ${staleVenueIds.join(', ')}`);
    }

    if (shouldSkipPublish(results, cache, changedCount, ticketmasterCount)) {
      await writeStatus(distDir, results, changedCount, ticketmasterCount, null, staleVenueIds);
      console.log('[Orchestrator] No venue changed — skipping normalization, enrichment, and publish.');
      console.log(`[Orchestrator] Scrape complete (no-op). Failures logged: ${failures.length}.`);
      return;
    }

    console.log(`[Orchestrator] Gathered ${allScrapedConcerts.length} raw events before processing.`);

    // Anchor both normalization passes to a single instant so relative/year-less
    // dates and their dedupe keys stay identical even if the run crosses midnight.
    const runDate = new Date().toISOString();

    // 7. First-pass normalization and deduplication. Explicit start/duration logs
    // here since this step (whitelist matching against 60k+ entries, times however
    // many raw events came in) can take long enough on a big run to otherwise look
    // like the job hung between "Gathered N raw events" and the next line.
    console.log(`[Orchestrator] Matching ${allScrapedConcerts.length} raw events against the approved-artist whitelist...`);
    // Captured from whichever processConcerts call below runs last (pass2 if JIT
    // enrichment ran, else pass1) -- reused by the catalog step further down so it
    // doesn't need its own separate read+parse of the same ~63k-entry file.
    let approvedArtistsSnapshot: any[] = [];
    const captureApprovedArtists = (a: any[]) => { approvedArtistsSnapshot = a; };

    let passStart = Date.now();
    let normalizedConcerts = await processConcerts(allScrapedConcerts, approvedArtistsPath, runDate, captureApprovedArtists);
    console.log(`[Orchestrator] First pass: parsed ${normalizedConcerts.length} valid events (${((Date.now() - passStart) / 1000).toFixed(1)}s).`);

    // 8. JIT Metadata Enrichment (if any Gemini API key is present)
    const geminiKeys = getGeminiKeys();
    if (geminiKeys.length > 0) {
      const touringArtists = Array.from(new Set(normalizedConcerts.map((c) => c.artist)));
      console.log(`[Orchestrator] Running JIT metadata enrichment for ${touringArtists.length} active artists across ${geminiKeys.length} key(s) (this calls Gemini per batch and can take a while)...`);
      passStart = Date.now();
      await enrichMissingArtistMetadata(touringArtists, approvedArtistsPath, geminiKeys);
      console.log(`[Orchestrator] Enrichment done (${((Date.now() - passStart) / 1000).toFixed(1)}s).`);

      // Re-run normalization to pick up updated website and social links from disk
      passStart = Date.now();
      normalizedConcerts = await processConcerts(allScrapedConcerts, approvedArtistsPath, runDate, captureApprovedArtists);
      console.log(`[Orchestrator] Second pass (post-enrichment): loaded updated metadata (${((Date.now() - passStart) / 1000).toFixed(1)}s).`);
    } else {
      console.log('[Orchestrator] No GEMINI_API_KEY found. Skipping JIT metadata enrichment.');
    }

    // 8b. Guaranteed geocoding: fill lat/lng for every concert still missing them
    // (per-row artist tour-page venues, or any source without coordinates yet), via
    // a persistent cache keyed by venue+city+country so a repeat venue is geocoded
    // at most once across the project's whole lifetime. Capped per run; the cache
    // makes the pending set shrink permanently rather than being an all-or-nothing gate.
    const geocodeCachePath = path.join(reportsDir, 'geocode-cache.json');
    const geocodeCache = await loadGeocodeCache(geocodeCachePath);
    passStart = Date.now();
    const geoStats = await geocodeConcerts(normalizedConcerts, { cache: geocodeCache });
    await saveGeocodeCache(geocodeCachePath, geocodeCache);
    console.log(
      `[Orchestrator] Geocoding: ${geoStats.geocoded} geocoded, ${geoStats.filledFromCache} from cache, ` +
      `${geoStats.failed} failed/unresolved, ${geoStats.skippedCapped} deferred to next run ` +
      `(${((Date.now() - passStart) / 1000).toFixed(1)}s).`
    );

    // 9. Write static API files to dist/
    console.log(`[Orchestrator] Publishing ${normalizedConcerts.length} concerts to ${distDir}...`);
    await publishConcerts(normalizedConcerts, distDir);
    await writeStatus(distDir, results, changedCount, ticketmasterCount, normalizedConcerts.length, staleVenueIds);

    // 9a. Publish dist/changes.json: concerts new since last run, so the consumer
    // can show "N new concerts since your last visit" without diffing all of
    // concerts.json itself. State isn't git-tracked -- same actions/cache
    // mechanism as reports/scrape-cache.json, so it doesn't add another writer
    // to data/approved_artists.json. Best-effort: never let this fail the run.
    try {
      const changelogCachePath = path.join(reportsDir, 'changelog-cache.json');
      const changelogCache = await loadChangelogCache(changelogCachePath);
      const changelogResult = await publishChangelog(normalizedConcerts, distDir, changelogCache);
      await saveChangelogCache(changelogCachePath, changelogCache);
      console.log(
        changelogResult.coldStart
          ? '[Orchestrator] Changelog: first-ever run, seeding known-concerts cache (nothing reported as new).'
          : `[Orchestrator] Changelog: ${changelogResult.newCount} new concert(s) since last run.`
      );
    } catch (err: any) {
      console.warn(`[Orchestrator] Skipped changelog publish: ${err.message}`);
    }

    // 9b. Publish the full artist directory (name/aliases/genres/image/popularity/
    // socials/IDs for every whitelisted artist, not just those with a current
    // concert) -- the consumer app's autocomplete + ID-join source. Best-effort:
    // never let this fail the whole run.
    try {
      await publishArtistCatalog(approvedArtistsSnapshot, distDir);
    } catch (err: any) {
      console.warn(`[Orchestrator] Skipped artist catalog publish: ${err.message}`);
    }

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

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
