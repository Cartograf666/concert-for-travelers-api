import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const REGIONS = new Set(['ENG', 'SCT', 'WLS']);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/** The official page groups DD Month | CITY, VENUE (region) rows under year headings. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('div.entry-content').each((_, content) => {
    let year: string | undefined;
    $(content).children('h2, h3, p.wp-block-paragraph').each((_, element) => {
      const block = $(element);
      if (block.is('h2, h3')) {
        const heading = block.text().trim();
        year = /^20\d{2}$/.test(heading) ? heading : undefined;
        return;
      }
      if (!year) return;

      // Later lines contain the show format/support acts and ticket-link labels.
      const firstStrong = block.find('strong').first().clone();
      firstStrong.find('br').replaceWith('\n');
      const line = firstStrong.text().split('\n')[0].replace(/\s+/g, ' ').trim();
      const match = line.match(/^(\d{1,2}) ([A-Za-z]+)\s*\|\s*([^,|()]+),\s*([^|()]+)\s+\(([A-Z]{3})\)$/);
      if (!match || !REGIONS.has(match[5])) return;
      const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
      if (!month) return;
      const date = `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
      const city = match[3].trim();
      const venue = match[4].trim();
      if (!city || !venue) return;
      const href = block.find('a').first().attr('href');
      concerts.push({
        artist: config.selectors?.artistNameFallback || 'Hue & Cry',
        date,
        city,
        venue,
        country: 'GB', // Only the three explicitly observed UK constituent-country markers above.
        ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
        originalSource: config.domain,
        scrapedAt
      });
    });
  });
  return concerts;
}
