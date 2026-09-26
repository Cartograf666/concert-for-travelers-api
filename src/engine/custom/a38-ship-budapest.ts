import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

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

  // A38's 2026 redesign replaced anchor-based `eventCard` rows with schema.org
  // `program-row` divs. Keep the legacy selector while cached/older markup can
  // still be served, and read the new row's canonical URL from its metadata.
  $('a.eventCard, .program-row[itemtype$="/MusicEvent"]').each((_, el) => {
    const block = $(el);
    const isLegacyCard = block.is('a.eventCard');
    if (!isLegacyCard && block.hasClass('program-canceled')) return;

    const artist = block
      .find(isLegacyCard ? '.eventCard__details__title' : '.program-title[itemprop="name"]')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const rawDate = block.find('meta[itemprop="startDate"]').attr('content') || '';
    const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
    if (!artist || !date) return;

    const artistLower = artist.toLowerCase();
    if (artistLower.includes('høt spøt') || artistLower.includes('hot spot') || artistLower.includes('every wednesday')) return;

    const ticketPath = isLegacyCard
      ? block.attr('href')
      : block.find('meta[itemprop="url"]').attr('content') || block.find('a[href]').first().attr('href');

    concerts.push({
      artist,
      date,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl: absoluteUrl(ticketPath, config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
