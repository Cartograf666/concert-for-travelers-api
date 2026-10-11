import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
// Exact venues from the native Spanish Tour 2026 promoter and linked venue
// records, not countries inferred from ticket domains or provider counterparts.
const VERIFIED_COUNTRIES: Record<string, string> = {
  'Oviedo|Almacenes Kuivi': 'ES', 'Bilbao|Antzokia': 'ES',
  'Zaragoza|Jardin de Invierno': 'ES', 'Pamplona|Zentral': 'ES',
  'Madrid|Sala Wagon': 'ES', 'Valencia|Sala Moon': 'ES',
  'Barcelona|Razzmatazz 2': 'ES', 'Lyon|Marché Gare': 'FR',
  'Bruges|Cactus Club': 'BE',
};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  if (config.url !== 'https://www.teenagefanclub.com/live' || config.domain !== 'www.teenagefanclub.com') {
    throw new Error('Teenage Fanclub native source identity mismatch');
  }
  const $ = cheerio.load(html);
  const concerts: RawConcert[] = [];
  $('.sqs-html-content').each((_, element) => {
    let headingYear: string | undefined;
    $(element).children('h1,h2,h3,p').each((_, child) => {
      const block = $(child);
      const text = compact(block.text());
      if (block.is('h1,h2,h3')) {
        headingYear = /^Tour Dates (20\d{2})$/i.exec(text)?.[1];
        return;
      }
      if (!headingYear) return;
      const match = /^([A-Za-z]+) (\d{1,2}), (20\d{2})\s+[-–—]\s+(.+?)\s+[-–—]\s+(.+)$/.exec(text);
      if (!match || match[3] !== headingYear) return;
      const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
      const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!month || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return;
      const parts = match[5].split(/\s+[-–—]\s+/).map(compact);
      while (parts.length && /^(?:Tickets|SOLD OUT|Free entry)$/i.test(parts.at(-1)!)) parts.pop();
      const venue = parts.filter((part, index) => part && part !== parts[index - 1]).join(' - ');
      const city = match[4];
      if (!venue || !city) return;
      const href = block.find('a[href]').first().attr('href');
      const url = href ? safeAbsoluteUrl(href, config.url) : undefined;
      const country = VERIFIED_COUNTRIES[`${city}|${venue}`];
      // Unknown countries remain observable raw rows, not a guessed GB fallback.
      concerts.push({
        artist: 'Teenage Fanclub', date, venue, city, country,
        ticketUrl: url, sourceEventUrl: url, originalSource: config.domain, scrapedAt,
      });
    });
  });
  return concerts;
}
