import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const COUNTRIES: Readonly<Record<string, string>> = {
  usa: 'US', india: 'IN', canada: 'CA'
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $(config.selectors?.eventBlock || '.entry-content p').each((_, element) => {
    const row = $(element);
    const lines = (row.html() || '').split(/<br\s*\/?\s*>/i)
      .map(fragment => clean(cheerio.load(fragment).text()));
    const heading = lines[0].match(/^(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*[–-]\s*(.+)$/);
    if (!heading) return;
    const location = heading[2].split(',').map(clean);
    const country = COUNTRIES[location.at(-1)?.toLowerCase() || ''];
    const rawCity = location[0];
    // "Colorado, USA" gives a state, not a city. The page does not identify
    // Broomfield as the city even though one venue includes it in its name.
    const city = rawCity === 'Colorado' ? undefined : rawCity;
    const venue = lines.find(line => /^Venue:\s*/i.test(line))?.replace(/^Venue:\s*/i, '').trim();
    if (!venue) return;
    const href = row.find('a[href]').first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'L. Subramaniam',
      date: heading[1], venue, city, country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
