import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const CALENDAR_URL = 'https://alabamasymphony.org/concert/';
const DATE = /^(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d{2} \d{1,2}:\d{2} [ap]m$/i;

// Exact calendar venue names, with cities verified from the orchestra's event pages
// and the venues' own published addresses. An unknown venue must not inherit Birmingham.
const CITY_BY_VENUE: Readonly<Record<string, string>> = {
  'Thompson High School Performing Arts Center': 'Alabaster',
  'Saturn Birmingham': 'Birmingham',
  'Canterbury United Methodist Church': 'Birmingham',
  'UAB’s Alys Stephens Center — Jemison Concert Hall': 'Birmingham',
  'Avon Theater': 'Birmingham',
  'Alabama Theatre': 'Birmingham',
  'Hoover High School Performing Arts Center': 'Hoover',
  "Birmingham Children's Theatre": 'Birmingham',
  'BJCC Concert Hall': 'Birmingham',
  'Ferus Artisan Ales - Trussville': 'Trussville'
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  if (config.url !== CALENDAR_URL || config.domain !== 'alabamasymphony.org') return [];
  const $ = cheerio.load(html);
  if (!$('body.post-type-archive-concert').length ||
      $('link[rel="canonical"]').attr('href') !== CALENDAR_URL) return [];

  const concerts: Partial<Concert>[] = [];
  $('article.type-concert').each((_, element) => {
    const card = $(element);
    const title = clean(card.find('h3').first().text());
    const summary = clean(card.find('.summary').first().text());
    // The same archive also includes the distinct Alabama Symphony Youth Orchestra.
    // Keep adult ASO education and family concerts, including Young People's Concerts.
    if (/\bASYO\b|Alabama Symphony Youth Orchestra/i.test(`${title} ${summary}`)) return;
    if (!title) throw new Error('Alabama Symphony calendar card has no title');

    const venue = clean(card.find('.venue').first().text());
    const city = CITY_BY_VENUE[venue];
    const detailUrl = safeAbsoluteUrl(card.find('header.entry-header a[rel="bookmark"]').first().attr('href') || '', config.url);
    if (!city) throw new Error(`Alabama Symphony calendar has an unverified venue: ${venue || '<missing>'}`);
    if (!detailUrl || new URL(detailUrl).hostname !== config.domain) {
      throw new Error(`Alabama Symphony calendar card has no official event URL: ${title}`);
    }
    const directTicket = card.find('a.red_button').first().attr('href');
    const ticketUrl = directTicket ? safeAbsoluteUrl(directTicket, config.url) : undefined;
    const dates = new Set<string>();
    card.find('.event-date').each((_, dateElement) => {
      for (const candidate of clean($(dateElement).text()).split(/\s+[–—]\s+/)) {
        if (DATE.test(candidate)) dates.add(candidate);
      }
    });
    if (!dates.size) throw new Error(`Alabama Symphony calendar card has no complete native date: ${title}`);

    for (const date of dates) {
      concerts.push({
        artist: config.selectors?.artistNameFallback || 'Alabama Symphony Orchestra',
        date, venue, city, country: 'US',
        ticketUrl: ticketUrl || detailUrl,
        originalSource: config.domain, scrapedAt
      });
    }
  });
  return concerts;
}
