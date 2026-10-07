import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry } from '../../pipeline/process.js';

const PAGE = 'https://www.mellencamp.com/tour';
const ARTIST = 'John Mellencamp';

type EventNode = Record<string, unknown>;

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value: unknown): EventNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as EventNode : null;
}

function eventDate(value: unknown): string {
  const raw = field(value);
  const match = /^(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])(?:T|$)/.exec(raw);
  if (!match) throw new Error('John Mellencamp event has no ISO date');
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('John Mellencamp event has an impossible date');
  }
  return date;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const widget = $('.widget-events--default');
  if (config.url !== PAGE || config.domain !== 'www.mellencamp.com' ||
      config.selectors?.artistNameFallback !== ARTIST ||
      $('head > title').text().trim() !== 'Tour | John Mellencamp' ||
      $('h1').filter((_, node) => $(node).text().trim() === 'Tour').length !== 1 ||
      widget.length !== 1) {
    throw new Error('John Mellencamp official tour calendar identity or widget is missing');
  }

  const schema = widget.next('script[type="application/ld+json"]');
  if (schema.length !== 1) throw new Error('John Mellencamp calendar event data is missing');
  let events: unknown;
  try { events = JSON.parse(schema.text()); } catch { throw new Error('John Mellencamp calendar event data is invalid'); }
  if (!Array.isArray(events)) throw new Error('John Mellencamp calendar event data is not an array');
  const hasCards = widget.children().length > 0 || widget.text().trim().length > 0;
  if (hasCards !== (events.length > 0)) {
    throw new Error('John Mellencamp calendar cards and event data disagree');
  }
  if (events.length === 0) return [];

  return events.map(value => {
    const event = object(value);
    const performer = object(event?.performer);
    const location = object(event?.location);
    const address = object(location?.address);
    if (!event || !['Event', 'MusicEvent'].includes(field(event['@type'])) ||
        field(performer?.name) !== ARTIST || !location || !address) {
      throw new Error('John Mellencamp calendar event identity or location is invalid');
    }
    const venue = field(location.name);
    const city = field(address.addressLocality);
    const country = field(address.addressCountry).toUpperCase();
    if (!venue || !city || !/^[A-Z]{2}$/.test(country) || normalizeCountry(country) !== country) {
      throw new Error('John Mellencamp calendar event lacks a complete location');
    }
    const rawUrl = field(event.url);
    if (rawUrl) {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('John Mellencamp calendar event URL is unsafe');
      }
    }
    return {
      artist: ARTIST, date: eventDate(event.startDate), venue, city, country,
      ticketUrl: rawUrl || PAGE, originalSource: config.domain, scrapedAt
    };
  });
}
