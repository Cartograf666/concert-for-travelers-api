import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function inferYear(month: number): number {
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  return month < currentMonth ? currentYear + 1 : currentYear;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('a.grid-item.m-card').each((_, el) => {
    const block = $(el);
    const artist = block.find('.m-card__description .h5').text().replace(/\s+/g, ' ').trim();
    const monthName = block.find('.date__month').text().replace('.', '').trim().toLowerCase();
    const day = Number(block.find('.date__day').text().replace('.', '').trim());
    const month = MONTHS[monthName];
    if (!artist || !month || !day) return;

    const year = inferYear(month);
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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
