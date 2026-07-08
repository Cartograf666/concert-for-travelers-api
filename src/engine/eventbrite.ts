import axios from 'axios';
import * as fs from 'fs/promises';
import { Concert } from '../schemas/concert.js';
import { sleep } from './sleep.js';

/**
 * Artist-keyed concert sweep over Eventbrite's public discovery search pages.
 *
 * Eventbrite shut off its public multi-organizer events-search API for third
 * parties in Dec 2019 (v3 API is now scoped to events you already know the
 * id/venue/organization for). The only remaining route to "what's playing" is
 * scraping the public `/d/<location>/<query>/` discovery pages, which embed a
 * `window.__SERVER_DATA__` JSON blob with the same results the page renders --
 * no need to parse HTML markup, just extract and JSON.parse that blob. NOTE:
 * Eventbrite's Terms of Service (section 13.1) explicitly prohibit scraping --
 * this is a deliberate, accepted risk for this source (same legal category as
 * any venue-site scraper here, but against a platform with an explicit,
 * prominent anti-scraping clause). Kept polite/low-volume for that reason: see
 * REQUEST_DELAY_MS and DEFAULT_MAX_ARTISTS_PER_RUN below.
 *
 * Unlike Bandsintown's per-artist endpoint (a real "this artist's events"
 * lookup), Eventbrite's `/d/` search is full-text over its ENTIRE catalog --
 * confirmed live: a "Dropkick Murphys" query surfaced hair-product workshops
 * and golf outings that merely contain the word "Murphy". mapEbResultToConcert
 * requires the queried artist name to LEAD the result's title as a cheap,
 * strong relevance signal before a result is even considered (real
 * primary-artist listings put the headliner name first) -- this trades some
 * recall for materially fewer false positives. The shared cover/tribute-band
 * filter in pipeline/process.ts still applies on top of this for whatever
 * passes that gate, since Eventbrite's own catalog skews heavily toward
 * tribute acts/cover nights for any well-known touring name (also confirmed
 * live: every single first-page result for "Metallica" was a tribute band).
 *
 * Location-scoped, not worldwide: Eventbrite's discovery UI requires a
 * location segment (no bare "everywhere" search exists). Defaults to
 * `united-states`, its by-far largest market -- a scope trim, not full
 * coverage; see BACKLOG.md.
 */

const EB_BASE = 'https://www.eventbrite.com';
const DEFAULT_LOCATION_SLUG = 'united-states';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Heavier per-request cost (a full discovery page, ~700KB) and a real ToS-risk
// scrape (not a licensed API) -- more conservative than Bandsintown's spacing.
const REQUEST_DELAY_MS = 2500;

// Deliberately smaller than Bandsintown's per-run cap for the same reason.
const DEFAULT_MAX_ARTISTS_PER_RUN = 300;

// Tour dates don't change hour to hour -- same freshness window as Bandsintown.
const DEFAULT_FRESHNESS_DAYS = 6;

// Stop the sweep after this many consecutive failures -- likely blocked/rate
// limited; remaining artists fall back to their cached results.
const BLOCK_STREAK_LIMIT = 5;


function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface EventbriteCache {
  [artistName: string]: {
    fetchedAt: string;
    concerts: Partial<Concert>[];
  };
}

export async function loadEventbriteCache(cachePath: string): Promise<EventbriteCache> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveEventbriteCache(cachePath: string, cache: EventbriteCache): Promise<void> {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

interface EbAddress {
  city?: string;
  country?: string;
  latitude?: string;
  longitude?: string;
}

interface EbVenue {
  name?: string | null;
  address?: EbAddress | null;
}

interface EbResult {
  name?: string;
  url?: string;
  start_date?: string;
  start_time?: string;
  is_online_event?: boolean;
  primary_venue?: EbVenue | null;
}

/** Extracts and parses the page's embedded `window.__SERVER_DATA__` JSON blob. */
export function extractEbServerData(html: string): any | null {
  const m = html.match(/window\.__SERVER_DATA__\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

export function mapEbResultToConcert(result: EbResult, queriedArtist: string, scrapedAt: string): Partial<Concert> | null {
  if (result.is_online_event) return null; // not a real touring date

  const title = result.name?.trim();
  if (!title) return null;

  // See file docstring: cheap relevance pre-filter before this ever reaches the
  // shared whitelist matcher, given how noisy Eventbrite's full-text search is.
  const leadsWithQueriedName = new RegExp(`^${escapeRegex(queriedArtist.trim())}\\b`, 'i').test(title);
  if (!leadsWithQueriedName) return null;

  const venue = result.primary_venue;
  const addr = venue?.address;
  if (!venue?.name || !addr?.city || !addr?.country || !result.start_date) return null;

  const lat = addr.latitude ? parseFloat(addr.latitude) : undefined;
  const lng = addr.longitude ? parseFloat(addr.longitude) : undefined;

  return {
    // The raw title, not the queried name -- so the shared cover/tribute-band
    // filter downstream (process.ts) still gets a chance to reject e.g.
    // "Metallica Tribute by Battery" even though it leads with "Metallica".
    artist: title,
    date: result.start_date,
    startTime: result.start_time ? result.start_time.slice(0, 5) : undefined,
    venue: venue.name,
    city: addr.city,
    country: addr.country,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    ticketUrl: result.url,
    originalSource: 'eventbrite.com',
    scrapedAt
  };
}

export type EbFetchFn = (artist: string, locationSlug: string, baseUrl: string) => Promise<EbResult[]>;

const defaultEbFetch: EbFetchFn = async (artist, locationSlug, baseUrl) => {
  const url = `${baseUrl}/d/${encodeURIComponent(locationSlug)}/${encodeURIComponent(artist)}/`;
  const res = await axios.get(url, {
    timeout: 20000,
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' }
  });
  const html = typeof res.data === 'string' ? res.data : String(res.data);
  const data = extractEbServerData(html);
  if (!data) {
    // Page structure changed, or the request was soft-blocked (e.g. an anti-bot
    // challenge page instead of the real discovery page) -- treat as a failure
    // so it counts toward the block-streak rather than silently looking like
    // "genuinely zero results".
    throw new Error('Could not find/parse window.__SERVER_DATA__ in the Eventbrite response.');
  }
  return data?.search_data?.events?.results ?? [];
};

export interface EventbriteSweepOptions {
  locationSlug?: string;
  cache?: EventbriteCache;
  maxPerRun?: number;
  freshnessDays?: number;
  baseUrl?: string;
  fetchFn?: EbFetchFn;
  delayMs?: number;
}

/**
 * Artist-keyed sweep over Eventbrite's public discovery search, same
 * batched/resumable/cache-fallback shape as fetchBandsintownConcerts (see that
 * function's docstring for the general pattern -- stalest-first ordering,
 * per-run cap, block-streak detection falling back to cache).
 */
export async function fetchEventbriteConcerts(
  artists: string[],
  options: EventbriteSweepOptions = {}
): Promise<Partial<Concert>[]> {
  const locationSlug = options.locationSlug || process.env.EVENTBRITE_LOCATION_SLUG || DEFAULT_LOCATION_SLUG;
  const cache = options.cache ?? {};
  const maxPerRun = options.maxPerRun ?? DEFAULT_MAX_ARTISTS_PER_RUN;
  const freshnessDays = options.freshnessDays ?? DEFAULT_FRESHNESS_DAYS;
  const baseUrl = options.baseUrl ?? EB_BASE;
  const fetchFn = options.fetchFn ?? defaultEbFetch;
  const delayMs = options.delayMs ?? REQUEST_DELAY_MS;

  const scrapedAt = new Date().toISOString();
  const freshCutoff = Date.now() - freshnessDays * 24 * 60 * 60 * 1000;

  const unique = Array.from(new Set(artists.map((a) => a.trim()).filter(Boolean)));
  const staleness = (name: string): number => {
    const c = cache[name];
    if (!c) return -Infinity;
    return new Date(c.fetchedAt).getTime();
  };
  const ordered = [...unique].sort((a, b) => staleness(a) - staleness(b));

  let fetched = 0;
  let blockStreak = 0;
  let stopped = false;

  for (const artist of ordered) {
    if (stopped) break;
    if (fetched >= maxPerRun) break;

    const cached = cache[artist];
    if (cached && new Date(cached.fetchedAt).getTime() > freshCutoff) {
      continue;
    }

    try {
      const results = await fetchFn(artist, locationSlug, baseUrl);
      const concerts: Partial<Concert>[] = [];
      for (const r of results) {
        const c = mapEbResultToConcert(r, artist, scrapedAt);
        if (c) concerts.push(c);
      }
      cache[artist] = { fetchedAt: scrapedAt, concerts };
      blockStreak = 0;
      fetched++;
      await sleep(delayMs);
    } catch (err: any) {
      blockStreak++;
      console.warn(`[Eventbrite] ${artist} failed (${err.response?.status ?? err.message}); streak ${blockStreak}/${BLOCK_STREAK_LIMIT}. Keeping any cached events.`);
      if (blockStreak >= BLOCK_STREAK_LIMIT) {
        console.error(`[Eventbrite] ${BLOCK_STREAK_LIMIT} consecutive failures -- likely throttled/blocked. Stopping this run; remaining artists use cached events.`);
        stopped = true;
      }
    }
  }

  const all: Partial<Concert>[] = [];
  for (const entry of Object.values(cache)) {
    all.push(...entry.concerts);
  }

  console.log(`[Eventbrite] Fetched ${fetched} artists this run (cap ${maxPerRun}); ${Object.keys(cache).length} cached total -> ${all.length} raw events.`);
  return all;
}
