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
    const country = place && place[3].toLowerCase() !== 'georgia' ? normalizeCountry(place[3]) : undefined;
    const verified = country && /^[A-Z]{2}$/.test(country);
    let venue = verified ? place![1].split('@').at(-1)?.trim() : undefined;
    let city = verified ? place![2] : undefined;
    // Hatay is a province; the venue name alone does not prove the actual city.
    if (venue === 'Diva Hotel Arsuz' && city === 'Hatay') city = undefined;
    // This is an event-series title, with no physical venue printed in the record.
    if (venue === `It's "Night Out by Savage Unlimited"`) venue = undefined;
    const href = row.find('a[href]').first().attr('href');
    return { artist: 'Burak Yeter', date, venue, city, country: verified ? country : undefined,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt };
  }).get();
}
