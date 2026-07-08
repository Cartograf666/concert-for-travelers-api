import axios from 'axios';
import * as fs from 'fs/promises';
import { Concert } from '../schemas/concert.js';

const DISCOVERY_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

// Discovery API's own deep-pagination limit: page*size tops out around 1000
// results for a single query, regardless of how many more actually match. A
// country with more music events in the window than that gets truncated --
// acceptable (this sweep runs daily and self-corrects), not worth the extra
// complexity of splitting into narrower date windows per country.
const MAX_PAGES_PER_COUNTRY = 5;
const PAGE_SIZE = 200;

// Free-tier budget is 5000 requests/day and 100/minute (per the app's Ticketmaster
// developer console). A daily sweep across ~50 countries at up to 5 requests each
// is a few hundred requests -- comfortably inside both limits -- but the delay
// still keeps individual request spacing polite and under the per-minute cap.
const REQUEST_DELAY_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  name?: string;
  url?: string;
  dates?: { start?: { localDate?: string; localTime?: string } };
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
  cache: TicketmasterCache = {}
): Promise<Partial<Concert>[]> {
  const scrapedAt = new Date().toISOString();
  const concerts: Partial<Concert>[] = [];
  let requestCount = 0;

  for (const countryCode of countries) {
    const countryConcerts: Partial<Concert>[] = [];
    let countryFailed = false;

    for (let page = 0; page < MAX_PAGES_PER_COUNTRY; page++) {
      try {
        const response = await axios.get(discoveryUrl, {
          params: {
            apikey: apiKey,
            countryCode,
            classificationName: 'music',
            size: PAGE_SIZE,
            page,
            sort: 'date,asc'
          },
          timeout: 15000
        });
        requestCount++;

        const events: TmEvent[] = response.data?._embedded?.events || [];
        for (const event of events) {
          const concert = mapEventToConcert(event, scrapedAt);
          if (concert) countryConcerts.push(concert);
        }

        const totalPages = response.data?.page?.totalPages ?? 0;
        if (events.length === 0 || page + 1 >= totalPages) break;

        await sleep(REQUEST_DELAY_MS);
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          console.error(`[Ticketmaster] Auth error (${status}) -- stopping sweep, check TICKETMASTER_API_KEY.`);
          // Nothing more will succeed with a dead key -- fall back to cache for
          // every remaining country (including this one) rather than returning
          // only what was collected before the key was confirmed bad.
          for (const remaining of countries.slice(countries.indexOf(countryCode))) {
            if (cache[remaining]) concerts.push(...cache[remaining].concerts);
          }
          console.log(`[Ticketmaster] ${requestCount} requests across ${countries.length} countries -> ${concerts.length} raw events (cache fallback after auth error).`);
          return concerts;
        }
        console.warn(`[Ticketmaster] ${countryCode} page ${page} failed: ${err.message}`);
        countryFailed = true;
        break;
      }
    }

    if (countryFailed && countryConcerts.length === 0 && cache[countryCode]) {
      console.warn(`[Ticketmaster] ${countryCode} failed with no results this run -- reusing ${cache[countryCode].concerts.length} cached events from ${cache[countryCode].fetchedAt}.`);
      concerts.push(...cache[countryCode].concerts);
    } else if (!countryFailed) {
      cache[countryCode] = { fetchedAt: scrapedAt, concerts: countryConcerts };
      concerts.push(...countryConcerts);
    } else {
      // Failed partway through but got some results, or failed with nothing
      // and no cache to fall back on -- use whatever was actually collected.
      concerts.push(...countryConcerts);
    }
  }

  console.log(`[Ticketmaster] ${requestCount} requests across ${countries.length} countries -> ${concerts.length} raw events.`);
  return concerts;
}
