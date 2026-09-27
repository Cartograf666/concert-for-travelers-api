import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
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
    const monthLabel = block.find('.date__month').text().replace(/\./g, '').trim().toLowerCase();
    const [monthName, displayedYear] = monthLabel.split(/\s+/);
    const day = Number(block.find('.date__day').text().replace('.', '').trim());
    const month = MONTHS[monthName];
    if (!artist || !month || !day) return;

    const explicitYear = Number(displayedYear);
    const year = Number.isInteger(explicitYear) && explicitYear >= 2000 && explicitYear <= 2100
      ? explicitYear
      : inferYear(month);
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
