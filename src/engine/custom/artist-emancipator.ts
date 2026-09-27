import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

// Codes observed on the current official schedule. Keeping this evidence-bounded
// avoids treating an unfamiliar two-letter suffix as either a US subdivision or
// an ISO country when those namespaces collide (for example CA and DE).
const CURRENT_US_REGIONS = new Set(['MO', 'MA', 'NY', 'PA', 'OR', 'WA', 'CA', 'GA', 'TN', 'NC']);
const CURRENT_CA_REGIONS = new Set(['BC']);
const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseLocation(value: string): { city: string; country: 'US' | 'CA' } | null {
  const match = clean(value).match(/^(.+?),\s*([A-Z]{2})$/);
  if (!match) return null;
  const city = clean(match[1]);
  if (!city) return null;
  if (CURRENT_US_REGIONS.has(match[2])) return { city, country: 'US' };
  if (CURRENT_CA_REGIONS.has(match[2])) return { city, country: 'CA' };
  return null;
}

/**
 * The generic date parser interprets a just-ended yearless range such as
 * "Sep 24 - Sep 26" as next year. GigPress leaves that range visible briefly,
 * so suppress only the unambiguous same-month range whose end is already past.
 */
function isExpiredSameMonthRange(value: string, scrapedAt: string): boolean {
  const match = clean(value).match(/^([A-Z][a-z]{2})\s+\d{1,2}\s*-\s*\1\s+(\d{1,2})$/);
  if (!match || MONTHS[match[1]] === undefined) return false;
  const scraped = new Date(scrapedAt);
  if (Number.isNaN(scraped.getTime())) return false;
  const end = new Date(Date.UTC(scraped.getUTCFullYear(), MONTHS[match[1]], Number(match[2]), 23, 59, 59));
  const ageMs = scraped.getTime() - end.getTime();
  // Mirror the pipeline's 31-day yearless-date grace boundary. An older month
  // belongs to the next tour year; only a range that has just ended is stale.
  return ageMs > 0 && ageMs <= 31 * 24 * 60 * 60 * 1000;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('table.gigpress-table.upcoming tr.gigpress-row').each((_, element) => {
    const block = $(element);
    const date = clean(block.find('.gigpress-date').first().text());
    const venue = clean(block.find('.gigpress-venue').first().text());
    const location = parseLocation(block.find('.gigpress-city').first().text());
    if (!date || !venue || !location || isExpiredSameMonthRange(date, scrapedAt)) return;

    const href = block.find('a.gigpress-tickets-link').first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Emancipator',
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
