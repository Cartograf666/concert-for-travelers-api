import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Kolarac's monthly program glues artist, date, and room into a single text
 * blob with no separating markup (e.g. "Ema Stanilović8 June 2026 at 18Music
 * Gallery"). This splits on the date substring to recover a clean artist name.
 */
const DATE_RE = /\d{1,2}\s+\S+\s+\d{4}\s+at\s+\d{1,2}/;

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('article.post').each((_, el) => {
    const anchor = $(el).find('h3.entry-title a').first();
    const text = (anchor.attr('title') || anchor.text()).trim();
    const href = anchor.attr('href');

    const match = text.match(DATE_RE);
    if (!match) return;

    const artistText = text.slice(0, match.index).trim();
    const dateText = match[0].trim();
    if (!artistText || !dateText) return;

    let ticketUrl: string | undefined;
    if (href) {
      try {
        ticketUrl = new URL(href, config.url).toString();
      } catch {
        ticketUrl = href;
      }
    }

    concerts.push({
      artist: artistText,
      date: dateText,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
