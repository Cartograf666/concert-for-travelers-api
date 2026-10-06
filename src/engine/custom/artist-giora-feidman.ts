import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

// The official page gives cities but no countries. Only locations verified in
// the current schedule are admitted, so a new foreign stop is not labelled DE.
const SWISS_CITIES = new Set(['Thun', 'St.Gallen', 'Aarau', 'Liestal', 'Effretikon', 'Luzern']);
const GERMAN_CITIES = new Set([
  'Konstanz', 'Bad Kissingen', 'Gunzenhausen', 'Backnang', 'Schwäbisch Gmünd', 'Neu-Ulm',
  'Neuburg an der Donau', 'Passau', 'Rosenheim', 'Neunburg vorm Wald', 'Radebeul',
  'Stadthagen', 'Norden', 'Gütersloh', 'Köln', 'Wiesbaden', 'Darmstadt',
  'Villingen-Schwenningen', 'Ritterhude', 'Hannover', 'Braunschweig', 'Weimar',
  'Zwickau', 'Kulmbach', 'Fürth', 'Amberg', 'Regensburg', 'München', 'Mannheim',
  'Gießen', 'Münster', 'Hagen', 'Krefeld', 'Kassel', 'Kaiserslautern', 'Tübingen',
  'Stuttgart', 'Lindau', 'Halle', 'Eisenach', 'Siegen', 'Rheinbach', 'Bramsche',
  'Soest', 'Goch', 'Bad Zwischenahn', 'Delmenhorst', 'Bad Bentheim', 'Remscheid',
  'Oberhausen', 'Neuss', 'Meiningen', 'Halberstadt', 'Denzlingen'
]);

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
  $('.listItem').each((_, element) => {
    const block = $(element);
    const match = block.find('.itemName').first().text().trim().match(/^(\d{2})\.(\d{2})\.(\d{4}),\s*\d{1,2}[.:]\d{2}\s*Uhr\s*-\s*(.+)$/);
    if (!match) return;
    const city = match[4].trim();
    const country = city === 'Schaan' ? 'LI' : SWISS_CITIES.has(city) ? 'CH' : GERMAN_CITIES.has(city) ? 'DE' : undefined;
    const venue = block.find('.itemText .rteBlock').last().text().trim();
    if (!country || !venue) return;
    const date = `${match[3]}-${match[2]}-${match[1]}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
    const href = block.find('a.biglink[href]').first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Giora Feidman', date, venue, city, country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
