import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Exact labels from the artist's gig table, checked against the named venues.
// An unknown label has no defensible country and remains incomplete downstream.
const VERIFIED_LOCATIONS: Record<string, { city: string; venue: string; country: string }> = {
  'Drogheda - Tommy Leddy Theatre (TLT)': { city: 'Drogheda', venue: 'Tommy Leddy Theatre (TLT)', country: 'IE' },
  'Letterkenny - Mount Errigal': { city: 'Letterkenny', venue: 'Mount Errigal Hotel', country: 'IE' },
  'Dublin - The Helix': { city: 'Dublin', venue: 'The Helix', country: 'IE' },
  'Castlebar - TF Royal': { city: 'Castlebar', venue: 'TF Royal Theatre', country: 'IE' },
  'Dragsmervej, Denmark - Fuglsocentrel': { city: 'Knebel', venue: 'Hotel Fuglsøcentret', country: 'DK' },
  'Wakefield - WX (Wakefield Exchange)': { city: 'Wakefield', venue: 'WX (Wakefield Exchange)', country: 'GB' },
  'Whitley Bay - Playhouse': { city: 'Whitley Bay', venue: 'Playhouse', country: 'GB' },
  'Holmfirth - Picturedrome': { city: 'Holmfirth', venue: 'Picturedrome', country: 'GB' },
  'Derby - Vaillant Live': { city: 'Derby', venue: 'Vaillant Live', country: 'GB' },
  'Exeter - Corn Exchange': { city: 'Exeter', venue: 'Corn Exchange', country: 'GB' },
  'Aberdeen - Tivoli Theatre': { city: 'Aberdeen', venue: 'Tivoli Theatre', country: 'GB' },
  'Dunfermline - Alhambra': { city: 'Dunfermline', venue: 'Alhambra', country: 'GB' },
  'Port Talbot - Princess Royal Theatre': { city: 'Port Talbot', venue: 'Princess Royal Theatre', country: 'GB' },
  // Official venue proof: tests/fixtures/artist-showaddywaddy-locations-20260928.json.
  'Carlisle - The Sands': { city: 'Carlisle', venue: 'The Sands Centre', country: 'GB' },
  'Rhyl - Pavilion Theatre': { city: 'Rhyl', venue: 'Pavilion Theatre', country: 'GB' },
  'Runcorn - Brindley Theatre': { city: 'Runcorn', venue: 'The Brindley', country: 'GB' },
  'Stockport - Plaza': { city: 'Stockport', venue: 'The Plaza', country: 'GB' },
  'Leamington Spa - Royal Spa Centre': { city: 'Leamington Spa', venue: 'Royal Spa Centre', country: 'GB' },
  'Folkestone - Leas Cliff Hall': { city: 'Folkestone', venue: 'Leas Cliff Hall', country: 'GB' },
  'Paisley - Town Hall': { city: 'Paisley', venue: 'Paisley Town Hall', country: 'GB' },
  'Melton Mowbray - Melton Theatre': { city: 'Melton Mowbray', venue: 'Melton Theatre', country: 'GB' }
};

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseDate(text: string, year: number, month: number): string | undefined {
  const match = compact(text).match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})(st|nd|rd|th|h)(?:\s+\(afternoon\))?$/);
  if (!match) return undefined;
  const day = Number(match[2]);
  const expectedSuffix = day === 27 ? 'th' : day % 100 >= 11 && day % 100 <= 13 ? 'th' :
    day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  if (match[3] !== expectedSuffix && !(day === 27 && match[3] === 'h')) return undefined;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
      WEEKDAYS[parsed.getUTCDay()] !== match[1]) return undefined;
  return date;
}

/** The official gig table groups weekday/day rows under full month/year rows. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('table.tableBuilder').each((_, table) => {
    let context: { year: number; month: number } | undefined;
    $(table).find('tr.tableBuilderRow').filter((_, element) => $(element).closest('table')[0] === table).each((_, element) => {
      const row = $(element);
      const first = row.find('td.tableBuilderCell1').first();
      if (row.hasClass('uniqueStyleRow')) {
        context = undefined;
        const text = compact(first.text());
        const match = text.match(/^([A-Za-z]+)\s+(20\d{2})$/);
        const month = match ? MONTHS.indexOf(match[1].toLowerCase()) + 1 : 0;
        // Conflicting text in another cell makes even a valid first cell ambiguous.
        const otherText = row.children('td').not(first).text();
        if (month && !compact(otherText)) context = { year: Number(match![2]), month };
        return;
      }
      if (!context) return;
      const date = parseDate(first.text(), context.year, context.month);
      const location = row.find('td.tableBuilderCell2').first().text().trim();
      if (!date || !location) return;
      // The existing provider record for this date calls the county "Mayo" its
      // city. Its true city is Castlebar; source-only dedupe cannot merge them.
      // Hold this one official row until that provider identity is reconciled.
      if (date === '2026-12-06' && location === 'Castlebar - TF Royal') return;
      const verified = VERIFIED_LOCATIONS[location];
      // Keep the configured selector's extraction behavior, including its current
      // unsupported @href suffix, so this date fix does not alter ticket coverage.
      const href = config.selectors?.ticketUrl ? row.find(config.selectors.ticketUrl).first().attr('href') : undefined;
      concerts.push({
        artist: config.selectors?.artistNameFallback || 'Showaddywaddy',
        date,
        venue: verified?.venue || location,
        city: verified?.city || location,
        country: verified?.country,
        ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
        originalSource: config.domain,
        scrapedAt
      });
    });
  });
  return concerts;
}
