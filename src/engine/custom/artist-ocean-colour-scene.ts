import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const SOURCE_COUNTRIES = new Set(['ES', 'GB', 'IE']);
const VERIFIED_VENUE_NAMES: Readonly<Record<string, string>> = {
  'Glasgow|GB|Glasgow OVO Hydro': 'OVO Hydro',
  'Aberdeen|GB|Music Hall': 'Aberdeen Music Hall',
  'Dunfermline|GB|Alhambra': 'Alhambra Theatre'
};

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('.EventListingListItem').each((_, element) => {
    const block = $(element);
    const href = block.find('a.EventListingListItem-link').first().attr('href');
    const datedPath = href?.match(/\/events\/(\d{4})-(\d{2})-(\d{2})(?:-|$)/);
    const day = compact(block.find('.EventListingListItem-date-day').first().text());
    const month = compact(block.find('.EventListingListItem-date-month').first().text());
    const date = datedPath ? `${datedPath[1]}-${datedPath[2]}-${datedPath[3]}` : undefined;
    const displayedDate = datedPath ? new Date(`${date}T00:00:00Z`) : undefined;
    const dateMatches = displayedDate && !Number.isNaN(displayedDate.valueOf()) &&
      displayedDate.toISOString().slice(0, 10) === date &&
      displayedDate.getUTCDate() === Number(day) &&
      displayedDate.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toLowerCase() === month.toLowerCase();
    const sourceVenue = compact(block.find('.EventListingListItem-venue-room').first().text());
    const rawLocation = compact(block.find('.EventListingListItem-venue-city').first().text());
    const location = rawLocation.match(/^(.+),\s*([A-Z]{2})$/);
    const city = location?.[1].trim() || rawLocation;
    const country = location && SOURCE_COUNTRIES.has(location[2]) ? location[2] : undefined;
    const venue = VERIFIED_VENUE_NAMES[`${city}|${country}|${sourceVenue}`] || sourceVenue;
    if (!day || !month || !sourceVenue || !rawLocation) return;

    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Ocean Colour Scene',
      // The page displays day/month only; its event URL supplies the year.
      // A mismatch stays unparseable rather than assigning an invented year.
      date: dateMatches ? date : undefined,
      venue,
      city,
      country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
