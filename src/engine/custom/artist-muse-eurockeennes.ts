import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!/Eurockéennes de Belfort/i.test($('title').text())) return [];
  const concerts: Partial<Concert>[] = [];
  const seen = new Set<string>();
  // The organizer's news title explicitly ties the artist to its performance
  // day. Never take the festival window or the article publication timestamp.
  $('a.uneactu, a.uneactumin').each((_, el) => {
    const link = $(el);
    const title = link.attr('title') || '';
    const m = /^MUSE clôture le festival (?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2}) juillet (20\d{2})$/i.exec(title);
    if (!m) return;
    const date = `${m[2]}-07-${m[1].padStart(2, '0')}`;
    if (parseDate(date, scrapedAt) !== date || seen.has(date)) return;
    const eventUrl = safeAbsoluteUrl(link.attr('href') || '', config.url);
    if (!eventUrl || new URL(eventUrl).hostname !== config.domain) return;
    seen.add(date);
    concerts.push({ artist: 'Muse', date, venue: 'Les Eurockéennes', city: 'Belfort', country: 'FR',
      eventUrl, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
