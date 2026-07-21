import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { ArtistEntry } from '../schemas/artist.js';

/**
 * `heal.ts` deliberately skips `fetch_error`/`csr_detected`/`circuit_open`
 * failures -- re-selecting CSS selectors can't fix a page that never loaded.
 * Those scrapers just sit failing forever with nothing tracking how long,
 * silently costing daily scrape time and never contributing data. This
 * tracks a consecutive-failure streak per scraper across runs and, once a
 * streak crosses PRUNE_THRESHOLD days, retires the config and resets the
 * matching artist's tourUrl-related markers so discover_tour_urls.ts /
 * extract_tour_scrapers.ts can find and re-generate a fresh one later --
 * rather than leaving a permanently-dead scraper (and a permanently-stale
 * tourUrl) in place forever.
 *
 * Scope: only auto-generated `artist-<slug>` scrapers (extract_tour_scrapers.ts's
 * own id convention) are eligible for auto-pruning. Hand-authored venue
 * scrapers and the small set of manually-authored artist tour-page scrapers
 * (which use descriptive ids, not the artist-<slug> shape) are never touched
 * here -- those went through a human, this only auto-removes what was
 * auto-created without one.
 */
const PRUNE_THRESHOLD = 5;
const ID_RE = /^artist-[a-z0-9][a-z0-9-]{0,80}$/;
const PRUNABLE_REASONS = new Set(['fetch_error', 'csr_detected', 'circuit_open']);

export interface ScraperHealthEntry {
  id: string;
  consecutiveFailures: number;
  lastReason: string;
  firstFailedAt: string;
  lastFailedAt: string;
}

export interface PruneResult {
  pruned: string[];
  stillFailing: string[];
  recovered: string[];
}

function isEligible(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export async function updateScraperHealth(
  healthPath: string,
  failures: Array<{ id: string; reason?: string }>,
  now: string
): Promise<ScraperHealthEntry[]> {
  let health: ScraperHealthEntry[] = [];
  try {
    health = JSON.parse(await fs.readFile(healthPath, 'utf-8'));
  } catch {
    // No prior health file -- start fresh.
  }
  const byId = new Map(health.map((h) => [h.id, h]));

  const failingIds = new Set(
    failures.filter((f) => isEligible(f.id) && PRUNABLE_REASONS.has(f.reason ?? '')).map((f) => f.id)
  );

  // A tracked scraper that's no longer failing (or failing for a different,
  // possibly-fixable reason) recovers -- drop it from the streak tracker
  // entirely rather than let a stale streak linger.
  for (const id of Array.from(byId.keys())) {
    if (!failingIds.has(id)) byId.delete(id);
  }

  for (const failure of failures) {
    if (!isEligible(failure.id) || !PRUNABLE_REASONS.has(failure.reason ?? '')) continue;
    const existing = byId.get(failure.id);
    if (existing) {
      existing.consecutiveFailures += 1;
      existing.lastReason = failure.reason!;
      existing.lastFailedAt = now;
    } else {
      byId.set(failure.id, {
        id: failure.id,
        consecutiveFailures: 1,
        lastReason: failure.reason!,
        firstFailedAt: now,
        lastFailedAt: now
      });
    }
  }

  const updated = Array.from(byId.values());
  await fs.writeFile(healthPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  return updated;
}

async function findArtistScraperConfigDomain(configPath: string): Promise<string | null> {
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    const name = config?.selectors?.artistNameFallback;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export async function pruneDeadScrapers(
  scrapersDir: string,
  healthEntries: ScraperHealthEntry[],
  artistDbDir: string,
  auditPath: string,
  now: string
): Promise<PruneResult> {
  const toPrune = healthEntries.filter((h) => h.consecutiveFailures >= PRUNE_THRESHOLD);
  const stillFailing = healthEntries.filter((h) => h.consecutiveFailures < PRUNE_THRESHOLD).map((h) => h.id);

  if (toPrune.length === 0) {
    return { pruned: [], stillFailing, recovered: [] };
  }

  const artists = await loadApprovedArtists(artistDbDir) as ArtistEntry[];
  // Map to an array of indices, not a single index -- a name collision (two DB
  // entries sharing a case-insensitive name) must never silently pick one and
  // reset the wrong artist's fields. Ambiguous matches are skipped entirely
  // below rather than guessed at.
  const indicesByNameLower = new Map<string, number[]>();
  artists.forEach((a, i) => {
    const key = String(a.name ?? '').toLowerCase();
    const list = indicesByNameLower.get(key);
    if (list) list.push(i);
    else indicesByNameLower.set(key, [i]);
  });

  let audit: any[] = [];
  try {
    audit = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
  } catch {
    // No prior audit file -- start fresh.
  }

  const pruned: string[] = [];
  for (const entry of toPrune) {
    const configPath = path.join(scrapersDir, `${entry.id}.json`);
    const artistName = await findArtistScraperConfigDomain(configPath);

    try {
      await fs.rm(configPath);
    } catch {
      // Already gone -- fine, still reset the artist below.
    }

    if (artistName) {
      const indices = indicesByNameLower.get(artistName.toLowerCase());
      if (indices?.length === 1) {
        const artist = artists[indices[0]];
        delete artist.tourUrl;
        delete artist.tourScraperTriedAt;
        delete artist.tourScraperCreatedAt;
        delete artist.tourUrlProbeTriedAt; // let discover_tour_urls.ts re-probe from scratch
      } else if (indices && indices.length > 1) {
        console.warn(
          `[PruneDeadScrapers] Skipping artist-field reset for "${artistName}" -- ` +
          `${indices.length} DB entries share this name case-insensitively, can't tell ` +
          `which one owns the pruned scraper without guessing.`
        );
      }
    }

    audit.push({
      id: entry.id,
      artistName,
      reason: entry.lastReason,
      consecutiveFailures: entry.consecutiveFailures,
      firstFailedAt: entry.firstFailedAt,
      prunedAt: now
    });
    pruned.push(entry.id);
  }

  if (pruned.length > 0) {
    await saveApprovedArtists(artistDbDir, artists);
    await fs.writeFile(auditPath, JSON.stringify(audit, null, 2) + '\n', 'utf-8');
  }

  return { pruned, stillFailing, recovered: [] };
}

async function main() {
  const [failLogPath] = process.argv.slice(2);
  if (!failLogPath) {
    console.error('Usage: prune_dead_scrapers.ts <failLogPath>');
    process.exitCode = 1;
    return;
  }

  const now = new Date().toISOString();
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  const healthPath = path.join(process.cwd(), 'data', 'scraper-health.json');
  const auditPath = path.join(process.cwd(), 'data', 'pruned-scrapers.json');

  let failures: any[] = [];
  try {
    failures = JSON.parse(await fs.readFile(failLogPath, 'utf-8'));
  } catch {
    console.log('[PruneDeadScrapers] No fail-log found. Nothing to track.');
    return;
  }
  if (!Array.isArray(failures)) failures = [];

  const health = await updateScraperHealth(healthPath, failures, now);
  const result = await pruneDeadScrapers(scrapersDir, health, PRODUCTION_ARTIST_DB_DIR, auditPath, now);

  console.log(
    `[PruneDeadScrapers] pruned=${result.pruned.length} (${result.pruned.join(', ') || 'none'}), ` +
    `stillTracking=${result.stillFailing.length}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[PruneDeadScrapers] Fatal: ${err.message}`);
    process.exit(1);
  });
}
