import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/i;
const US_STATES: Readonly<Record<string, string>> = { TX: 'US', California: 'US' };
const COUNTRIES: Readonly<Record<string, string>> = { Germany: 'DE', England: 'GB' };

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $(config.selectors?.eventBlock || "table[width='720'] td[style='padding-right:5px'] p:has(b.red)")
    .each((_, element) => {
      const row = $(element);
      const date = clean(row.find('b.red').first().text()).match(DATE)?.[0];
      const lines = (row.html() || '').split(/<br\s*\/?\s*>/i)
        .map(fragment => clean(cheerio.load(fragment).text()));
      const venue = lines[1];
      const location = lines.slice(2).map(line => line.match(/^([^,]+),\s*([^,\d]+)(?:\s+\d+)?$/))
        .find(Boolean);
      if (!date || !venue || !location) return;
      const city = clean(location[1]);
      const region = clean(location[2]);
      const country = US_STATES[region] || COUNTRIES[region];
      concerts.push({
        artist: config.selectors?.artistNameFallback || 'Legs Diamond',
        date, venue, city, country,
        originalSource: config.domain, scrapedAt
      });
    });
  return concerts;
}
