import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]);
const COUNTRIES: Readonly<Record<string, string>> = { uk: 'GB', germany: 'DE', singapore: 'SG' };
const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
};

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseLocation(raw: string): { venue?: string; city: string; country?: string } {
  // Multiple semicolon groups on this page are separate venues; no single
  // venue/city can be assigned to the row without inventing a pairing.
  if (raw.split(';').length > 2 || /,\s*[A-Z]{2}\s*;/.test(raw)) return { city: raw };
  const parts = raw.split(/[,;]/).map(compact).filter(Boolean);
  const countryLabel = parts.at(-1) || '';
  const country = US_STATES.has(countryLabel) ? 'US' : COUNTRIES[countryLabel.toLowerCase()];
  if (country === 'SG' && parts.length === 2) {
    return { venue: parts[0], city: 'Singapore', country };
  }
  if (!country && raw.includes(';') && parts.length === 3) {
    return { venue: parts[0], city: parts.slice(1).join(', ') };
  }
  if (!country || parts.length < 3) return { city: raw };
  return { venue: parts.slice(0, -2).join(', '), city: parts.at(-2)!, country };
}

function isoDate(year: number, monthName: string, day: number): string | undefined {
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return undefined;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day) return undefined;
  return candidate.toISOString().slice(0, 10);
}

function parseDates(parts: string[]): string[] {
  if (parts.length < 1 || parts.length > 2 ||
      (parts.length === 2 && !/^20\d{2}$/.test(parts[1]))) return [];
  const source = parts.length === 2 ? `${parts[0]}, ${parts[1]}` : parts[0];
  const yearMatch = source.match(/^(.*?),?\s+(20\d{2})$/);
  if (!yearMatch) return [];
  const label = yearMatch[1].replace(/,\s*$/, '');
  const year = Number(yearMatch[2]);
  const crossMonth = label.match(/^([A-Za-z]+)\s+(\d{1,2}(?:,\s*\d{1,2})*)\s*&\s*([A-Za-z]+)\s+(\d{1,2})$/);
  if (crossMonth) {
    if (!MONTHS[crossMonth[1].toLowerCase()] ||
        !MONTHS[crossMonth[3].toLowerCase()] ||
        MONTHS[crossMonth[3].toLowerCase()] <= MONTHS[crossMonth[1].toLowerCase()]) return [];
    const firstDays = crossMonth[2].split(',').map((day) => Number(day.trim()));
    const dates = [
      ...firstDays.map((day) => isoDate(year, crossMonth[1], day)),
      isoDate(year, crossMonth[3], Number(crossMonth[4]))
    ];
    return dates.every(Boolean) ? dates as string[] : [];
  }

  const sameMonth = label.match(/^([A-Za-z]+)\s+(\d{1,2}(?:(?:,|\s*&\s*|\s+and\s+)\s*\d{1,2})*)$/i);
  if (!sameMonth) return []; // Continuous ranges do not imply one show per day.
  const days = sameMonth[2].split(/\s*(?:,|&|\band\b)\s*/i).map(Number);
  const dates = days.map((day) => isoDate(year, sameMonth[1], day));
  return dates.every(Boolean) ? dates as string[] : [];
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('.schedule-text4_item').each((_, element) => {
    const block = $(element);
    const dateParts = block.find('h5.margin-vertical-0').map((_, node) => compact($(node).text())).get().filter(Boolean);
    const rawLocation = compact(block.find('.small-text').first().text());
    const location = parseLocation(rawLocation);
    if (!dateParts.length || !rawLocation) return;
    const href = block.find('a.button').first().attr('href');
    // A multi-venue row has no documented date-to-venue pairing.
    const dates = location.venue ? parseDates(dateParts) : [];
    for (const date of dates.length ? dates : [undefined]) {
      concerts.push({
        artist: config.selectors?.artistNameFallback || 'Puts, Kevin',
        date,
        venue: location.venue,
        city: location.city,
        country: location.country,
        ticketUrl: href && href !== '#' ? safeAbsoluteUrl(href, config.url) : undefined,
        originalSource: config.domain,
        scrapedAt
      });
    }
  });

  return concerts;
}
