import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS: Record<string, string> = {
  janeiro: '01', fevereiro: '02', 'março': '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('li.event').each((_, element) => {
    const block = $(element);
    const dateMatch = block.find('.event-line-node').first().text().trim().match(/^(\d{1,2}) de ([a-zç]+) de (\d{4})$/i);
    const location = block.find('.event-line-node.medium').first().text().trim().match(/^(.+?)\s+\([A-Z]{2}\),\s+(.+)$/);
    if (!dateMatch || !location || !MONTHS[dateMatch[2].toLowerCase()]) return;
    const date = `${dateMatch[3]}-${MONTHS[dateMatch[2].toLowerCase()]}-${dateMatch[1].padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
    const href = block.find('a.event-link[href]').first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Os Paralamas do Sucesso', date,
      venue: location[2].trim(), city: location[1].trim(), country: 'BR',
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
