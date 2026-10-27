import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const heading = $('h1.event-hero__title');
  if (heading.text().trim() !== 'King Gizzard & The Lizard Wizard') return [];
  const card = heading.parent();
  if (/cancelled|canceled|postponed/i.test(card.text())) return [];
  const printed = card.find('p.date').text().trim();
  if (!/^[A-Za-z]+ \d{1,2}(?:st|nd|rd|th) [A-Za-z]+ 20\d{2}$/.test(printed)) return [];
  const date = parseDate(printed, scrapedAt);
  if (!date || !/45 Queen Caroline Street, London, England/.test($('body').text())) return [];
  const ticket = card.find('a.btn--tickets[href]').first().attr('href');
  return [{ artist: 'King Gizzard & The Lizard Wizard', date, venue: 'Eventim Apollo', city: 'London', country: 'GB',
    eventUrl: config.url, ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined, originalSource: config.domain, scrapedAt }];
}
