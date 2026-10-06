import * as cheerio from 'cheerio';
import { parseDate } from '../../pipeline/process.js';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i;
const PERFORMER_ROLE = /\b(?:directed by Paul Halley|original compositions played by Paul Halley)\b/i;

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('.layout--twocol').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    const dateText = text.match(DATE)?.[0];
    if (!dateText) return;
    const date = parseDate(dateText, scrapedAt.slice(0, 10));
    if (!date) throw new Error(`Paul Halley schedule has an invalid date: ${dateText}`);
    // The latest two documented performances are in 2025. Earlier archive
    // formats vary and do not establish a current performer/location contract.
    if (date < '2025-01-01' || !PERFORMER_ROLE.test(text)) return;
    if (!text.includes('The Cathedral Church of All Saints') || !/\bHalifax,\s*NS\b/.test(text)) {
      throw new Error(`Paul Halley concert ${date} is missing a verified venue or location`);
    }
    concerts.push({
      artist: 'Paul Halley', date, venue: 'The Cathedral Church of All Saints',
      city: 'Halifax', country: 'CA', originalSource: config.domain, scrapedAt
    });
  });
  return concerts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
