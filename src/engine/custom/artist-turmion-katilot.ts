import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  return $('.fl-rich-text p:has(strong)').map((_, element) => {
    const row = $(element);
    const printed = row.find('strong').first().text().trim();
    const match = /^(\d{2})\.(\d{2})\.(20\d{2})$/.exec(printed);
    const date = match ? parseDate(`${match[3]}-${match[2]}-${match[1]}`, scrapedAt) : null;
    if (!date) throw new Error('Turmion Katilot show lacks an explicit native date');
    const rest = row.text().replace(/\s+/g, ' ').trim().slice(printed.length).trim();
    const place = /^(?:([A-Z]{2}) )?([^,]+), (.+)$/.exec(rest);
    const code = place?.[1];
    const country = code && normalizeCountry(code) === code ? code : undefined;
    const venue = place ? (row.find('a').first().text().trim() || place[3]) : undefined;
    let city = place?.[2];
    if (country === 'AT' && city === 'Vienna' && venue === 'Szene Wien') city = 'Wien';
    if (country === 'DE' && city === 'Munich' && venue === 'Backstage Halle') city = 'München';
    // The venue's own contact address is Hauptstr. 73, 69509 Mörlenbach.
    if (country === 'DE' && city === 'Weiher' && venue === 'Live Music Hall') city = 'Mörlenbach';
    const href = row.find('a').first().attr('href');
    return { artist: config.selectors?.artistNameFallback || 'Turmion Kätilöt', date,
      venue, city, country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt };
  }).get();
}
