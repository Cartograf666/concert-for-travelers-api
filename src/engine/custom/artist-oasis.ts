import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  return $('.live-listing > li').map((_, element) => {
    const row = $(element);
    const printed = row.find('.live-date').text().replace(/\s+/g, ' ').trim();
    const date = /^\d{1,2} [A-Za-z]{3} 20\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    if (!date) throw new Error('Oasis event lacks an explicit native year/date');
    const location = row.children('span').eq(1).clone();
    location.find('br').replaceWith('\n');
    const lines = location.text().split('\n').map(value => value.trim()).filter(Boolean);
    const parts = lines[0]?.split(',').map(value => value.trim()) || [];
    const country = parts.length === 2 && parts[1].length > 2 && parts[1].toLowerCase() !== 'georgia'
      ? normalizeCountry(parts[1]) : undefined;
    const label = parts[0];
    // The source labels these two counties, not the actual concert municipality.
    let city = label && !['Hertfordshire', 'Co. Meath'].includes(label) ? label : undefined;
    // Boston is the marketed region; the public venue is in Foxborough and its
    // primary directions page is currently unavailable. Do not create that alias.
    if (city === 'Boston' && lines[1] === 'Gillette Stadium' && country === 'US') city = undefined;
    return { artist: 'Oasis', date, venue: lines[1], city,
      country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
      originalSource: config.domain, scrapedAt };
  }).get();
}
