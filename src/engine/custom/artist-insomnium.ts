import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const COUNTRY_CODES: Readonly<Record<string, string>> = {
  AUSTRIA: 'AT',
  BELGIUM: 'BE',
  CAN: 'CA',
  FINLAND: 'FI',
  FRANCE: 'FR',
  GERMANY: 'DE',
  HUNGARY: 'HU',
  ITALY: 'IT',
  NETHERLANDS: 'NL',
  POLAND: 'PL',
  SPAIN: 'ES',
  SWITZERLAND: 'CH',
  UK: 'GB',
  USA: 'US'
};

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  return safeAbsoluteUrl(href, base);
}

function parseLocation(
  rawLocation: string,
  country: string,
  ticketUrl: string | undefined
): { venue: string; city: string } | null {
  const location = clean(rawLocation).replace(/^[-–]\s*/, '').replace(/\s*[-–]$/, '');

  // The artist row names only the festival, while the festival's official 2027
  // page identifies Dinkelsbühl, Germany. Keep this explicit rather than
  // manufacturing a city for every future comma-less listing.
  // https://www.summer-breeze.de/en/ (checked 2026-09-27)
  if (location === 'Summer Breeze Open Air' && country === 'DE') {
    return { venue: location, city: 'Dinkelsbühl' };
  }

  const parts = location.split(',').map(clean).filter(Boolean);
  if (parts.length < 2) return null;

  // This one official row is city-first (the linked event URL also says
  // tarkastamo-oulu); all other current rows are venue-first.
  if (ticketUrl?.includes('tarkastamo-oulu.fi/') && parts[0] === 'Oulu' && parts[1] === 'Tarkastamo') {
    return { venue: 'Tarkastamo', city: 'Oulu' };
  }

  const venue = parts[0];
  const cityParts = (country === 'US' || country === 'CA') && parts.length >= 3
    ? parts.slice(1, -1)
    : parts.slice(1);
  const city = clean(cityParts.join(', '));
  return venue && city ? { venue, city } : null;
}

export async function scrape(
  config: ScraperConfig,
  html: string,
  scrapedAt: string
): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('.el-item.uk-card').each((_, element) => {
    const block = $(element);
    const title = block.find('.el-title').first();
    const spans = title.find('span');
    const date = clean(spans.first().text());
    const country = COUNTRY_CODES[clean(spans.last().text()).toUpperCase()];

    // Excludes the VIP-upgrade card and any future non-event promo row without
    // silently assigning its fallback country to a concert.
    if (!/^\p{L}+\s+\d{1,2}\s+\d{4}$/u.test(date) || !country) return;

    const ticketUrl = absoluteUrl(block.find('a.el-link').first().attr('href'), config.url);
    const locationTitle = title.clone();
    locationTitle.find('span').remove();
    const location = parseLocation(locationTitle.text(), country, ticketUrl);
    if (!location) return;

    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Insomnium',
      date,
      venue: location.venue,
      city: location.city,
      country,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
