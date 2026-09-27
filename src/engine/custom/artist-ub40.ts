import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const SOURCE_COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: 'US',
  aus: 'AU',
  nz: 'NZ'
};
const AMBIGUOUS_REGION_LABELS = new Set(['georgia']);

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function explicitCountryCode(label: string): string | undefined {
  const cleaned = compact(label);
  const alias = SOURCE_COUNTRY_ALIASES[cleaned.toLowerCase()];
  if (alias) return alias;
  if (cleaned.length <= 2 || AMBIGUOUS_REGION_LABELS.has(cleaned.toLowerCase())) return undefined;
  const code = normalizeCountry(cleaned);
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function splitExplicitLocation(raw: string): { city: string; country: string } | undefined {
  const segments = compact(raw).split(',').map(compact).filter(Boolean);
  if (segments.length < 2) return undefined;

  const country = explicitCountryCode(segments.at(-1)!);
  const citySegments = segments.slice(0, -1);
  if (!country || citySegments.length === 0) return undefined;

  const conflictingCountry = citySegments
    .map(explicitCountryCode)
    .find((code) => code !== undefined && code !== country);
  if (conflictingCountry) return undefined;

  return { city: citySegments.join(', '), country };
}

function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  return safeAbsoluteUrl(href, base);
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('table.uk-table tbody tr.el-item').each((_, element) => {
    const block = $(element);
    const artist = config.selectors?.artistNameFallback || 'UB40';
    const date = block.find('.el-meta').first().text().trim();
    const venue = block.find('.el-title').first().text().trim();
    const rawLocation = compact(block.find('.el-content p').first().text());
    const location = splitExplicitLocation(rawLocation);
    if (!artist || !date || !venue || !rawLocation) return;

    concerts.push({
      artist,
      date,
      venue,
      city: location?.city ?? rawLocation,
      country: location?.country,
      ticketUrl: absoluteUrl(block.find('a.el-link').first().attr('href'), config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
