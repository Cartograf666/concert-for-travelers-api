import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const DUTCH_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12
};

// Cities verified on the current official tour list as Dutch locations. The
// page has no per-row country field, so a newly listed location must fail until
// checked rather than silently inheriting the old NL schema fallback.
const NL_CITIES = new Set('Aalten|Abcoude|Almelo|Alphen aan den Rijn|Amersfoort|Amsterdam|Arnhem|Baarn|Bemmel|Bergeijk|Bergen op Zoom|Bovenkarspel|Capelle aan den IJssel|Culemborg|Delft|Deventer|Druten|Eibergen|Emmeloord|Etten-Leur|Gemert|Goes|Hardenberg|Heerenveen|Heiloo|Hellevoetsluis|Helmond|Hendrik-Ido-Ambacht|Hilversum|Houten|Kampen|Laren|Lisse|Malden|Naaldwijk|Nijmegen|Nijverdal|Oirschot|Oldenzaal|Oosterhout|Rilland|Roden|Roelofarendsveen|Roermond|Rotterdam|Schiedam|Schipluiden|Sneek|Twisk|Uden|Ulft|Utrecht|Valkenswaard|Veendam|Volendam|Wadway|Wassenaar|Woerden|Zevenaar|Zoetermeer'.split('|'));

function parsePrintedDate(value: string): string {
  const match = value.trim().toLowerCase().match(/^(\d{1,2}) (jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec) (\d{4})$/);
  if (!match) throw new Error(`Ellen ten Damme row has no complete printed date: ${value}`);
  const day = Number(match[1]);
  const month = DUTCH_MONTHS[match[2]];
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Ellen ten Damme row has invalid calendar date: ${value}`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('Ellen ten Damme') || !$('table.shows.show-upcoming').length) {
    throw new Error('Ellen ten Damme official upcoming tour table is missing');
  }
  const concerts: Partial<Concert>[] = [];
  $('table.shows.show-upcoming tr').each((_, element) => {
    const row = $(element);
    const dateCell = row.find('td.event-field-datetime').first();
    const printedDate = dateCell.find('strong').first().text();
    const date = parsePrintedDate(printedDate);
    const startTime = dateCell.text().replace(printedDate, '').trim();
    if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      throw new Error(`Ellen ten Damme row has invalid start time: ${startTime}`);
    }
    const venue = row.find('td.event-field-venue .venue-name').first().text().replace(/\s+/g, ' ').trim();
    const city = row.find('td.event-field-city').first().text().replace(/\s+/g, ' ').trim();
    if (!venue || !NL_CITIES.has(city)) {
      throw new Error(`Ellen ten Damme row has missing venue or unverified country: ${city}`);
    }
    const href = row.find('td.event-field-info a.ticket-link').first().attr('href');
    concerts.push({ artist: config.selectors?.artistNameFallback || 'Ellen ten Damme', date,
      venue, city, country: 'NL', ...(startTime ? { startTime } : {}),
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
