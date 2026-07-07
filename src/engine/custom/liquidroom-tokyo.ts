import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('article').each((_, el) => {
    const block = $(el);
    const link = block.find('a.s_link').first();
    const artist = block.find('h2').first().text().replace(/\s+/g, ' ').trim();
    const href = link.attr('href') || '';
    const rawDate = href.match(/_(\d{8})(?:\/)?$/)?.[1];
    if (!artist || !rawDate) return;

    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

    concerts.push({
      artist,
      date,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl: absoluteUrl(href, config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
