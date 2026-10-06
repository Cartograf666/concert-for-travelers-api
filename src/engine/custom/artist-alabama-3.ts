import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

// The current first-party page names these cities under its UK and Ireland tour.
// An unknown city must fail until its country is verified, rather than inherit GB.
const GB_CITIES = new Set('Bristol|London|Southampton|Dover|Sittingbourne|Huddersfield|Manchester|Sheffield|Nottingham|Edinburgh|Glasgow|Dunfermline|Hastings|Lewes|Belfast'.split('|'));
const IE_CITIES = new Set('Dublin|Limerick|Cork|Galway'.split('|'));

function isoDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Alabama 3 row has no explicit ISO date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Alabama 3 row has invalid date: ${value}`);
  }
  return value;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('Alabama 3') || !$('section#tour').length) {
    throw new Error('Alabama 3 official tour page is missing');
  }
  const concerts: Partial<Concert>[] = [];
  $('article.show').each((_, element) => {
    const row = $(element);
    const date = isoDay(row.find('time.date').attr('datetime') || '');
    const city = row.find('.place h4').first().text().trim();
    const country = IE_CITIES.has(city) ? 'IE' : GB_CITIES.has(city) ? 'GB' : undefined;
    const venue = row.find('.place p').first().text().replace(/\s*·\s*Acoustic\s*$/, '').trim();
    const href = row.find('a.ticket-link').first().attr('href');
    if (!country || !venue || !href) throw new Error(`Alabama 3 row has unverified location or missing venue/link: ${city}`);
    concerts.push({ artist: config.selectors?.artistNameFallback || 'Alabama 3', date, venue, city, country,
      ticketUrl: safeAbsoluteUrl(href, config.url), originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
