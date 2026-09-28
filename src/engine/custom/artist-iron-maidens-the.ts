import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

// Official calendar venue names and full addresses observed in the saved source
// fixture. Require both fields so a moved or newly added venue is reviewed first.
// The legacy config schema requires countryNameFallback, but this custom parser
// never reads it: country comes only from an exact verified location below.
const VERIFIED_LOCATIONS: Record<string, { city: string; country: string }> = {
  'The Brooklyn Bowl Las Vegas|3545 S Las Vegas Blvd Las Vegas, NV 89109': { city: 'Las Vegas', country: 'US' },
  'Beachland Ballroom and Tavern|15711 Waterloo Rd. Cleveland, OH 44110': { city: 'Cleveland', country: 'US' },
  'Cla-Zel Theater|127 N. Main St. Bowling Green, OH 43402': { city: 'Bowling Green', country: 'US' },
  'Newton Performing Arts Center|60 W 6th Street Newton, NC': { city: 'Newton', country: 'US' },
  "Sam's Burger Joint|330 East Grayson Street, San Antonio, TX 78215": { city: 'San Antonio', country: 'US' },
  'The Wildcatter Saloon|26913 Katy Fwy Katy, TX. 77494': { city: 'Katy', country: 'US' },
  'AM/FM|1950 Market Center Blvd Dallas, TX, 75207': { city: 'Dallas', country: 'US' },
  'DNA Lounge|375 11th St. San Francisco, CA': { city: 'San Francisco', country: 'US' },
  'Jergel’s Rhythm Grille|103 Slate Lane, Warrendale, PA 15086': { city: 'Warrendale', country: 'US' },
  'Crystal Grand Music Theatre|430 West Monroe Ave Wisconsin Dells, WI': { city: 'Wisconsin Dells', country: 'US' }
};

const TICKET_HOSTS = new Set([
  'www.ticketmaster.com', 'www.beachlandballroom.com', 'www.etix.com',
  'ncauditorium.com', 'wl.eventim.us', 'www.eventim.us', 'www.dnalounge.com'
]);

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dateFromBlock(block: cheerio.Cheerio<Element>): string | undefined {
  if (block.find('.evo_start .date').length !== 1 ||
      block.find('.evo_start .month').length !== 1) return undefined;
  const year = block.attr('data-syr');
  const monthName = block.attr('data-smon')?.toLowerCase();
  const dayText = compact(block.find('.evo_start .date').first().text());
  const monthText = compact(block.find('.evo_start .month').first().text()).toLowerCase();
  const month = monthName ? MONTHS.indexOf(monthName) + 1 : 0;
  if (!year || !/^20\d{2}$/.test(year) || !month ||
      monthText !== monthName?.slice(0, 3) || !/^\d{1,2}$/.test(dayText)) return undefined;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(Number(dayText)).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
    ? date : undefined;
}

function localStartTime(text: string): string | undefined {
  const match = compact(text).match(/^(1[0-2]|[1-9]):([0-5]\d)\s*(am|pm)$/i);
  if (!match) return undefined; // All Day and malformed values carry no time.
  const hour = (Number(match[1]) % 12) + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function safeTicket(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  const absolute = safeAbsoluteUrl(href, base);
  if (!absolute) return undefined;
  const url = new URL(absolute);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !TICKET_HOSTS.has(url.hostname)) return undefined;
  return url.toString();
}

/** Read only the visible EventON schedule cards, not their JSON-LD dates or hidden lightbox. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $(config.selectors?.eventBlock || '.eventon_list_event.scheduled').each((_, element) => {
    const card = $(element);
    if (!card.hasClass('scheduled') || card.is('.cancelled, .canceled, .postponed')) return;
    const dateBlock = card.find('.evcal_cblock');
    const start = dateBlock.find('.evo_start');
    const end = dateBlock.find('.evo_end');
    // End dates (including cruise itineraries) cannot become a single concert.
    if (dateBlock.length !== 1 || start.length !== 1 ||
        end.length > 1 || (end.length === 1 &&
          (!end.hasClass('only_time') || end.find('.date, .month').length > 0))) return;
    const date = dateFromBlock(dateBlock);
    if (!date) return;

    const description = card.find('.evcal_desc[data-location_name][data-location_address]').first();
    if (description.attr('data-location_status') !== 'true') return;
    const venue = compact(description.attr('data-location_name') || '');
    const address = compact(description.attr('data-location_address') || '');
    const location = VERIFIED_LOCATIONS[`${venue}|${address}`];
    if (!location) return;

    const ticket = card.find('a.evo_cusmeta_btn').filter((_, link) =>
      compact($(link).text()).toLowerCase() === 'tickets').first();
    const startTimes = start.find('.time');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'The Iron Maidens',
      date,
      venue,
      city: location.city,
      country: location.country,
      startTime: !card.find('.evcal_list_a.allday').length && startTimes.length === 1
        ? localStartTime(startTimes.text()) : undefined,
      ticketUrl: safeTicket(ticket.attr('href'), config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });
  return concerts;
}
