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

  $('a.eventCard').each((_, el) => {
    const block = $(el);
    const artist = block.find('.eventCard__details__title').text().replace(/\s+/g, ' ').trim();
    const rawDate = block.find('meta[itemprop="startDate"]').attr('content') || '';
    const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
    if (!artist || !date) return;

    const artistLower = artist.toLowerCase();
    if (artistLower.includes('høt spøt') || artistLower.includes('hot spot') || artistLower.includes('every wednesday')) return;

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
