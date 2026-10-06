import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

// The site prints cities but no countries. These places occur on its current
// calendar and were verified as GB/ES; a new place must be checked first.
const GB_CITIES = new Set('St. Helens|Treccobay|Milton Keynes|Selby|Stockport|Tonbridge|Blackpool|Bognor|Minehead|Skegness|Much Wenlock'.split('|'));

function parseRow(value: string): { date: string; venue: string; city: string; country: string } {
  const match = /^(\d{1,2})(?:st|nd|rd|th)\s+([a-z]+)\s+(20\d{2})(?:\s*[-–]\s*|\s+)(.+)$/i.exec(value);
  if (!match) throw new Error(`The Fizz row lacks a full printed date: ${value}`);
  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month) throw new Error(`The Fizz row has an unknown month: ${value}`);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    throw new Error(`The Fizz row has an invalid calendar date: ${value}`);
  }
  const detail = match[4].trim();
  const comma = detail.lastIndexOf(',');
  const dash = detail.lastIndexOf(' - ');
  const splitAt = comma >= 0 ? comma : dash;
  const separatorLength = comma >= 0 ? 1 : 3;
  const venue = detail.slice(0, splitAt).trim();
  const city = detail.slice(splitAt + separatorLength).trim();
  if (splitAt < 0 || !venue || !city) throw new Error(`The Fizz row lacks a venue or city: ${value}`);
  const country = city === 'Maspalomas' ? 'ES' : GB_CITIES.has(city) ? 'GB' : undefined;
  if (!country) throw new Error(`The Fizz row has an unverified country: ${city}`);
  return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, venue, city, country };
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!/\bTHE FIZZ\b/i.test($('title').text()) || canonical !== config.url) {
    throw new Error('The Fizz official tour identity is missing');
  }
  const calendars = $('div[data-testid="richTextElement"]').filter((_, element) =>
    /\b20\d{2}\s+DATES\b/i.test($(element).find('h2').text()) && $(element).find('p').length > 0);
  if (calendars.length !== 1) throw new Error('The Fizz official calendar block is missing or ambiguous');

  const concerts: Partial<Concert>[] = [];
  calendars.find('p').each((_, element) => {
    const row = $(element);
    const text = row.text().replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^20\d{2}\s+dates$/i.test(text)) return;
    const fields = parseRow(text);
    const href = row.find('a[href]').first().attr('href');
    concerts.push({ artist: config.selectors?.artistNameFallback || 'The Fizz', ...fields,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt });
  });
  if (concerts.length === 0) throw new Error('The Fizz official calendar has no verified event rows');
  return concerts;
}
