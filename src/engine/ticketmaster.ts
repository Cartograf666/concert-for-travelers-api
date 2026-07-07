import axios from 'axios';
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
// budget on empty pages.
export const TICKETMASTER_COUNTRIES = [
  'US', 'CA', 'MX', 'GB', 'IE', 'DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'ES', 'PT',
  'IT', 'PL', 'CZ', 'SE', 'NO', 'DK', 'FI', 'AU', 'NZ', 'ZA', 'AE', 'TR'
];

interface TmEvent {
  name?: string;
  url?: string;
  dates?: { start?: { localDate?: string } };
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

export function mapEventToConcert(event: TmEvent, scrapedAt: string): Partial<Concert> | null {
  const venue = event._embedded?.venues?.[0];
  const attraction = event._embedded?.attractions?.[0];
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

  return {
    artist,
    date,
    venue: venue.name,
    city: venue.city.name,
    country: venue.country.countryCode,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
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
 */
export async function fetchTicketmasterConcerts(
  apiKey: string,
  countries: string[] = TICKETMASTER_COUNTRIES,
  discoveryUrl: string = DISCOVERY_URL
): Promise<Partial<Concert>[]> {
  const scrapedAt = new Date().toISOString();
  const concerts: Partial<Concert>[] = [];
  let requestCount = 0;

  for (const countryCode of countries) {
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
          if (concert) concerts.push(concert);
        }

        const totalPages = response.data?.page?.totalPages ?? 0;
        if (events.length === 0 || page + 1 >= totalPages) break;

        await sleep(REQUEST_DELAY_MS);
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          console.error(`[Ticketmaster] Auth error (${status}) -- stopping sweep, check TICKETMASTER_API_KEY.`);
          return concerts;
        }
        console.warn(`[Ticketmaster] ${countryCode} page ${page} failed: ${err.message}`);
        break;
      }
    }
  }

  console.log(`[Ticketmaster] ${requestCount} requests across ${countries.length} countries -> ${concerts.length} raw events.`);
  return concerts;
}
