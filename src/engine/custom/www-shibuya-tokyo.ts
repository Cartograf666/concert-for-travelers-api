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

function inferYearMonth($: cheerio.CheerioAPI): { year: number; month: number } | undefined {
  const nextHref = $('a.pageLink[href*="/schedule/20"]').last().attr('href') || '';
  const nextMatch = nextHref.match(/schedule\/(\d{4})(\d{2})\.php/);
  if (nextMatch) {
    const next = new Date(Date.UTC(Number(nextMatch[1]), Number(nextMatch[2]) - 1, 1));
    next.setUTCMonth(next.getUTCMonth() - 1);
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
  }

  const prevHref = $('a.pageLink[href*="/schedule/20"]').first().attr('href') || '';
  const prevMatch = prevHref.match(/schedule\/(\d{4})(\d{2})\.php/);
  if (!prevMatch) return undefined;

  const prev = new Date(Date.UTC(Number(prevMatch[1]), Number(prevMatch[2]) - 1, 1));
  prev.setUTCMonth(prev.getUTCMonth() + 1);
  return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 };
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const current = inferYearMonth($);
  if (!current) {
    throw new Error('Could not infer WWW schedule year/month from pagination links');
  }

  const concerts: Partial<Concert>[] = [];

  $('#eventList article.column').each((_, el) => {
    const block = $(el);
    const artist = block.find('h3.title').first().text().replace(/\s+/g, ' ').trim();
    const day = Number(block.find('.date .day').first().text().trim());
    const href = block.find('a.pageLink').first().attr('href');
    if (!artist || !day) return;

    const date = `${current.year}-${String(current.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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
