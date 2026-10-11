import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  return $('.nectar-hor-list-item').map((_, element) => {
    const row = $(element);
    const fields = row.find('.nectar-list-item h3');
    const printed = fields.eq(0).text().trim();
    const date = /^\d{1,2}(?:st|nd|rd|th) [A-Za-z]+ 20\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    if (!date) throw new Error('Burak Yeter event lacks an explicit full date');
    const place = /^(.+), (.+) - (.+)$/.exec(fields.eq(1).text().trim());
    const country = place ? normalizeCountry(place[3]) : undefined;
    const verified = country && /^[A-Z]{2}$/.test(country);
    const href = row.find('a[href]').first().attr('href');
    return { artist: 'Burak Yeter', date, venue: verified ? place![1] : undefined,
      city: verified ? place![2] : undefined, country: verified ? country : undefined,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt };
  }).get();
}
