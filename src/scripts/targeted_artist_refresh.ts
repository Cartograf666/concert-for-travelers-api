import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadArtistTargets } from '../run-artists.js';
import { fetchBandsintownConcerts, loadBandsintownCache, saveBandsintownCache } from '../engine/bandsintown.js';
import type { SourceHealthReport } from '../observability/source_health.js';

/** Explicit operator revalidation only; never a fallback to the full sweep. */
export async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Targeted refresh requires an explicit workflow_dispatch');
  }
  const requested: unknown = JSON.parse(process.env.ARTIST_TARGET_NAMES_JSON ?? '');
  if (!Array.isArray(requested) || requested.length === 0 ||
      requested.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('artist_names_json must be a nonempty JSON array of nonempty strings');
  }
  const maxPerRun = Number(process.env.BANDSINTOWN_MAX_PER_RUN ?? '800');
  if (!Number.isSafeInteger(maxPerRun) || maxPerRun < 1 || maxPerRun > 800) {
    throw new Error('BANDSINTOWN_MAX_PER_RUN must be an integer from 1 to 800');
  }
  const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const roster = await loadArtistTargets(path.join(process.cwd(), 'data', 'artist_scrape_targets.txt'));
  const canonical = new Map(roster.map((name) => [normalize(name), name]));
  const targets = new Set<string>();
  for (const name of requested as string[]) {
    const target = canonical.get(normalize(name));
    if (!target) throw new Error(`Unknown or ineligible artist: ${name}`);
    targets.add(target);
  }
  if (targets.size > maxPerRun) throw new Error(`Requested unique artists exceed per-run cap ${maxPerRun}`);

  const reportsDir = path.join(process.cwd(), 'reports');
  const cachePath = path.join(reportsDir, 'bandsintown-cache.json');
  // The normal loader tolerates missing/corrupt caches. A manual subset must
  // fail closed instead: publishing a subset as the whole cache would lose data.
  const restored: unknown = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  if (!restored || typeof restored !== 'object' || Array.isArray(restored) ||
      Object.values(restored).some((entry) => !entry || typeof entry !== 'object' || !Array.isArray(entry.concerts))) {
    throw new Error('Targeted refresh requires a valid restored full Bandsintown cache');
  }
  const cache = await loadBandsintownCache(cachePath);
  if (!isDeepStrictEqual(cache, restored)) throw new Error('Bandsintown cache changed or could not be fully loaded');
  let health: SourceHealthReport | undefined;
  await fetchBandsintownConcerts([...targets], {
    cache,
    maxPerRun,
    // Manual repair deliberately adds up to the requested number of HTTP calls,
    // including recently verified feeds. Scheduled six-day cadence is unchanged.
    freshnessDays: 0,
    onHealth: (report) => { health = report; }
  });
  if (!health) throw new Error('Collector did not report targeted refresh results');
  const result = health as SourceHealthReport;
  const artists = [...targets].map((artist) => ({
    artist,
    refreshed: cache[artist]?.verifiedAt === result.generatedAt &&
      (cache[artist]?.lastOutcome === 'events' || cache[artist]?.lastOutcome === 'empty'),
    attemptedAt: cache[artist]?.attemptedAt,
    verifiedAt: cache[artist]?.verifiedAt,
    lastOutcome: cache[artist]?.lastOutcome
  }));
  const success = result.counts.attempted === targets.size &&
    result.counts.succeeded === targets.size && artists.every((artist) => artist.refreshed);
  await saveBandsintownCache(cachePath, cache);
  await fs.writeFile(path.join(reportsDir, 'targeted-artist-refresh.json'), JSON.stringify({
    schemaVersion: 1,
    scope: 'manual_targeted_bandsintown',
    success,
    artists,
    health: result
  }, null, 2), 'utf8');
  // Failure/partial runs still persist truthful attemptedAt and last-good data.
  // Invalid input and missing restoration never enable the Actions cache save.
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, 'cache_updated=true\n');
  if (!success) throw new Error('Targeted refresh incomplete; inspect reports/targeted-artist-refresh.json');
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
