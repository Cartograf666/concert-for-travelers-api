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
