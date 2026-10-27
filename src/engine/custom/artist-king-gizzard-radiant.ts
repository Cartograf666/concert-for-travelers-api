import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const heading = $('h1').filter((_, el) => $(el).text().trim() === 'KING GIZZARD & THE LIZARD WIZARD').first();
  if (!heading.length) return [];
  const card = heading.parent();
  if (/annul[ée]|report[ée]|cancelled|postponed/i.test(card.text() + $('.spectacle-main-center').text())) return [];
  const m = /^(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2})\s+juin\s+(20\d{2})$/i.exec(card.find('p.sstitre').text().trim());
  const date = m ? `${m[2]}-06-${m[1].padStart(2, '0')}` : '';
  if (!date || parseDate(date, scrapedAt) !== date || !/69300\s+CALUIRE ET CUIRE/.test($('li').text())) return [];
  const ticket = card.find('a[href*="/meeting/"]').attr('href');
  return [{ artist: 'King Gizzard & The Lizard Wizard', date, venue: 'Radiant-Bellevue', city: 'Caluire et Cuire', country: 'FR',
    eventUrl: config.url, ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined, originalSource: config.domain, scrapedAt }];
}
