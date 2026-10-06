import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07',
  AUG: '08', SEPT: '09', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
};
const COUNTRIES: Record<string, string> = {
  UK: 'GB', Germany: 'DE', Denmark: 'DK', Norway: 'NO', Finland: 'FI', Sweden: 'SE'
};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  // Duda serves either full HTML or its page JSON to the runner's rotating UA.
  // The JSON content field is the same official schedule markup.
  let markup = html;
  if (html.trimStart().startsWith('{')) {
    try {
      const page = JSON.parse(html) as { content?: unknown };
      if (typeof page.content === 'string') markup = page.content;
    } catch { /* ordinary HTML remains the input */ }
  }
  const $ = cheerio.load(markup);
  const concerts: Partial<Concert>[] = [];
  const today = scrapedAt.slice(0, 10);
  $('table.table').each((_, table) => {
    // Each official table sits below a month/year heading, sometimes in a
    // separate nested Duda group. Search preceding siblings from the table up.
    let heading = '';
    let cursor = $(table);
    while (cursor.length && !heading) {
      for (const sibling of cursor.prevAll().toArray()) {
        const candidates = $(sibling).find('p').addBack('p').toArray().reverse();
        const match = candidates.map((candidate) => $(candidate).text().trim())
          .find((text) => /^(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) 20\d{2}$/.test(text));
        if (match) { heading = match; break; }
      }
      cursor = cursor.parent();
    }
    const year = heading.match(/\b(20\d{2})\b/)?.[1];
    if (!year) return;
    $(table).find('tbody tr.row:not(:has(th))').each((__, element) => {
      const cells = $(element).find('td.cell');
      const dayMonth = cells.eq(0).text().trim().match(/^(\d{1,2})\s+([A-Z]+)$/);
      const venue = cells.eq(2).text().trim();
      const location = cells.eq(1).text().trim();
      if (!dayMonth || !venue || !location) return;
      const month = MONTHS[dayMonth[2]];
      if (!month) return;
      const date = `${year}-${month}-${dayMonth[1].padStart(2, '0')}`;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today) return;
      const locationParts = location.match(/^(.+?),\s*(UK|Germany|Denmark|Norway|Finland|Sweden)$/);
      const city = location === 'Gibraltar' ? 'Gibraltar' : locationParts?.[1].trim();
      const country = location === 'Gibraltar' ? 'GI' : locationParts ? COUNTRIES[locationParts[2]] : undefined;
      if (!city || !country) return;
      const href = cells.eq(3).find('a[href]').first().attr('href');
      concerts.push({
        artist: config.selectors?.artistNameFallback || '10cc', date, venue, city, country,
        ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
        originalSource: config.domain, scrapedAt
      });
    });
  });
  return concerts;
}
