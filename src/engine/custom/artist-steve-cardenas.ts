import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dates(value: string, year: number): string[] {
  const match = value.match(/^(\p{L}+)\s+(\d{1,2}(?:\s*(?:,|&|[-–])\s*\d{1,2})*)$/u);
  if (!match) return [];
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[1].toLowerCase()) + 1;
  if (!month) return [];
  const range = match[2].match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  let days: number[];
  if (range) {
    const start = Number(range[1]), end = Number(range[2]);
    if (end < start || end - start > 6) return [];
    days = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  } else {
    if (/[-–]/.test(match[2])) return [];
    days = match[2].split(/\s*[, &]\s*/).filter(Boolean).map(Number);
  }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (days.some((day) => day < 1 || day > maxDay)) return [];
  return [...new Set(days)].map((day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

function location(address: string): { city: string; country: string } | null {
  const parts = address.split(',').map(clean);
  const last = parts.at(-1);
  // These suffixes are explicit in the captured official schedule. Do not use
  // the artist's US nationality as a fallback for an unknown tour destination.
  if (parts.length === 2 && (last === 'NYC' || last === 'Brooklyn') && /^\d/.test(parts[0])) {
    return { city: last === 'NYC' ? 'New York' : last, country: 'US' };
  }
  if (parts.length === 3 && /^(CA|CT|MO|NY|PA)$/.test(last ?? '') && /^\d/.test(parts[0])) {
    return parts[1] ? { city: parts[1], country: 'US' } : null;
  }
  if (last === 'Canada' && parts.at(-2) === 'Québec' && (parts.length === 3 || parts.length === 4)) {
    return parts.at(-3) ? { city: parts.at(-3)!, country: 'CA' } : null;
  }
  if (parts.length === 2 && last === 'Spain' && parts[0]) {
    return { city: parts[0], country: 'ES' };
  }
  return null;
}

function startTime(value: string): string | undefined {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::00)?\s*(am|pm)$/i);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) > 59) return undefined;
  const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/** The schedule is line-delimited, under an explicit year heading in each table. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('table').each((_, table) => {
    let year: number | undefined;
    $(table).find('h2, p').each((__, element) => {
      const block = $(element);
      if (block.is('h2')) {
        const heading = clean(block.text());
        year = /^20\d{2}$/.test(heading) ? Number(heading) : undefined;
        return;
      }
      if (!year) return;
      const copy = block.clone();
      copy.find('br').replaceWith('\n');
      const lines = copy.text().split('\n').map(clean).filter(Boolean);
      if (lines.length < 4 || lines.some((line) => /\bworkshop\b/i.test(line))) return;
      const concertDates = dates(lines[0], year);
      const place = location(lines.at(-1)!);
      const venue = lines.at(-2)!;
      if (!concertDates.length || !place || !venue) return;
      for (const date of concertDates) {
        concerts.push({
          artist: config.selectors?.artistNameFallback || 'Steve Cardenas',
          date,
          venue,
          ...place,
          startTime: startTime(lines[1]),
          originalSource: config.domain,
          scrapedAt
        });
      }
    });
  });
  return concerts;
}
