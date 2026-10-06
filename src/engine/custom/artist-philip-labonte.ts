import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry } from '../../pipeline/process.js';
import { bandsintownCountryToCode } from '../bandsintown.js';
import { fetchHtmlForHealing } from '../runner.js';

const PAGE = 'https://allthatremainsonline.com/pages/tour';
const ARTIST = 'All That Remains';
const ARTIST_ID = '513';
const MBID = '4f8b7186-b2a2-40db-97ae-6e1cd46d57b1';
const API = 'https://rest.bandsintown.com/V3.1/artists/All%20That%20Remains';
const APP_ID = 'js_allthatremainsonline.com';
const PROFILE_URL = `${API}?app_id=${APP_ID}`;
const EVENTS_URL = `${API}/events/?app_id=${APP_ID}`;
// The config schema requires a two-letter country fallback. Its ZZ sentinel is
// never read here; every event must provide an explicit mapped country.

function parseJson(raw: string, kind: string): unknown {
  try { return JSON.parse(raw); } catch { throw new Error(`All That Remains ${kind} is not JSON`); }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`All That Remains missing ${label}`);
  return value.trim();
}

function dateFrom(value: unknown): string {
  const raw = required(value, 'event date');
  const match = /^(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])T\d{2}:\d{2}:\d{2}/.exec(raw);
  if (!match) throw new Error('All That Remains invalid event date');
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('All That Remains impossible event date');
  }
  return date;
}

function readEvents(raw: string, count: number, config: ScraperConfig, scrapedAt: string): Partial<Concert>[] {
  const data = parseJson(raw, 'events API');
  if (!Array.isArray(data)) throw new Error('All That Remains events API is not an array');
  if (data.length !== count) throw new Error('All That Remains profile/feed event count mismatch');
  const ids = new Set<string>();
  return data.map(value => {
    const event = object(value);
    if (!event || event.artist_id !== ARTIST_ID) throw new Error('All That Remains event artist identity mismatch');
    const id = required(event.id, 'event id');
    if (ids.has(id)) throw new Error('All That Remains duplicate event id');
    ids.add(id);
    if (event.artist !== undefined) {
      const artist = object(event.artist);
      if (!artist || artist.name !== ARTIST || String(artist.id) !== ARTIST_ID || artist.mbid !== MBID) {
        throw new Error('All That Remains event profile identity mismatch');
      }
    }
    if (event.lineup !== undefined &&
        (!Array.isArray(event.lineup) || !event.lineup.includes(ARTIST))) {
      throw new Error('All That Remains missing group in event lineup');
    }
    const date = dateFrom(event.starts_at ?? event.datetime);
    if (event.starts_at !== undefined && event.datetime !== undefined && dateFrom(event.datetime) !== date) {
      throw new Error('All That Remains conflicting event dates');
    }
    const venue = object(event.venue);
    if (!venue) throw new Error('All That Remains missing event venue');
    const country = bandsintownCountryToCode(required(venue.country, 'event country'));
    // The shared Bandsintown mapper passes arbitrary two-letter strings through;
    // validate against the pipeline's actual ISO set before accepting the source.
    if (!country || normalizeCountry(country) !== country) {
      throw new Error('All That Remains unknown event country');
    }
    const ticketUrl = event.url === undefined ? config.url : required(event.url, 'event URL');
    const ticket = new URL(ticketUrl);
    if (ticket.protocol !== 'https:' || ticket.username || ticket.password ||
        (event.url !== undefined && ticket.hostname !== 'www.bandsintown.com')) {
      throw new Error('All That Remains unsafe event URL');
    }
    return {
      artist: ARTIST, date,
      venue: required(venue.name, 'event venue name'),
      city: required(venue.city, 'event city'), country, ticketUrl,
      originalSource: config.domain, scrapedAt
    };
  });
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url, 'got-scraping')): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const widget = $('a.bit-widget-initializer');
  if (config.url !== PAGE || config.domain !== 'allthatremainsonline.com' ||
      config.selectors?.artistNameFallback !== ARTIST ||
      $('head > title').text().replace(/\s+/g, ' ').trim() !== 'Tour – All That Remains Official' ||
      $('link[rel="canonical"]').attr('href') !== PAGE ||
      $('h1').filter((_, node) => $(node).text().trim() === 'Tour').length !== 1 ||
      widget.length !== 1 || widget.attr('data-artist-name') !== ARTIST ||
      widget.attr('data-display-past-dates') !== 'false' ||
      $('script[src="https://widget.bandsintown.com/main.min.js"]').length !== 1) {
    throw new Error('All That Remains official tour page or native widget identity is missing');
  }
  const profile = object(parseJson(await fetchPage(PROFILE_URL), 'artist profile'));
  const count = profile?.upcoming_event_count;
  if (!profile || String(profile.id) !== ARTIST_ID || profile.name !== ARTIST ||
      profile.mbid !== MBID || !Number.isSafeInteger(count) || (count as number) < 0) {
    throw new Error('All That Remains native artist profile identity or count mismatch');
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  return readEvents(await fetchPage(EVENTS_URL), count as number, config, scrapedAt);
}
