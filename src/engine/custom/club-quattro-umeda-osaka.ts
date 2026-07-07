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

  $('li.list-item').each((_, el) => {
    const block = $(el);

    // Extract date from data-event-date attribute
    const dateAttr = block.attr('data-event-date');
    if (!dateAttr) return;

    // Extract artist name from p.txt-01 span.hv-elm
    const artistEl = block.find('p.txt-01 span.hv-elm');
    const artist = artistEl.text().replace(/\s+/g, ' ').replace(/<br\s*\/?>/g, ' ').trim();
    if (!artist) return;

    // Extract ticket URL
    const ticketLink = block.find('a.event-box').first();
    const href = ticketLink.attr('href') || '';

    concerts.push({
      artist,
      date: dateAttr,
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
