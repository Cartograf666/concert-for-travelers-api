import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const TOUR_ID = 'fc4e0166-09b2-48ad-87b8-c352fcc73bb5';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

type TourEvent = { id?: unknown; type?: unknown; attributes?: Record<string, unknown> };
type TourResponse = {
  data?: { id?: unknown; attributes?: { name?: unknown };
    relationships?: { 'tour-events'?: { data?: Array<{ id?: unknown; type?: unknown }> } } };
  included?: TourEvent[];
};

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const tour = JSON.parse(body) as TourResponse;
  if (tour.data?.id !== TOUR_ID || tour.data.attributes?.name !== 'O.A.R.' || !Array.isArray(tour.included)) {
    throw new Error('O.A.R. official Seated tour identity or event list changed');
  }
  const relationships = tour.data.relationships?.['tour-events']?.data;
  if (!Array.isArray(relationships)) throw new Error('O.A.R. tour-event relationships are missing');
  const referenced = new Set<string>();
  for (const item of relationships) {
    if (item?.type !== 'tour-events' || typeof item.id !== 'string' || !UUID.test(item.id) || referenced.has(item.id)) {
      throw new Error('O.A.R. tour-event relationship is invalid or duplicated');
    }
    referenced.add(item.id);
  }
  const included = new Map<string, TourEvent>();
  for (const event of tour.included) {
    if (event?.type !== 'tour-events' || typeof event.id !== 'string' || !referenced.has(event.id)) continue;
    if (included.has(event.id)) throw new Error(`O.A.R. tour-event ${event.id} is duplicated`);
    included.set(event.id, event);
  }
  const concerts: Partial<Concert>[] = [];
  for (const id of referenced) {
    const event = included.get(id);
    if (!event) throw new Error(`O.A.R. tour-event ${id} is missing`);
    const attributes = event.attributes || {};
    const date = attributes['starts-at-date-local'];
    if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      throw new Error(`O.A.R. tour-event ${id} has an invalid date`);
    }
    if (date < scrapedAt.slice(0, 10)) continue;
    // This official band widget also lists Marc Roberge's solo shows. They are
    // explicitly billed under his name and cannot be attributed to O.A.R.
    const details = attributes.details;
    if (typeof details === 'string' && /\bMarc\s+Roberge\b/i.test(details)) continue;
    const venue = attributes['venue-name'];
    const location = typeof attributes['formatted-address'] === 'string'
      ? attributes['formatted-address'].trim().match(/^(.+?),\s*([A-Z]{2})$/) : null;
    if (typeof venue !== 'string' || !venue.trim() || !location || !location[1].trim()) {
      throw new Error(`O.A.R. tour-event ${id} has an invalid venue or location`);
    }
    const country = US_STATES.has(location[2]) ? 'US' : CA_PROVINCES.has(location[2]) ? 'CA' : undefined;
    if (!country) throw new Error(`O.A.R. tour-event ${id} has an unrecognized region`);
    concerts.push({
      artist: 'O.A.R.', date, venue: venue.trim(), city: location[1].trim(), country,
      originalSource: config.domain, scrapedAt
    });
  }
  return concerts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
