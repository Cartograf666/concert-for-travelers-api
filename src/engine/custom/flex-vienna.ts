import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

const MONTHS: Record<string, number> = {
  januar: 1,
  jänner: 1,
  februar: 2,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12
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

  $('.ewpe-inner-wrapper').each((_, el) => {
    const block = $(el);
    const titleLink = block.find('a.event-link').first();
    const artist = block.find('.ewpe-event-title').first().text().replace(/\s+/g, ' ').trim();
    const rawDate = block.find('.ewpe-events-schedule').first().text().replace(/\s+/g, ' ').trim().toLowerCase();
    const match = rawDate.match(/(\d{1,2})\.\s+([a-zäöüß]+)/);
    if (!artist || !match) return;

    const day = Number(match[1]);
    const month = MONTHS[match[2]];
    if (!month) return;

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
      ticketUrl: absoluteUrl(titleLink.attr('href'), config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
