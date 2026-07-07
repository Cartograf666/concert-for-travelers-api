import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { Concert } from '../schemas/concert.js';

/**
 * Per-venue scrape cache. Lets a daily run detect that a venue's schedule is
 * unchanged since last time and skip re-processing it, and lets a temporarily
 * unreachable venue fall back to its last-good events instead of vanishing.
 */
export interface VenueCache {
  etag?: string;
  lastModified?: string;
  contentHash: string;
  scrapedAt: string;
  concerts: Partial<Concert>[];
}

export type ScrapeCache = Record<string, VenueCache>;

/**
 * Stable content hash of a venue's PARSED events (not the raw HTML, which carries
 * volatile CSRF tokens / timestamps / ads). Order-independent.
 */
export function hashConcerts(concerts: Partial<Concert>[]): string {
  const norm = concerts
    .map((c) => `${c.artist ?? ''}|${c.date ?? ''}|${c.venue ?? ''}|${c.city ?? ''}|${c.ticketUrl ?? ''}`)
    .sort()
    .join('\n');
  return createHash('sha1').update(norm).digest('hex');
}

export async function loadCache(cachePath: string): Promise<ScrapeCache> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    return {}; // missing or unreadable cache -> start fresh
  }
}

export async function saveCache(cachePath: string, cache: ScrapeCache): Promise<void> {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * The daily run may skip normalization/enrichment/publish only when nothing a consumer
 * would see has changed: no venue changed content, no Ticketmaster events this run, and
 * no failed venue that lacks cached events to fall back on (which would otherwise silently
 * drop that venue from the published set). Extracted + exported so this gate — which
 * decides whether the whole job is a no-op — is unit-testable. Takes a structural result
 * shape to avoid a circular import on runner's ScraperResult.
 */
export function shouldSkipPublish(
  results: { success: boolean; configId: string }[],
  cache: ScrapeCache,
  changedCount: number,
  ticketmasterCount: number
): boolean {
  const failureWithoutCache = results.some((r) => !r.success && !(cache[r.configId]?.concerts?.length));
  return changedCount === 0 && ticketmasterCount === 0 && !failureWithoutCache;
}

// After this long without a successful fetch, a venue's cached events are "stale" — a
// scraper that broke weeks ago is still serving frozen (often past-dated) shows. We don't
// silently drop them (that's the pipeline's past-date filter's job), but we surface them
// so a dead scraper is visible in status.json instead of hiding behind the health gate.
export const MAX_CACHE_STALENESS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isCacheStale(entry: VenueCache | undefined, nowMs: number): boolean {
  if (!entry) return false;
  const t = Date.parse(entry.scrapedAt);
  if (Number.isNaN(t)) return false; // no/invalid stamp -> can't judge, don't flag
  return nowMs - t > MAX_CACHE_STALENESS_MS;
}
