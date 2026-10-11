import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';

const Slot = z.object({
  date: z.string(), startTime: z.string().nullable(),
  location: z.object({ nameDe: z.string() }),
});
const Event = z.object({
  infoDe: z.string().nullable(), slugDe: z.string(), archived: z.boolean(),
  category: z.object({ nameDe: z.string(), isSubcategoryOf: z.object({ nameDe: z.string() }).nullable() }),
  concertLocationTimes: z.array(Slot),
});
const Feed = z.object({ path: z.literal('/konzerte'), result: z.object({ data: z.object({ events: z.array(Event) }) }) });
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
// Primary venue/room addresses are retained in docs/official-source-resilience-20261011.md.
// This closed venue list cannot assign that location to an unfamiliar venue.
const SALZBURG_VENUES = new Set([
  'Stiftung Mozarteum, Wiener Saal', 'Stiftung Mozarteum, Großer Saal',
  'Mozart-Wohnhaus, Tanzmeistersaal', 'Haus für Mozart', 'Max Schlereth Saal',
  'Großes Festspielhaus', 'Salzburger Marionettentheater', 'Mozart Ton- und Filmsammlung',
  'DomQuartier Salzburg, Rittersaal der Residenz', 'OVAL - Die Bühne im Europark',
]);

function hasMozartProgramme(html: string): boolean {
  const $ = cheerio.load(html);
  $('br').before(' ');
  const name = '(?:Wolfgang (?:Amadeus|Amadé) Mozart|W\\.?\\s*A\\.?\\s*Mozart|Mozart)';
  const catalogue = /\bK(?:V|\.)\s*\d+/i;
  if ($('p').toArray().some(element => {
    const text = compact($(element).text());
    if (new RegExp(`^${name}(?:\\s*:|\\s+)`, 'i').test(text) && catalogue.test(text)) return true;
    if (new RegExp(`^${name}$`, 'i').test(text) && catalogue.test(compact($(element).next('p').text()))) return true;
    if (new RegExp(`^Musik von ${name}(?:\\s|[&,]|$)`, 'i').test(text)) return true;
    if (/^Werke\b/i.test(text) && /\bvon Wolfgang (?:Amadeus|Amadé) Mozart(?:,|\s+und|$)/i.test(text)) return true;
    return /\b(?:Einleitung|Introduction) (?:von|by) Wolfgang (?:Amadeus|Amadé) Mozart\b/i.test(text) &&
      /\b(?:Symphonie|Sinfonie|Symphony|Konzert|Concerto)\b/i.test(text);
  })) return true;
  return $('strong,b').toArray().some(element => {
    const label = compact($(element).text());
    if (!/^(?:Mozart|Wolfgang (?:Amadeus|Amadé) Mozart|W\.?\s*A\.?\s*Mozart)$/i.test(label)) return false;
    // A composer label needs a work in that programme paragraph. Brand names,
    // page titles and a mention in descriptive prose cannot grant attribution.
    const paragraph = $(element).closest('p');
    if (!paragraph.length) return false;
    const text = compact(paragraph.text());
    // Native programmes also place several composer credits in one paragraph,
    // or put the composer heading in a separate paragraph before the work.
    const work = text.length > label.length ? text : compact(paragraph.next('p').text());
    return (text === label || $(element).next().is('br')) && catalogue.test(work);
  });
}

/** The site's own Gatsby payload supplies full dates and composer programmes; listing cards omit years. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  if (config.url !== 'https://mozarteum.at/page-data/konzerte/page-data.json' || config.domain !== 'mozarteum.at') {
    throw new Error('Mozarteum native feed identity mismatch');
  }
  const feed = Feed.parse(JSON.parse(html));
  const concerts: RawConcert[] = [];
  for (const event of feed.result.data.events) {
    if (event.archived || !event.infoDe || !hasMozartProgramme(event.infoDe)) continue;
    const category = compact(event.category.nameDe);
    if (/Führung|Ausstellung|Filmsammlung|Vortrag/i.test(category) || /^Filme?$/i.test(category)) continue;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(event.slugDe)) throw new Error('Mozarteum unsafe native event slug');
    const eventUrl = `https://mozarteum.at/events/${event.slugDe}`;
    for (const slot of event.concertLocationTimes) {
      const date = new Date(`${slot.date}T00:00:00Z`);
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(slot.date) || !Number.isFinite(date.valueOf()) ||
          date.toISOString().slice(0, 10) !== slot.date) throw new Error('Mozarteum missing valid full native date');
      const venue = compact(slot.location.nameDe);
      const verifiedLocation = SALZBURG_VENUES.has(venue);
      concerts.push({
        artist: 'Wolfgang Amadeus Mozart', date: slot.date, venue,
        city: verifiedLocation ? 'Salzburg' : undefined, country: verifiedLocation ? 'AT' : undefined,
        startTime: slot.startTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime) ? slot.startTime : undefined,
        ticketUrl: eventUrl, sourceEventUrl: eventUrl, originalSource: config.domain, scrapedAt,
      });
    }
  }
  return concerts;
}
