import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const months = new Map(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((month, index) => [month, index + 1]));
const countries: Record<string, string> = {PA: 'US', MA: 'US', MI: 'US', FL: 'US', CA: 'US', CO: 'US', Netherlands: 'NL', Germany: 'DE', Denmark: 'DK', Switzerland: 'CH', France: 'FR', England: 'GB'};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('CRO-MAGS')) throw new Error('Cro-Mags official calendar identity changed');
  const yearHeading = $('.nectar-hor-list-item h2').filter((_, element) => $(element).text().trim() === '2026 Tour Dates');
  if (yearHeading.length !== 1) throw new Error('Cro-Mags calendar year heading changed');
  const schedule = $('.nectar-hor-list-item h4').filter((_, element) => $(element).text().trim() === 'December 4').first().closest('.row_col_wrap_12');
  const columns = schedule.find('.vc_col-sm-4');
  if (columns.length !== 3) throw new Error('Cro-Mags calendar columns changed');
  const cells = columns.toArray().map(column => $(column).find('.nectar-hor-list-item h4').toArray().map(element => $(element).text().trim()));
  if (!cells[0].length || cells.some(column => column.length !== cells[0].length)) throw new Error('Cro-Mags calendar columns are not aligned');
  return cells[0].flatMap((rawDate, index) => {
    const match = /^([A-Z][a-z]+) (\d{1,2})$/.exec(rawDate);
    const month = match && months.get(match[1]);
    if (!match || !month) throw new Error(`Cro-Mags concert date is invalid: ${rawDate}`);
    const date = `2026-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    if (date < scrapedAt.slice(0, 10)) return [];
    const place = /^(.+), (.+)$/.exec(cells[1][index]);
    const venue = cells[2][index].replace(/^@\s*/, '').trim();
    const country = place && countries[place[2]];
    if (!place || !country || !venue) throw new Error(`Cro-Mags concert row is incomplete: ${rawDate}`);
    return [{
      artist: 'Cro-Mags', date,
      venue, city: place[1], country, ticketUrl: config.url, originalSource: config.domain, scrapedAt
    }];
  });
}
