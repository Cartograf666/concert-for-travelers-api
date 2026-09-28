import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const COUNTRIES: Readonly<Record<string, string>> = {
  japan: 'JP',
  italia: 'IT',
  usa: 'US'
};
// These precise venue/city pairs are identified in this agenda's location cell.
// A changed venue or an unfamiliar city stays unresolved instead of inheriting
// the artist's home country from the scraper config.
// Cross-checks: raimatartsfestival.org (Lleida_Spain), teatrocordoba.es/
// espectaculo/andrea-motis/ (Teatro Góngora), auditorioelbatel.es (Cartagena),
// villanosdeljazz.es/evento/andrea-motis-guitar-trio/ (Monumental, Madrid).
const KNOWN_VENUE_LOCATIONS = new Set([
  'Auditori Enric Granados|Lleida',
  'Palau de la Música Catalana|Barcelona',
  'Teatro Góngora|Córdoba',
  'Auditorio El Batel|Cartagena',
  'Teatro Circo|Albacete',
  'Teatro Monumental|Madrid',
  'Teatre-Auditori Emma Vilarasau|Sant Cugat',
  'Sala Ramon Romagosa|Cornellà'
]);

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const [, day, month, year] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isFestival(value: string): boolean {
  return /festival|qurtubajazz|villanos del jazz|portalblau/i.test(value);
}

function festivalCity(value: string): string | undefined {
  return value.match(/Festival de(?: Jazz de)? ([^,]+)$/i)?.[1];
}

function parsePlace(parts: string[]): { venue: string; city: string; country?: string } | undefined {
  if (parts.length < 2) return undefined;

  const explicitCountry = COUNTRIES[parts.at(-1)!.toLowerCase()];
  if (explicitCountry) {
    const venue = parts[0];
    // The page gives only a city and country for the Washington TBA row.
    if (venue === 'Washington DC') return undefined;
    const venueCities: Readonly<Record<string, string>> = { Tokyo: 'JP', Milano: 'IT' };
    const city = Object.keys(venueCities).find((name) => venue.endsWith(` ${name}`));
    if (city && venueCities[city] !== explicitCountry) return undefined;
    return city ? { venue, city, country: explicitCountry } : undefined;
  }

  // A country is absent from these rows; identify only known venue/city pairs.
  const first = parts[0];
  // The linked Córdoba operator identifies Teatro Góngora as the actual room:
  // https://teatrocordoba.es/espectaculo/andrea-motis/
  const venue = first === 'Teatro de Córdoba' && parts[1] === 'Qurtubajazz'
    ? 'Teatro Góngora'
    : isFestival(first) ? parts[1] : first;
  let city: string | undefined;
  if (parts.length >= 3 && !isFestival(parts.at(-1)!)) city = parts.at(-1);
  else if (parts.length >= 2 && !isFestival(parts[1]) && !isFestival(first)) city = parts[1];
  else if (isFestival(first)) city = festivalCity(first);
  else if (isFestival(parts.at(-1)!)) city = festivalCity(parts.at(-1)!)
    ?? (/^Teatro de /i.test(first) ? first.slice('Teatro de '.length) : undefined);
  else if (/^Teatro de /i.test(first)) city = first.slice('Teatro de '.length);
  if (!city || isFestival(city) || city.toLowerCase() === 'georgia') return undefined;
  return { venue, city, country: KNOWN_VENUE_LOCATIONS.has(`${venue}|${city}`) ? 'ES' : undefined };
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('figure.wp-block-table table tbody tr').each((_, element) => {
    const cells = $(element).children('td');
    if (cells.length < 3) return;
    const date = clean(cells.eq(0).text());
    if (!isValidDate(date)) return;

    const placeCell = cells.eq(2);
    placeCell.find('br').replaceWith(', ');
    const parts = clean(placeCell.text()).split(',').map(clean).filter(Boolean);
    const place = parsePlace(parts);
    if (!place) return;

    const href = cells.eq(3).find('a[href]').first().attr('href');
    const ticketUrl = href ? safeAbsoluteUrl(href, config.url) : undefined;
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Andrea Motis',
      date,
      ...place,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
