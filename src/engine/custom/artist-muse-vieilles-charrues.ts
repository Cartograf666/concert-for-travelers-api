import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const edition = /Vieilles Charrues (20\d{2})/.exec($('title').text());
  if (!edition) return [];
  const concerts: Partial<Concert>[] = [];
  $('.wysiwyg').each((_, el) => {
    const card = $(el);
    if (card.find('h1').text().trim().toUpperCase() !== 'MUSE' || /annul[ée]|cancel|report[ée]/i.test(card.text())) return;
    const printed = card.find('h3').text().trim();
    const day = /^(?:LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE) (\d{1,2}) JUILLET$/i.exec(printed);
    const date = day ? `${edition[1]}-07-${day[1].padStart(2, '0')}` : '';
    if (!date || parseDate(date, scrapedAt) !== date) return;
    const ticket = $('a[href]').filter((_, a) => $(a).text().trim() === 'Billetterie').first().attr('href');
    concerts.push({ artist: 'Muse', date, venue: 'Festival Les Vieilles Charrues', city: 'Carhaix', country: 'FR',
      ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
