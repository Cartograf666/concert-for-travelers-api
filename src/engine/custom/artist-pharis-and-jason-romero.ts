import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { bandsintownCountryToCode } from '../bandsintown.js';
import { safeAbsoluteUrl } from '../url.js';

function artistKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
}

/** The Squarespace Tour Dates block adds JSON-LD only after its public widget loads. */
export async function scrapeTourDates(config: ScraperConfig, html: string, scrapedAt: string,
  widgetArtist: string, canonicalArtist: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  const block = $('.tourdates-block[data-block-type="59"]');
  if (!block.length || !String(block.attr('data-block-json') || '').includes(widgetArtist)) return concerts;

  block.find('.sqs-tourdates-bandsintown-list-content script[type="application/ld+json"]').each((_, script) => {
    let events: unknown;
    try {
      events = JSON.parse($(script).html() || '');
    } catch {
      return;
    }
    for (const item of Array.isArray(events) ? events : [events]) {
      if (!item || typeof item !== 'object') continue;
      const event = item as Record<string, any>;
      if (event['@type'] !== 'MusicEvent' || artistKey(event.performer?.name) !== artistKey(widgetArtist)) continue;
      const rawDate = event.startDate;
      if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawDate)) continue;
      const date = rawDate.slice(0, 10);
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) continue;
      const venue = event.location?.name;
      const city = event.location?.address?.addressLocality;
      const country = bandsintownCountryToCode(event.location?.address?.addressCountry);
      if (typeof venue !== 'string' || !venue.trim() || typeof city !== 'string' || !city.trim() || !country) continue;
      const offer = Array.isArray(event.offers) ? event.offers[0] : event.offers;
      const rawUrl = typeof offer?.url === 'string' ? offer.url : event.url;
      const ticketUrl = typeof rawUrl === 'string' ? safeAbsoluteUrl(rawUrl, config.url) : undefined;
      concerts.push({
        artist: canonicalArtist, date, startTime: rawDate.slice(11, 16), venue: venue.trim(),
        city: city.trim(), country, ticketUrl,
        originalSource: config.domain, scrapedAt
      });
    }
  });
  return concerts;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  return scrapeTourDates(config, html, scrapedAt, 'Pharis & Jason Romero', 'Pharis and Jason Romero');
}
