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

  $('.action-boxes [itemscope][itemtype="http://schema.org/Event"]').each((_, el) => {
    const block = $(el);
    const artist = block.find('.abb-text h3 [itemprop="name"]').first().text().replace(/\s+/g, ' ').trim();
    const rawDate = block.find('meta[itemprop="startDate"]').attr('content') || '';
    const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
    const href = block.find('a.abbl-detail').attr('href') || block.find('h3 a').attr('href');
    if (!artist || !date) return;

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
