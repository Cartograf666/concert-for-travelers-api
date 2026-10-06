import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const TOUR_ID = '0410bcb7-a835-464c-b3ef-d7855c3ecbdc';
const OBSERVED_US_REGIONS = new Set(['MA', 'NY', 'PA', 'OR', 'WA', 'CA', 'GA', 'TN', 'NC']);
const OBSERVED_CA_REGIONS = new Set(['BC']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TourEvent = {
  id?: unknown;
  type?: unknown;
  attributes?: Record<string, unknown>;
};

type TourResponse = {
  data?: {
    id?: unknown;
    attributes?: { name?: unknown };
    relationships?: { 'tour-events'?: { data?: Array<{ id?: unknown; type?: unknown }> } };
  };
  included?: TourEvent[];
};

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const tour = JSON.parse(body) as TourResponse;
  if (tour.data?.id !== TOUR_ID || tour.data.attributes?.name !== 'Emancipator' || !Array.isArray(tour.included)) {
    throw new Error('Emancipator official Seated tour identity or event list changed');
  }
  const relationships = tour.data.relationships?.['tour-events']?.data;
  if (!Array.isArray(relationships)) {
    throw new Error('Emancipator official Seated tour-event relationships are missing');
  }
  const referenced = new Set<string>();
  for (const item of relationships) {
    if (item?.type !== 'tour-events' || typeof item.id !== 'string' || !UUID.test(item.id) || referenced.has(item.id)) {
      throw new Error('Emancipator official Seated tour-event relationship is invalid or duplicated');
    }
    referenced.add(item.id);
  }
  if (!referenced.size) return [];
  const included = new Map<string, TourEvent>();
  for (const event of tour.included) {
    if (event?.type !== 'tour-events' || typeof event.id !== 'string' || !referenced.has(event.id)) continue;
    if (included.has(event.id)) throw new Error(`Emancipator official Seated tour-event ${event.id} is duplicated`);
    included.set(event.id, event);
  }
  const concerts: Partial<Concert>[] = [];
  for (const id of referenced) {
    const event = included.get(id);
    if (!event) throw new Error(`Emancipator official Seated tour-event ${id} is missing`);
    const attributes = event.attributes || {};
    const date = attributes['starts-at-date-local'];
    if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Emancipator official Seated tour-event ${id} has an invalid date`);
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`Emancipator official Seated tour-event ${id} has an invalid date`);
    }
    // A fully validated past date is the only referenced event excluded from today's feed.
    if (date < scrapedAt.slice(0, 10)) continue;
    const venue = attributes['venue-name'];
    const location = typeof attributes['formatted-address'] === 'string'
      ? attributes['formatted-address'].trim().match(/^(.+?),\s*([A-Z]{2})$/) : null;
    if (typeof venue !== 'string' || !venue.trim() || !location || !location[1].trim()) {
      throw new Error(`Emancipator official Seated tour-event ${id} has an invalid venue or location`);
    }
    const country = OBSERVED_CA_REGIONS.has(location[2]) ? 'CA' : OBSERVED_US_REGIONS.has(location[2]) ? 'US' : undefined;
    if (!country) throw new Error(`Emancipator official Seated tour-event ${id} has an unrecognized country or region`);
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Emancipator', date,
      venue: venue.trim(), city: location[1].trim(), country,
      // All twelve current links were observed in the artist's rendered Seated widget.
      ticketUrl: `https://link.seated.com/${id}`,
      originalSource: config.domain, scrapedAt
    });
  }
  return concerts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
