import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfigs, runAllScrapers, ScraperResult, closeBrowser } from './engine/runner.js';
import { loadCache, saveCache, isCacheStale } from './engine/cache.js';
import { Concert } from './schemas/concert.js';
import { processConcerts, stampLastConcertSeenAt } from './pipeline/process.js';
import { geocodeConcerts, loadGeocodeCacheWithBackup, saveGeocodeCache } from './pipeline/geocode.js';
import { getLlmFallbackUsageSummary } from './engine/llm_extraction_fallback.js';
import { publishConcerts, publishArtistCatalog } from './generator/publish.js';
import { publishChangelog, loadChangelogCache, saveChangelogCache } from './generator/changelog.js';
import { fetchTicketmasterConcerts, loadTicketmasterCache, saveTicketmasterCache } from './engine/ticketmaster.js';
import { PRODUCTION_ARTIST_DB_DIR, saveApprovedArtists } from './pipeline/artistDb.js';
import { buildRunManifest, hashRunConfigs, readRunManifest, sourceHealth, writeRunManifest } from './observability/run_manifest.js';

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

/**
 * The repair workflow commits its durable lifecycle records to main. Summarise
 * that history for the public status without exposing old configs or diagnostics.
 */
async function loadRepairHealth(): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(process.cwd(), 'data', 'repair-history.json'), 'utf-8'));
    if (!Array.isArray(raw)) throw new Error('repair history is not an array');
    const entries = raw.filter((entry): entry is { status?: string; repairedAt?: string } => Boolean(entry && typeof entry === 'object'));
    const statuses = entries.reduce<Record<string, number>>((counts, entry) => {
      const status = entry.status ?? 'unknown';
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});
    const attempts = entries.map((entry) => entry.repairedAt).filter((at): at is string => typeof at === 'string').sort();
    return {
      schemaVersion: 1,
      state: (statuses.pending ?? 0) > 0 ? 'pending_confirmation' : 'no_pending_confirmation',
      tracked: entries.length,
      byStatus: statuses,
      latestAttemptAt: attempts.at(-1) ?? null
    };
  } catch {
    return { schemaVersion: 1, state: 'unavailable' };
  }
}

async function writeStatus(
  distDir: string,
  results: ScraperResult[],
  changedCount: number,
  ticketmasterCount: number,
  publishedConcerts: number | null,
  staleVenueIds: string[],
  artistManifest: Awaited<ReturnType<typeof readRunManifest>>
): Promise<void> {
  const failed = results.filter((r) => !r.success);
  const status = {
    // Flat fields below are kept for existing API consumers. New clients should
    // prefer the grouped, versioned health surfaces.
    schemaVersion: 2,
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
    conflictDropsLast7Days: await countRecentConflictDrops(7),
    sources: {
      venue: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        cohort: 'venue',
        total: results.length,
        succeeded: results.length - failed.length,
        failed: failed.length,
        changed: changedCount,
        unchanged: results.filter((r) => r.success && r.notModified).length,
        stale: staleVenueIds.length
      },
      // The artist workflow owns this manifest. A missing value is normal on a
      // first deployment or when its cache was evicted, and must not masquerade
      // as a successful artist scrape.
      artist: sourceHealth(artistManifest)
    },
    publication: {
      schemaVersion: 1,
      state: publishedConcerts === null ? 'no_changes' : 'pending_health_gate',
      generatedAt: new Date().toISOString(),
      publishedConcerts,
      healthGate: { state: 'not_evaluated' }
    },
    repair: await loadRepairHealth()
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
        // Repo-relative: heal.ts and prune_dead_scrapers.ts resolve this against
        // cwd, and run-artists.ts emits the same field pointing into
        // scrapers/artists/. An absolute path happened to work only because both
        // sides ran from the same checkout directory.
        configPath: path.join('scrapers', `${r.configId}.json`),
        error: r.error,
        reason: r.reason,
        htmlSample: r.htmlSample
      }));
    const failLogPath = path.join(reportsDir, 'fail-log.json');
    await fs.writeFile(failLogPath, JSON.stringify(failures, null, 2), 'utf-8');

    // 6. Record health independently from publication. Even unchanged venue data
    // must be reprocessed: artist caches, metadata and the UTC day can change.
    // Venues whose events are served from a cache older than the staleness bound
    // (a scraper that broke long ago still serving frozen shows) — surfaced in status.json.
    const nowMs = Date.now();
    const staleVenueIds = results
      .filter((r) => isCacheStale(cache[r.configId], nowMs))
      .map((r) => r.configId);
    if (staleVenueIds.length) {
      console.warn(`[Orchestrator] ${staleVenueIds.length} venue(s) served from stale cache: ${staleVenueIds.join(', ')}`);
    }
    const venueConfigHashes = await hashRunConfigs(scrapersDir, results.map((result) => result.configId));
    const venueManifest = buildRunManifest('venue', results, {
      changed: changedCount,
      staleIds: staleVenueIds,
      configHashes: venueConfigHashes
    });
    const venueManifestPath = await writeRunManifest(reportsDir, venueManifest);
    const artistManifest = await readRunManifest(reportsDir, 'artist');
    console.log(`[Orchestrator] Venue run manifest saved to: ${venueManifestPath}`);

    console.log(`[Orchestrator] Gathered ${allScrapedConcerts.length} raw events before processing.`);

    // Anchor normalization and activity stamps to one instant.
    const runDate = new Date().toISOString();

    // 7. First-pass normalization and deduplication. Explicit start/duration logs
    // here since this step (whitelist matching against 60k+ entries, times however
    // many raw events came in) can take long enough on a big run to otherwise look
    // like the job hung between "Gathered N raw events" and the next line.
    console.log(`[Orchestrator] Matching ${allScrapedConcerts.length} raw events against the approved-artist whitelist...`);
    // Reused by the catalog step further down so it
    // doesn't need its own separate read+parse of the same ~63k-entry file.
    let approvedArtistsSnapshot: any[] = [];
    const captureApprovedArtists = (a: any[]) => { approvedArtistsSnapshot = a; };

    let passStart = Date.now();
    const normalizedConcerts = await processConcerts(allScrapedConcerts, approvedArtistsPath, runDate, captureApprovedArtists);
    console.log(`[Orchestrator] First pass: parsed ${normalizedConcerts.length} valid events (${((Date.now() - passStart) / 1000).toFixed(1)}s).`);

    // 8. Network enrichment runs separately. Publication only applies the shared
    // geocode cache; new places stay pending until backfill and a later publish.
    const geocodeCachePath = path.join(reportsDir, 'geocode-cache.json');
    const geocodeBackupPath = path.join(reportsDir, 'geocode-cache-backup.json');
    const geocodeCache = await loadGeocodeCacheWithBackup(geocodeCachePath, geocodeBackupPath);
    // Kept outside the Pages payload; saved with the last-good publication cache
    // so eviction of the primary geocode cache cannot erase known coordinates.
    await saveGeocodeCache(geocodeBackupPath, geocodeCache);
    passStart = Date.now();
    const geoStats = await geocodeConcerts(normalizedConcerts, { cache: geocodeCache, maxPerRun: 0 });
    console.log(
      `[Orchestrator] Geocoding: ${geoStats.geocoded} geocoded, ${geoStats.filledFromCache} from cache, ` +
      `${geoStats.failed} failed/unresolved, ${geoStats.skippedCapped} deferred to next run ` +
      `(${((Date.now() - passStart) / 1000).toFixed(1)}s).`
    );

    const stampedArtists = stampLastConcertSeenAt(approvedArtistsSnapshot, normalizedConcerts, runDate);
    if (stampedArtists > 0) {
      await saveApprovedArtists(approvedArtistsPath, approvedArtistsSnapshot);
      console.log(`[Orchestrator] Stamped lastConcertSeenAt for ${stampedArtists} artist(s).`);
    }

    // 9. Write static API files to dist/
    console.log(`[Orchestrator] Publishing ${normalizedConcerts.length} concerts to ${distDir}...`);
    await publishConcerts(normalizedConcerts, distDir);
    await writeStatus(distDir, results, changedCount, ticketmasterCount, normalizedConcerts.length, staleVenueIds, artistManifest);

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
    console.log(`[Orchestrator] ${getLlmFallbackUsageSummary()}`);

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
