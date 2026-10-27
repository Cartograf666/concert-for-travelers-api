import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const ARTIST = 'Godspeed You! Black Emperor';
const URL = 'https://cstrecords.com/pages/artist/godspeed-you-black-emperor';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Country names and explicit Canadian province / Puerto Rico codes printed by the label.
const COUNTRIES: Record<string, string> = { Argentina: 'AR', Brazil: 'BR', Chile: 'CL', QC: 'CA', ON: 'CA', PR: 'PR' };
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (config.url !== URL || config.domain !== 'cstrecords.com' || config.selectors?.artistNameFallback !== ARTIST ||
      !$('h1').toArray().some(node => clean($(node).text()) === ARTIST)) {
    throw new Error('Godspeed label artist identity missing');
  }
  const headings = $('strong').filter((_, node) => clean($(node).text()) === 'Live Dates');
  if (!headings.length) throw new Error('Godspeed Live Dates section missing');
  const rows = new Map<string, Partial<Concert>>();
  let observed = 0;
  headings.each((_, heading) => {
    $(heading).nextAll('.cst-content-block').first().find('.metafield-rich_text_field > p').each((_, node) => {
      const block = $(node), text = clean(block.text());
      if (!text) return;
      observed++;
      // An announced multi-day festival window is not a performance date.
      if (/^\d{1,2}\s*[-–]\s*\d{1,2}\s+[A-Za-z]{3}\s+20\d{2}\s+-/.test(text)) return;
      const match = /^(\d{1,2}) ([A-Za-z]{3}) (20\d{2}) - (.+?), ([^-]+?) - (.+)$/.exec(text);
      if (!match) throw new Error(`Godspeed malformed live date: ${text}`);
      if (/\b(cancelled|canceled|postponed)\b/i.test(text) || block.find('del, s').length) return;
      const country = COUNTRIES[match[5]], month = MONTHS.indexOf(match[2]) + 1;
      const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      if (!month || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || !country) {
        throw new Error(`Godspeed unsupported date or country: ${text}`);
      }
      const venue = clean(block.find('a strong').first().text());
      const ticketUrl = safeAbsoluteUrl(block.find('a').first().attr('href') ?? '', URL);
      if (!venue || !ticketUrl) throw new Error('Godspeed venue or safe event link missing');
      const row = { artist: ARTIST, date, venue, city: match[4], country, ticketUrl, originalSource: config.domain, scrapedAt };
      const key = `${date}|${match[4]}|${venue}`;
      const existing = rows.get(key);
      if (existing && existing.ticketUrl !== ticketUrl) throw new Error('Godspeed duplicate layouts disagree');
      rows.set(key, row);
    });
  });
  if (!observed) throw new Error('Godspeed Live Dates is empty or changed');
  return [...rows.values()];
}
