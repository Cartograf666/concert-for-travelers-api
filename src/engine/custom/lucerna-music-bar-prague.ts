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

  $('a.program-item').each((_, el) => {
    const block = $(el);
    const artist = block.find('p').first().text().replace(/\s+/g, ' ').trim();
    const rawHtml = $.html(el);
    const match = rawHtml.match(/timestamp["']>\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!artist || !match) return;

    const [, day, month, year] = match;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    if (artist.toLowerCase().includes('video party')) return;

    concerts.push({
      artist,
      date,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl: absoluteUrl(block.attr('href'), config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
