import * as cheerio from 'cheerio';
import type { Concert } from '../../schemas/concert.js';
import type { ScraperConfig } from '../../schemas/config.js';
import { parseDate } from '../../pipeline/process.js';
import { fetchHtmlForHealing, resolveHttpBackend } from '../runner.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
interface NativePage { content: string; extensionsToRender?: Record<string, string> }

function page(body: string): NativePage {
  const value = JSON.parse(body) as NativePage;
  if (typeof value?.content !== 'string' || !value.content.trim()) throw new Error('Riphil native page content missing');
  return value;
}

export function programmeUrls(config: ScraperConfig, body: string): string[] {
  const native = page(body);
  const $ = cheerio.load(native.content);
  const text = $.root().text().replace(/\s+/g, ' ').trim();
  const season = text.match(/RI PHILHARMONIC ORCHESTRA'S (20\d{2})-(20\d{2}) SEASON/);
  if (!season || Number(season[2]) !== Number(season[1]) + 1) throw new Error('Riphil native orchestra season identity missing');
  const highlightedMonths = $('.caption-title').toArray().map(element => {
    const match = $(element).text().trim().match(/^([A-Z]{3}) \d{1,2}$/);
    if (!match || !MONTHS.some(month => month.toUpperCase() === match[1])) throw new Error('Riphil season highlight date changed');
    return match[1].toLowerCase();
  });
  if (!highlightedMonths.length || new Set(highlightedMonths).size !== highlightedMonths.length) {
    throw new Error('Riphil season highlights missing or ambiguous');
  }
  const nav = cheerio.load(Object.values(native.extensionsToRender || {}).join(''));
  const byMonth = new Map<string, Set<string>>();
  nav('a[href]').each((_, element) => {
    const url = new URL(nav(element).attr('href')!, config.url);
    const alias = url.pathname.match(/^\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{2})$/);
    if (!alias || url.host !== new URL(config.url).host || ![season[1].slice(-2), season[2].slice(-2)].includes(alias[2])) return;
    const links = byMonth.get(alias[1]) || new Set<string>(); links.add(url.href); byMonth.set(alias[1], links);
  });
  // Main programme buttons still point to the old season. Only the native
  // current-month navigation matching every highlighted programme is trusted.
  if (byMonth.size !== highlightedMonths.length) throw new Error('Riphil current programme navigation incomplete');
  return highlightedMonths.map(month => {
    const urls = [...(byMonth.get(month) || [])];
    if (urls.length !== 1) throw new Error(`Riphil programme link missing or ambiguous: ${month}`);
    return urls[0];
  });
}

export function parseProgramme(config: ScraperConfig, body: string, url: string, scrapedAt: string): Partial<Concert>[] {
  const $ = cheerio.load(page(body).content);
  const header = $('[id="1887927626"] > p').toArray().map(element => $(element).text().replace(/\s+/g, ' ').trim());
  const [programme, printedRange, location] = header;
  const range = printedRange?.match(/^([A-Za-z]+) (\d{1,2})(?:\s*-\s*(?:([A-Za-z]+) )?(\d{1,2}))?, (20\d{2})$/);
  const credits = $('[id="1678221425"] p').toArray().map(element => $(element).text().trim()).join(' ').replace(/\s+/g, ' ').trim();
  const detailSeason = $('[id="1486369071"]').text().trim();
  const expectedSeason = new URL(config.url).pathname.match(/^\/(20\d{2})-(20\d{2})-season$/);
  const venueContext = $.root().text().replace(/\s+/g, ' ');
  // US is the established source contract for this exact Rhode Island venue,
  // confirmed in its native description, never a fallback for another place.
  if (!programme || !range || !expectedSeason ||
      detailSeason !== `${expectedSeason[1]}-${expectedSeason[2].slice(-2)} SEASON` ||
      ![expectedSeason[1], expectedSeason[2]].includes(range[5]) || location !== 'The VETS, Providence' ||
      !credits.includes('Performing Artists The Rhode Island Philharmonic Orchestra') ||
      !venueContext.includes('The VETS in Providence is the home of the Rhode Island Philharmonic Orchestra') ||
      !venueContext.includes('Rhode Island')) throw new Error(`Riphil unverified programme/date/performer/venue: ${url}`);
  const firstDate = parseDate(`${range[1]} ${range[2]}, ${range[5]}`, scrapedAt);
  const lastDate = parseDate(`${range[3] || range[1]} ${range[4] || range[2]}, ${range[5]}`, scrapedAt);
  if (!firstDate || !lastDate || firstDate > lastDate) throw new Error(`Riphil invalid printed date range: ${url}`);
  const concerts: Partial<Concert>[] = [];
  const slotDates = new Set<string>();
  const details = $('[id="1719886704"]');
  details.find('br').replaceWith(' ');
  details.find('p').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (!/^(?:Amica Rush Hour Concert|TACO Classical Concert|Open Rehearsal):/.test(text)) {
      if (/^(?:.*Concert|.*Rehearsal):/i.test(text)) throw new Error(`Riphil unknown programme slot: ${url}`);
      return;
    }
    const slot = text.match(/(?:Concert|Rehearsal): (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), ([A-Za-z]+) (\d{1,2}), (\d{1,2}):(\d{2})(AM|PM)$/);
    const date = slot ? parseDate(`${slot[2]} ${slot[3]}, ${range[5]}`, scrapedAt) : null;
    const hour = slot ? Number(slot[4]) : 0;
    const minute = slot ? Number(slot[5]) : 60;
    if (!slot || !date || date < firstDate || date > lastDate || hour < 1 || hour > 12 || minute > 59 ||
        new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) !== slot[1]) {
      throw new Error(`Riphil concert slot does not agree with printed complete date: ${url}`);
    }
    if (slotDates.has(date)) throw new Error(`Riphil duplicate programme date: ${url}`);
    slotDates.add(date);
    if (text.startsWith('Open Rehearsal:')) return;
    const startTime = `${String(hour % 12 + (slot[6] === 'PM' ? 12 : 0)).padStart(2, '0')}:${slot[5]}`;
    concerts.push({ artist: 'Rhode Island Philharmonic Orchestra', date, startTime,
      venue: 'The VETS', city: 'Providence', country: 'US', ticketUrl: url,
      originalSource: config.domain, scrapedAt });
  });
  if (firstDate !== lastDate && (slotDates.size !== 2 || !slotDates.has(firstDate) || !slotDates.has(lastDate))) {
    throw new Error(`Riphil programme date coverage incomplete: ${url}`);
  }
  if (!concerts.length && slotDates.size === 0 && firstDate === lastDate && programme === "Handel's Messiah" && details.length) {
    // Messiah prints a complete single concert date but no start time.
    concerts.push({ artist: 'Rhode Island Philharmonic Orchestra', date: firstDate,
      venue: 'The VETS', city: 'Providence', country: 'US', ticketUrl: url,
      originalSource: config.domain, scrapedAt });
  }
  if (!concerts.length) throw new Error(`Riphil programme has no verified concert slots: ${url}`);
  return concerts;
}

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const concerts: Partial<Concert>[] = [];
  for (const url of programmeUrls(config, body)) {
    let native: string;
    try { native = await fetchHtmlForHealing(url, resolveHttpBackend(config)); }
    catch (error) { throw new Error(`Riphil programme fetch failed ${url}: ${error instanceof Error ? error.message : 'unknown access error'}`); }
    concerts.push(...parseProgramme(config, native, url, scrapedAt));
  }
  // Returning only after every linked programme is checked prevents partial
  // calendars from clearing/replacing last-good source data on an access error.
  return concerts;
}
