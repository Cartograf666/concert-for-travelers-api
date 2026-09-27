import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function displayCity(value: string): string {
  const city = clean(value);
  if (city !== city.toUpperCase()) return city;
  return city.toLocaleLowerCase('en-GB').replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-GB'));
}

/** Wix exposes the city in the event title and the country at the end of its full address. */
function parseLocation(title: string, address: string): { city: string; country: 'GB' } | null {
  if (!/,\s*UK\s*$/i.test(clean(address))) return null;
  const cityMatch = clean(title).match(/^(.+?)\s*\(/);
  if (!cityMatch) return null;
  const city = displayCity(cityMatch[1]);
  return city ? { city, country: 'GB' } : null;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $("li[data-hook='event-list-item']").each((_, element) => {
    const block = $(element);
    const date = clean(block.find("[data-hook='date']").first().text());
    const venue = clean(block.find("[data-hook='ev-list-item-location']").first().text());
    const location = parseLocation(
      block.find("[data-hook='ev-list-item-title']").first().text(),
      block.find("[data-hook='location']").first().text()
    );
    if (!date || !venue || !location) return;

    const href = block.find("a[data-hook='ev-rsvp-button']").first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Barbara Dickson',
      date,
      venue,
      city: location.city,
      country: location.country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
