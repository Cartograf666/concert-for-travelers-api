import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!/Sequoie Music Park, Bologna/i.test($('title').text())) return [];
  const years = $('h2').map((_, el) => $(el).text().trim()).get().filter(text => /^20\d{2}$/.test(text));
  if (years.length !== 1) return [];
  const concerts: Partial<Concert>[] = [];
  $('h2').each((_, el) => {
    const heading = $(el).clone(); heading.find('br').replaceWith(' ');
    const text = heading.text().replace(/\s+/g, ' ').trim();
    const m = /^(\d{1,2}) GIUGNO - KING GIZZARD & THE LIZARD WIZARD$/.exec(text);
    if (!m) return;
    const date = `${years[0]}-06-${m[1].padStart(2, '0')}`;
    if (parseDate(date, scrapedAt) !== date) return;
    const ticket = $('a[href]').filter((_, a) => {
      const href = $(a).attr('href') || '';
      return href.startsWith('https://www.ticketone.it/event/king-gizzard-and-the-lizard-wizard-');
    }).first().attr('href');
    concerts.push({ artist: 'King Gizzard & The Lizard Wizard', date, venue: 'Sequoie Music Park', city: 'Bologna', country: 'IT',
      ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
