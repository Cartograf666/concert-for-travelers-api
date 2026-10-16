import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

// The official listing stores venue and city in one text node. Standard
// selectors cannot split it; reject unsupported geography instead of guessing RU.
const CITIES = new Set(['Москва', 'Санкт-Петербург']);

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (config.url !== 'http://www.bravogroup.ru/show_all.htm' || config.domain !== 'www.bravogroup.ru' ||
      $('ul.afishaTable').length !== 1) throw new Error('Bravo official calendar identity is missing');
  const concerts: Partial<Concert>[] = [];
  $('ul.afishaTable > li').each((_, element) => {
    const row = $(element);
    const date = row.find('div.date').text().trim();
    const location = row.find('div.name > a:not(.buyButton)').text().replace(/\s+/g, ' ').trim();
    const comma = location.lastIndexOf(',');
    const venue = location.slice(0, comma).trim();
    const city = location.slice(comma + 1).trim();
    if (comma < 1 || !venue || !CITIES.has(city) || !/\b20\d{2}\b/.test(date)) {
      throw new Error('Bravo calendar has an unverified date or location');
    }
    const ticket = row.find('a.buyButton').attr('href');
    if (!ticket || !/^https:\/\//.test(ticket)) throw new Error('Bravo ticket URL is missing or unsafe');
    concerts.push({ artist: 'Браво', date, venue, city, country: 'RU', ticketUrl: ticket,
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
