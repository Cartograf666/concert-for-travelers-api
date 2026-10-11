import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
// The native North American calendar prints city + state/province, not country.
// These disjoint region codes are supported by the official linked US/Canadian
// address captures; CA here is California, not a country abbreviation.
const US_REGIONS = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const CA_REGIONS = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

// Exact current event/venue/address proof from the 2026-10-10 native details.
// A different date, venue or listing city must not inherit a historical move.
const VERIFIED_ADDRESSES = [
  { path: '/tour-dates-detail/riviera-theatre-buffalo', date: '2026-11-11', venue: 'Riviera Theatre', printed: 'Buffalo', region: 'NY', city: 'North Tonawanda' },
  { path: '/tour-dates-detail/the-astro', date: '2026-12-05', venue: 'The Astro', printed: 'Omaha', region: 'NE', city: 'La Vista' },
  { path: '/tour-dates-detail/fremont-theatre', date: '2027-02-10', venue: 'Fremont Theatre', printed: 'San Lusi Obispo', region: 'CA', city: 'San Luis Obispo' },
  { path: '/tour-dates-detail/the-factory', date: '2027-03-13', venue: 'The Factory', printed: 'St. Louis', region: 'MO', city: 'Chesterfield' },
];
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

function fullDate(value: string): string | undefined {
  const match = value.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})$/);
  if (!match) return;
  const month = MONTHS.findIndex(name => name.toLowerCase() === match[1].toLowerCase()) + 1;
  if (!month) return;
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** Read each rich-text container once; selecting all its nested text classes repeats the date six times. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  if (config.url !== 'https://www.blueoctober.com/tour-dates' || config.domain !== 'www.blueoctober.com') {
    throw new Error('Blue October native source identity mismatch');
  }
  const $ = cheerio.load(html);
  const concerts: RawConcert[] = [];
  $('div.wixui-repeater__item').each((_, element) => {
    const card = $(element);
    const date = fullDate(compact(card.find('[id^="comp-lh7wnc2h__"]').first().text()));
    const venue = compact(card.find('[id^="comp-lh7wpx2j__"]').first().text());
    const location = compact(card.find('[id^="comp-lh7yohlq__"]').first().text());
    const parts = location.match(/^(.+),\s*([A-Z]{2})$/);
    if (!date || !venue || !parts) return;
    const region = parts[2];
    const country = US_REGIONS.has(region) ? 'US' : CA_REGIONS.has(region) ? 'CA' : undefined;
    const href = card.find('[id^="comp-lh80ivgu__"] a[href]').first().attr('href');
    let url: URL | undefined;
    try {
      url = href ? new URL(href, config.url) : undefined;
      if (url && (url.origin !== 'https://www.blueoctober.com' || url.username || url.password ||
          url.port || url.hash || !url.pathname.startsWith('/tour-dates-detail/'))) url = undefined;
    } catch { url = undefined; }
    const printedCity = parts[1].trim();
    const proof = VERIFIED_ADDRESSES.find(row => row.path === url?.pathname && row.date === date &&
      row.venue === venue && row.printed === printedCity && row.region === region);
    concerts.push({
      artist: 'Blue October', date, venue, city: proof?.city || printedCity,
      country, ticketUrl: url?.toString(), sourceEventUrl: url?.toString(),
      originalSource: config.domain, scrapedAt,
    });
  });
  return concerts;
}
