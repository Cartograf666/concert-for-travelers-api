import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

// Finite native card occurrences with physical venue proof. Programme titles
// and billing are not venue fields; unmatched cards retain raw date/place only.
// Evidence: tests/fixtures/normalization-integrity-20261011/occurrence-proof.json.
const PHYSICAL_VENUES = [
  ["2026-10-17", "Hokes Bluff", "AL", "Loblolly Fest", "The Bluff Amphitheater"],
  ["2026-10-30", "Nashville", "TN", "WBE Concert 250: Reel America with Riley Green", "The Pinnacle"],
  ["2026-11-11", "Houston", "TX", "100.3 The Bull presents Ten Man Jam - Acoustic", "House of Blues Houston"],
  ["2026-12-06", "Las Vegas", "NV", "Resorts World Theatre with Riley Green", "Resorts World Theatre"],
  ["2026-12-10", "Las Vegas", "NV", "Resorts World Theatre with Riley Green", "Resorts World Theatre"],
  ["2026-12-31", "Port Charlotte", "FL", "Southwest Florida New Year's Rockin Eve", "The Charlotte County Fair"],
  ["2027-04-29", "Raleigh", "NC", "Walnut Creek Amphitheater with Riley Green", "Walnut Creek Amphitheater"],
  ["2027-04-30", "Knoxville", "TN", "Food City Center with Riley Green", "Food City Center"],
  ["2027-05-01", "Greenville", "SC", "Bon Secours Arena with Riley Green", "Bon Secours Arena"],
  ["2027-05-06", "Fort Worth", "TX", "Dickies Arena with Riley Green", "Dickies Arena"],
  ["2027-05-07", "Wichita", "KS", "INTRUST Bank Arena with Riley Green", "INTRUST Bank Arena"],
  ["2027-05-08", "Rogers", "AR", "Walmart Amphitheater with Riley Green", "Walmart Amphitheater"],
  ["2027-05-20", "Tulsa", "OK", "BOK Center with Riley Green", "BOK Center"],
  ["2027-05-21", "Dallas", "TX", "Dos Equis Pavilion with Riley Green", "Dos Equis Pavilion"],
  ["2027-05-22", "Lafayette", "LA", "CAJUNDOME with Riley Green", "CAJUNDOME"],
] as const;

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  const $ = cheerio.load(html);
  const concerts: RawConcert[] = [];
  $('article.card.event').each((_, element) => {
    const row = $(element);
    const printedDate = row.find('time').first().attr('datetime')?.trim() || '';
    const date = /^[A-Za-z]{3} \d{1,2} 20\d{2}$/.test(printedDate) ? parseDate(printedDate, scrapedAt) : null;
    const place = row.find('p.location').first().text().trim().match(/^(.+), ([A-Z]{2})$/);
    const title = row.find('h1.card-title').first().text().trim();
    if (!date || !place || !US_STATES.has(place[2]) || !title) {
      throw new Error('Randy Houser event lacks an explicit date, venue or verified state');
    }
    // The linked promoter sells a multi-night sailing; March 12 is not yet
    // independently verified as Randy's individual performance day/place.
    if (title === 'Top Shelf Country Cruise' && date === '2027-03-12') return;
    const href = row.find('a.btn-tickets').first().attr('href');
    const city = place[1].trim() === 'Ft. Worth' && place[2] === 'TX' ? 'Fort Worth' : place[1].trim();
    const venue = PHYSICAL_VENUES.find(([day, town, state, card]) => day === date && town === city && state === place[2] && card === title)?.[4];
    concerts.push({ artist: 'Randy Houser', date, venue, city, country: 'US',
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, sourceEventUrl: config.url, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
