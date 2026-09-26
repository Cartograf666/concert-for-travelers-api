import axios from 'axios';
import * as fs from 'fs/promises';
import { Concert } from '../schemas/concert.js';
import { buildArtistSweepSourceHealth, type SourceHealthReport } from '../observability/source_health.js';
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
    fetchedAt?: string;
    attemptedAt?: string;
    verifiedAt?: string;
    lastOutcome?: 'events' | 'empty' | 'failed';
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
  /** Injected clock keeps health/freshness tests deterministic. */
  now?: () => Date;
  /** Optional reporting hook. It cannot affect sweep cadence or output. */
  onHealth?: (report: SourceHealthReport) => void;
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

  const runNow = options.now?.() ?? new Date();
  const scrapedAt = runNow.toISOString();
  const freshCutoff = runNow.getTime() - freshnessDays * 24 * 60 * 60 * 1000;

  const unique = Array.from(new Set(artists.map((a) => a.trim()).filter(Boolean)));
  const staleness = (name: string): number => {
    const c = cache[name];
    if (!c) return -Infinity;
    const time = c.fetchedAt ? new Date(c.fetchedAt).getTime() : Number.NaN;
    return Number.isFinite(time) ? time : -Infinity;
  };
  const ordered = [...unique].sort((a, b) => staleness(a) - staleness(b));
  // Count every cadence-fresh target, including ones after the request cap would
  // stop the loop. This is reporting-only and does not alter request selection.
  const skippedFresh = unique.filter((artist) => {
    const fetchedAt = cache[artist]?.fetchedAt;
    return fetchedAt !== undefined && new Date(fetchedAt).getTime() > freshCutoff;
  }).length;

  let fetched = 0;
  let attempted = 0;
  let empty = 0;
  let failed = 0;
  let cacheFallbacks = 0;
  let lastError = '';
  let blockStreak = 0;
  let stopped = false;
  const verifiedThisRun = new Set<string>();
  const issueCounts = new Map<string, number>();
  const addIssue = (reason: string) => issueCounts.set(reason, (issueCounts.get(reason) ?? 0) + 1);

  for (const artist of ordered) {
    if (stopped) break;
    if (fetched >= maxPerRun) break;

    const cached = cache[artist];
    if (cached?.fetchedAt && new Date(cached.fetchedAt).getTime() > freshCutoff) {
      continue;
    }

    attempted++;
    try {
      const results = await fetchFn(artist, locationSlug, baseUrl);
      const concerts: Partial<Concert>[] = [];
      for (const r of results) {
        const c = mapEbResultToConcert(r, artist, scrapedAt);
        if (c) concerts.push(c);
      }
      cache[artist] = {
        fetchedAt: scrapedAt,
        attemptedAt: scrapedAt,
        verifiedAt: scrapedAt,
        lastOutcome: concerts.length > 0 ? 'events' : 'empty',
        concerts
      };
      if (concerts.length === 0) empty++;
      verifiedThisRun.add(artist);
      blockStreak = 0;
      fetched++;
      await sleep(delayMs);
    } catch (err: any) {
      blockStreak++;
      failed++;
      if (cache[artist]) {
        cacheFallbacks++;
        cache[artist] = { ...cache[artist], attemptedAt: scrapedAt, lastOutcome: 'failed' };
      }
      const status = err.response?.status;
      const category = status === 405 ? 'method_not_allowed'
        : status === 429 ? 'rate_limited'
          : typeof status === 'number' && status >= 500 ? 'source_server_error'
            : /SERVER_DATA/.test(String(err.message)) ? 'response_format_changed' : 'request_failed';
      addIssue(category);
      lastError = String(err.response?.status ?? err.message);
      console.warn(`[Eventbrite] ${artist} failed (${lastError}); streak ${blockStreak}/${BLOCK_STREAK_LIMIT}. Keeping any cached events.`);
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

  // Falling back to cache on failure is deliberate -- a transient block must not
  // wipe an artist's dates. But that fallback also made a PERMANENTLY broken
  // source indistinguishable from a throttled one: every request could fail,
  // every run, and the job still succeeded while quietly republishing stale
  // cached events forever. A run where nothing at all succeeded is not
  // throttling, so it is raised as a workflow annotation rather than a log line.
  if (attempted > 0 && fetched === 0) {
    console.log(
      `::error::[Eventbrite] every one of ${attempted} request(s) failed this run (last: ${lastError}). ` +
      `Republishing cached events only -- if this repeats, the source is broken rather than throttled.`
    );
  }

  const report = buildArtistSweepSourceHealth('eventbrite', unique, cache, {
    selected: attempted,
    attempted,
    succeeded: fetched,
    failed,
    empty,
    unavailable: 0,
    skippedFresh,
    cacheFallbacks,
    haltedCategory: stopped ? 'consecutive_failures' : undefined,
    issues: Array.from(issueCounts, ([reason, count]) => ({
      reason,
      count,
      action: reason === 'rate_limited' ? 'wait_for_source_cooldown'
        : reason === 'method_not_allowed' || reason === 'response_format_changed' ? 'inspect_source_access_or_format'
          : 'retry_next_scheduled_sweep'
    })),
    verifiedThisRun
  }, { generatedAt: scrapedAt, revisitIntervalDays: freshnessDays });
  options.onHealth?.(report);

  return all;
}
