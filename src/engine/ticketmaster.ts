import axios from 'axios';
import * as fs from 'fs/promises';
import { Concert } from '../schemas/concert.js';
import {
  buildSourceFreshness,
  emptySourceHealthCounts,
  SOURCE_HEALTH_SCHEMA_VERSION,
  type SourceHealthIssue,
  type SourceHealthReport
} from '../observability/source_health.js';
import { sleep } from './sleep.js';

const DISCOVERY_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

// Discovery API only allows page * size < 1000 for one query. Dense date
// windows must be split before paging; otherwise later events disappear.
const MAX_PAGES_PER_COUNTRY = 5;
const PAGE_SIZE = 200;
const MAX_REQUESTS_PER_SWEEP = 750;
const WINDOW_OVERLAP_MS = 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Free-tier budget is 5000 requests/day; the per-sweep cap leaves room for other
// consumers. The delay also respects the app's lower 100/minute console limit.
const REQUEST_DELAY_MS = 700;

// Countries where Ticketmaster (or its international brands) actually operates.
// Sweeping a country with no real Ticketmaster presence just wastes request
// budget on empty pages. SG/PH confirmed live via a direct Discovery API query
// (classificationName=music): SG had 66 events including The Weeknd and Post
// Malone, PH had 4. The rest of Asia (JP, KR, TH, HK, TW, MY, ID, VN, IN, CN)
// returned 0 in the same check -- Ticketmaster genuinely has little to no
// presence there (Japan in particular runs on Pia/Zaiko, not Ticketmaster) --
// so they're deliberately left out rather than added speculatively.
export const TICKETMASTER_COUNTRIES = [
  'US', 'CA', 'MX', 'GB', 'IE', 'DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'ES', 'PT',
  'IT', 'PL', 'CZ', 'SE', 'NO', 'DK', 'FI', 'AU', 'NZ', 'ZA', 'AE', 'TR', 'SG', 'PH'
];

export interface TicketmasterCache {
  [countryCode: string]: {
    fetchedAt: string;
    /** Last fully successful country sweep; failed/partial passes never advance it. */
    verifiedAt?: string;
    concerts: Partial<Concert>[];
  };
}

export async function loadTicketmasterCache(cachePath: string): Promise<TicketmasterCache> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    return {}; // missing or unreadable cache -> start fresh, no fallback available yet
  }
}

export async function saveTicketmasterCache(cachePath: string, cache: TicketmasterCache): Promise<void> {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

interface TmEvent {
  id?: string;
  name?: string;
  url?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string; dateTBD?: boolean; dateTBA?: boolean };
    status?: { code?: string };
  };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  _embedded?: {
    venues?: Array<{
      name?: string;
      city?: { name?: string };
      country?: { countryCode?: string };
      location?: { latitude?: string; longitude?: string };
    }>;
    attractions?: Array<{ name?: string }>;
  };
}

// A 200 envelope with a valid count can still contain truncated event rows.
// Keep the provider's event identity and date status distinct from the stricter
// fields mapEventToConcert needs; a TBA date or missing venue is a valid row.
function isDiscoveryEvent(value: unknown): value is TmEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as TmEvent;
  const start = event.dates?.start;
  return typeof event.id === 'string' && event.id.trim().length > 0 &&
    typeof event.name === 'string' && event.name.trim().length > 0 &&
    start !== null && typeof start === 'object' && !Array.isArray(start) &&
    (typeof start.localDate === 'string' && start.localDate.trim().length > 0 ||
      typeof start.dateTime === 'string' && start.dateTime.trim().length > 0 ||
      start.dateTBD === true || start.dateTBA === true);
}

// Only structured provider errors are useful here. Never log Axios config,
// request URLs, headers or an unstructured response body (which may echo the key).
function badRequestDetails(data: unknown, apiKey: string): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return '';
  const scrub = (value: string): string => {
    let safe = value.replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]');
    if (apiKey) {
      safe = safe.replaceAll(apiKey, '[REDACTED]')
        .replaceAll(encodeURIComponent(apiKey), '[REDACTED]');
    }
    return safe.replace(/api[_-]?key\s*[=:]\s*[^\s,;&]+/gi, 'apiKey=[REDACTED]')
      .replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160);
  };
  return errors.slice(0, 2).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const entry = value as { code?: unknown; message?: unknown };
    const code = typeof entry.code === 'string' && /^[a-z0-9_.:-]{1,64}$/i.test(entry.code)
      ? scrub(entry.code) : '';
    const message = typeof entry.message === 'string' && !/<[a-z!/]/i.test(entry.message) &&
      !/\b(?:authorization|cookie|bearer|secret|token)\b/i.test(entry.message)
      ? scrub(entry.message) : '';
    const fields = [code && `code=${code}`, message && `message=${message}`].filter(Boolean);
    return fields.length ? [fields.join(' ')] : [];
  }).join('; ');
}

/** Ticketmaster's own priceRanges array can list more than one tier (e.g.
 * "standard" + "VIP") -- collapse to the overall min/max across all of them.
 * Returns undefined when the array is absent/empty or has no numeric values. */
function extractPriceRange(priceRanges: TmEvent['priceRanges']): Concert['priceRange'] {
  if (!priceRanges || priceRanges.length === 0) return undefined;
  const mins = priceRanges.map((p) => p.min).filter((n): n is number => typeof n === 'number');
  const maxes = priceRanges.map((p) => p.max).filter((n): n is number => typeof n === 'number');
  if (mins.length === 0 || maxes.length === 0) return undefined;
  const currency = priceRanges.find((p) => p.currency)?.currency;
  if (!currency) return undefined;
  return { min: Math.min(...mins), max: Math.max(...maxes), currency };
}

export function mapEventToConcert(event: TmEvent, scrapedAt: string): Partial<Concert> | null {
  // Discovery API dates.status.code is independent of ticket availability.
  // Canceled/postponed events no longer take place on the listed date. Offsale
  // is still valid; rescheduled events carry the provider's replacement date.
  if (['canceled', 'postponed'].includes(event.dates?.status?.code || '')) return null;
  const venue = event._embedded?.venues?.[0];
  const attractions = event._embedded?.attractions ?? [];
  const attraction = attractions[0];
  // Prefer the classified attraction (performer) name over the raw event title --
  // the event name is often "Artist at Venue" or festival-branded text, while the
  // attraction name is the clean canonical artist name the whitelist expects.
  const artist = attraction?.name || event.name;
  const date = event.dates?.start?.localDate;

  if (!artist || !date || !venue?.name || !venue?.city?.name || !venue?.country?.countryCode) {
    return null;
  }

  const lat = venue.location?.latitude ? parseFloat(venue.location.latitude) : undefined;
  const lng = venue.location?.longitude ? parseFloat(venue.location.longitude) : undefined;

  // localTime is "HH:MM:SS" -- ConcertSchema's startTime wants "HH:MM".
  const localTime = event.dates?.start?.localTime;
  const startTime = localTime && /^\d{2}:\d{2}/.test(localTime) ? localTime.slice(0, 5) : undefined;

  // More than one attraction on the same event -- a multi-artist bill (festival or
  // co-headline show), not a standalone gig. event.name is then the festival/event
  // title (e.g. "Rock am Ring 2026"), and the other attractions are the lineup.
  const isMultiArtist = attractions.length > 1;

  return {
    artist,
    date,
    startTime,
    venue: venue.name,
    city: venue.city.name,
    country: venue.country.countryCode,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    festival: isMultiArtist && event.name ? { name: event.name, url: event.url } : undefined,
    // attractions[0] is already `artist` above -- exclude it so the headliner
    // doesn't also show up as a "support act" in its own lineup.
    lineup: isMultiArtist ? attractions.slice(1).map((a) => a.name).filter((n): n is string => !!n) : undefined,
    priceRange: extractPriceRange(event.priceRanges),
    ticketUrl: event.url,
    originalSource: 'ticketmaster.com',
    scrapedAt
  };
}

/**
 * Sweeps upcoming music events across a fixed list of Ticketmaster-covered
 * countries. Feeds into the same processConcerts() pipeline as venue scrapers --
 * the approved-artist whitelist filter applies here too, so this is additive
 * coverage, not a bypass of the existing quality bar.
 *
 * `cache` (per-country last-successful raw results) is optional and mutated in
 * place -- same "reuse last-good data on a transient failure" fallback venue
 * scrapers already get via reports/scrape-cache.json, applied per-country here
 * instead of per-venue. A network blip on one country no longer drops that
 * country's concerts for the whole day; it falls back to the last successful
 * sweep instead of contributing nothing.
 */
export async function fetchTicketmasterConcerts(
  apiKey: string,
  countries: string[] = TICKETMASTER_COUNTRIES,
  discoveryUrl: string = DISCOVERY_URL,
  cache: TicketmasterCache = {},
  onHealth?: (report: SourceHealthReport) => void
): Promise<Partial<Concert>[]> {
  const scrapedAt = new Date().toISOString();
  const concerts: Partial<Concert>[] = [];
  let requestCount = 0;
  const attemptedCountries = new Set<string>();
  const succeededCountries = new Set<string>();
  const emptyCountries = new Set<string>();
  const failedCountries = new Set<string>();
  const unavailableCountries = new Set<string>();
  const partialCountries = new Set<string>();
  const fallbackCountries = new Set<string>();
  const paginationLimitedCountries = new Set<string>();
  const budgetLimitedCountries = new Set<string>();
  const verifiedThisRun = new Set<string>();
  const issueCounts = new Map<string, number>();
  const addIssue = (reason: string) => issueCounts.set(reason, (issueCounts.get(reason) ?? 0) + 1);
  let haltedCategory: string | undefined;

  const emitHealth = (): void => {
    const uniqueCountries = Array.from(new Set(countries));
    if (uniqueCountries.length === 0) {
      onHealth?.({
        schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
        generatedAt: scrapedAt,
        source: 'ticketmaster',
        state: 'unknown',
        counts: emptySourceHealthCounts(),
        freshness: buildSourceFreshness([], {}, { now: new Date(scrapedAt) }),
        completeness: 'unknown',
        issues: [{ reason: 'no_targets', count: 1, action: 'configure_source_targets' }]
      });
      return;
    }
    const freshness = buildSourceFreshness(uniqueCountries, cache, {
      now: new Date(scrapedAt),
      verifiedThisRun
    });
    const missing = uniqueCountries.filter((country) => cache[country] === undefined).length;
    const incomplete = failedCountries.size > 0 || unavailableCountries.size > 0 ||
      partialCountries.size > 0 || paginationLimitedCountries.size > 0 ||
      budgetLimitedCountries.size > 0 || missing > 0 || freshness.unknown > 0;
    const state = succeededCountries.size === 0 && (failedCountries.size > 0 || unavailableCountries.size > 0)
      ? 'unavailable'
      : incomplete ? 'degraded' : 'healthy';
    if (paginationLimitedCountries.size > 0) {
      issueCounts.set('pagination_limit', paginationLimitedCountries.size);
    }
    if (budgetLimitedCountries.size > 0) {
      issueCounts.set('request_budget_exhausted', budgetLimitedCountries.size);
    }
    const issues: SourceHealthIssue[] = Array.from(issueCounts, ([reason, count]) => ({
      reason,
      count,
      action: reason === 'pagination_limit' ? 'treat_source_coverage_as_partial'
        : reason === 'authentication_failed' ? 'check_ticketmaster_api_key'
          : 'retry_next_scheduled_sweep'
    }));
    onHealth?.({
      schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
      generatedAt: scrapedAt,
      source: 'ticketmaster',
      state,
      counts: emptySourceHealthCounts({
        targets: uniqueCountries.length,
        selected: uniqueCountries.length,
        attempted: attemptedCountries.size,
        succeeded: succeededCountries.size,
        failed: failedCountries.size,
        empty: emptyCountries.size,
        unavailable: unavailableCountries.size,
        missing,
        cacheFallbacks: fallbackCountries.size,
        partial: new Set([...partialCountries, ...paginationLimitedCountries, ...budgetLimitedCountries]).size
      }),
      freshness,
      completeness: incomplete ? 'partial' : 'complete',
      ...(haltedCategory ? { halted: { category: haltedCategory, count: 1 } } : {}),
      issues
    });
  };

  // Discovery accepts second-precision UTC timestamps. Expand each query
  // outward when an internal window boundary has milliseconds, so rounding
  // cannot leave a gap; overlapping event IDs are already deduplicated.
  const discoveryDateTime = (timeMs: number, upperBound = false): string =>
    new Date((upperBound ? Math.ceil(timeMs / 1000) : Math.floor(timeMs / 1000)) * 1000)
      .toISOString().replace('.000Z', 'Z');

  // Query each window's first page before paging it. A crowded window is
  // divided until every leaf fits inside Discovery's deep-paging ceiling.
  // The unbounded right-hand window preserves the API's full future horizon.
  const fetchPage = async (countryCode: string, page: number, startMs: number, endMs?: number): Promise<any> => {
    if (requestCount >= MAX_REQUESTS_PER_SWEEP) {
      budgetLimitedCountries.add(countryCode);
      return null;
    }
    if (requestCount > 0) await sleep(REQUEST_DELAY_MS);
    requestCount++;
    return axios.get(discoveryUrl, {
      params: {
        apikey: apiKey,
        countryCode,
        classificationName: 'music',
        size: PAGE_SIZE,
        page,
        sort: 'date,asc',
        startDateTime: discoveryDateTime(startMs),
        ...(endMs === undefined ? {} : { endDateTime: discoveryDateTime(endMs, true) })
      },
      timeout: 15000
    });
  };

  for (let countryIndex = 0; countryIndex < countries.length; countryIndex++) {
    const countryCode = countries[countryIndex];
    const countryConcerts: Partial<Concert>[] = [];
    attemptedCountries.add(countryCode);

    const seenIds = new Set<string>();
    const readPage = (response: any, requestedPage: number, expected?: { totalElements: number; totalPages: number }):
      { events: TmEvent[]; totalElements: number; totalPages: number } => {
      const metadata = response.data?.page;
      const { size, number, totalElements, totalPages } = metadata ?? {};
      const rawEvents = response.data?._embedded?.events;
      const validMetadata = size === PAGE_SIZE && Number.isSafeInteger(number) && number === requestedPage &&
        Number.isSafeInteger(totalElements) && totalElements >= 0 &&
        Number.isSafeInteger(totalPages) && totalPages === Math.ceil(totalElements / PAGE_SIZE) &&
        (!expected || (totalElements === expected.totalElements && totalPages === expected.totalPages));
      const events = rawEvents === undefined ? [] : rawEvents;
      const expectedCount = Math.min(PAGE_SIZE, Math.max(0, totalElements - requestedPage * PAGE_SIZE));
      if (!validMetadata || !Array.isArray(events) || events.length !== expectedCount ||
        events.some((event) => !isDiscoveryEvent(event))) {
        throw Object.assign(new Error(`Invalid Ticketmaster page ${requestedPage} for ${countryCode}`),
          { ticketmasterIssue: 'invalid_response' });
      }
      return { events, totalElements, totalPages };
    };
    const collectWindow = async (startMs: number, endMs?: number): Promise<boolean> => {
      const first = await fetchPage(countryCode, 0, startMs, endMs);
      if (!first) return false;
      const firstPage = readPage(first, 0);
      const { totalElements, totalPages } = firstPage;
      if (totalElements > PAGE_SIZE * MAX_PAGES_PER_COUNTRY || totalPages > MAX_PAGES_PER_COUNTRY) {
        // A one-second overlap avoids losing events exactly at the boundary.
        // If the same instant is still too dense, declare partial coverage.
        if (endMs !== undefined && endMs - startMs <= 2 * WINDOW_OVERLAP_MS) {
          paginationLimitedCountries.add(countryCode);
          return false;
        }
        const splitMs = endMs === undefined
          ? startMs + YEAR_MS
          : startMs + Math.floor((endMs - startMs) / 2);
        if (!Number.isFinite(splitMs) || splitMs - WINDOW_OVERLAP_MS <= startMs) {
          paginationLimitedCountries.add(countryCode);
          return false;
        }
        const left = await collectWindow(startMs, splitMs);
        const right = await collectWindow(splitMs - WINDOW_OVERLAP_MS, endMs);
        return left && right;
      }
      for (let page = 0; page < totalPages; page++) {
        const response = page === 0 ? first : await fetchPage(countryCode, page, startMs, endMs);
        if (!response) return false;
        const events = page === 0 ? firstPage.events :
          readPage(response, page, { totalElements, totalPages }).events;
        for (const event of events) {
          if (event.id && seenIds.has(event.id)) continue;
          if (event.id) seenIds.add(event.id);
          const concert = mapEventToConcert(event, scrapedAt);
          if (concert) countryConcerts.push(concert);
        }
      }
      return true;
    };

    let complete = false;
    try {
      complete = await collectWindow(Date.parse(scrapedAt));
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401 || status === 403 || status === 429) {
        haltedCategory = status === 429 ? 'rate_limited' : 'authentication_failed';
        addIssue(haltedCategory);
        console.error(`[Ticketmaster] ${haltedCategory} (${status}) -- stopping sweep.`);
        for (const remaining of countries.slice(countryIndex)) {
          unavailableCountries.add(remaining);
          if (cache[remaining]) {
            fallbackCountries.add(remaining);
            concerts.push(...cache[remaining].concerts);
          }
        }
        emitHealth();
        return concerts;
      }
      failedCountries.add(countryCode);
      addIssue(err.ticketmasterIssue ?? (typeof status === 'number' && status >= 500 ? 'source_server_error' : 'request_failed'));
      if (status === 400) {
        const details = badRequestDetails(err.response?.data, apiKey);
        console.warn(`[Ticketmaster] ${countryCode} failed: HTTP 400${details ? ` (${details})` : ''}`);
      } else {
        console.warn(`[Ticketmaster] ${countryCode} failed: ${err.message}`);
      }
    }

    if (!complete && countryConcerts.length > 0) partialCountries.add(countryCode);
    if (!complete && cache[countryCode]) {
      console.warn(`[Ticketmaster] ${countryCode} incomplete -- reusing ${cache[countryCode].concerts.length} cached events from ${cache[countryCode].fetchedAt}.`);
      concerts.push(...cache[countryCode].concerts);
      fallbackCountries.add(countryCode);
    } else if (complete) {
      cache[countryCode] = {
        fetchedAt: scrapedAt,
        verifiedAt: scrapedAt,
        concerts: countryConcerts
      };
      succeededCountries.add(countryCode);
      verifiedThisRun.add(countryCode);
      if (countryConcerts.length === 0) emptyCountries.add(countryCode);
      concerts.push(...countryConcerts);
    } else {
      // No last-good cache exists. Expose what was fetched, but report partial.
      concerts.push(...countryConcerts);
    }
  }

  console.log(`[Ticketmaster] ${requestCount} requests across ${countries.length} countries -> ${concerts.length} raw events.`);
  emitHealth();
  return concerts;
}
