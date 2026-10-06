import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const paragraphs = $('.entry-content > p').toArray();
  if (!/Ivar Grydeland/i.test($('title').text()) || !paragraphs.length ||
      clean($(paragraphs[0]).text()) !== 'Upcoming') {
    throw new Error('Ivar Grydeland official Upcoming calendar is missing');
  }

  let year: number | undefined;
  let historyFound = false;
  const concerts: Partial<Concert>[] = [];
  for (const paragraph of paragraphs.slice(1)) {
    const lines = ($(paragraph).html() || '').split(/<br\s*\/?\s*>/i)
      .map(fragment => clean(cheerio.load(fragment).text())).filter(Boolean);
    if (!lines.length) continue;
    if (lines.length === 1 && lines[0] === 'Concert history') {
      historyFound = true;
      break;
    }
    const heading = lines[0].match(/^(20\d{2}):?$/);
    if (heading) {
      if (lines.length !== 1) throw new Error('Ivar Grydeland Upcoming year heading contains unparsed events');
      year = Number(heading[1]);
      continue;
    }
    if (!year) throw new Error('Ivar Grydeland Upcoming event has no printed year');
    for (const line of lines) {
      const dated = line.match(/^(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December):\s*(.+)$/i);
      if (!dated) throw new Error(`Ivar Grydeland Upcoming event has an unrecognized date or row: ${line}`);
      const month = MONTHS[dated[2][0].toUpperCase() + dated[2].slice(1).toLowerCase()];
      const date = `${year}-${String(month).padStart(2, '0')}-${dated[1].padStart(2, '0')}`;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error(`Ivar Grydeland Upcoming event has an invalid calendar date: ${line}`);
      }
      const place = dated[3].match(/^.+?\s@\s(.+?)\s[–-]\s(.+?),\s*([^,()]+?)(?:\s*\(.*\))?$/);
      if (!place || !clean(place[1]) || !clean(place[2]) || !clean(place[3])) {
        throw new Error(`Ivar Grydeland Upcoming event has an unrecognized venue or location: ${line}`);
      }
      concerts.push({
        artist: config.selectors?.artistNameFallback || 'Ivar Grydeland',
        date, venue: clean(place[1]), city: clean(place[2]), country: clean(place[3]),
        originalSource: config.domain, scrapedAt
      });
    }
  }
  if (!historyFound || !year || !concerts.length) {
    throw new Error('Ivar Grydeland official Upcoming calendar is incomplete');
  }
  return concerts;
}
