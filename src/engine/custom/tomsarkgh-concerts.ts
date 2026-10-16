import * as cheerio from 'cheerio';
import axios from 'axios';
import { setTimeout as delay } from 'node:timers/promises';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const ORIGIN = 'https://www.tomsarkgh.am';
const LISTING = `${ORIGIN}/en/category/Concert`;
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

// The pilot covers only these three inspected performer headings, not arbitrary
// concert/work titles. Dates, venues and geography always come from native HTML.
function performer(title: string): string | undefined {
  if (/^Andru Donalds(?:\s*\|.+)?$/i.test(title)) return 'Andru Donalds';
  if (/^Lyubov Uspenskaya\s*\/\s*Любовь Успенская$/i.test(title)) return 'Lyubov Uspenskaya';
  if (/^Akmal$/i.test(title)) return 'Akmal';
  return undefined;
}

function eventUrl(href: string): string | undefined {
  try {
    const url = new URL(href, ORIGIN);
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
        !/^\/en\/event\/\d+\/[^/]+\.html$/.test(url.pathname)) return;
    return url.href;
  } catch { return; }
}

export function detailUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('.event-box-item').each((_, element) => {
    const card = $(element);
    if (clean(card.find('.event-type').text()) !== 'Concert') return;
    const title = clean(card.find('.event-title').text());
    // Listing titles may be ellipsized; detail must pass the complete heading check.
    if (!/^(?:Andru Donalds\b|Lyubov Uspenskaya\s*\/|Akmal$)/i.test(title)) return;
    const url = eventUrl(card.find('.event-title a').attr('href') || '');
    if (url) urls.add(url);
  });
  if (urls.size > 6) throw new Error('Tomsarkgh pilot detail limit exceeded; review source scope');
  return [...urls];
}

export function parseDetail(html: string, url: string, scrapedAt: string): Partial<Concert>[] {
  const instant = new Date(scrapedAt);
  if (!Number.isFinite(instant.getTime()) || eventUrl(url) !== url) return [];
  const $ = cheerio.load(html);
  if ($('#eventCanonicalURL').length !== 1 || $('#eventCanonicalURL').attr('content') !== url ||
      $('#eventName').length !== 1 || $('.scope-event-type').length !== 1 ||
      $('.scope-event-type').attr('href') !== '/en/category/Concert' ||
      $('[itemtype="http://schema.org/Event"]').length !== 1) return [];
  const title = clean($('#eventName').text());
  const artist = performer(title);
  const statusText = `${title} ${$('#eventDesc').text()}`;
  if (!artist || /cancelled|canceled|postponed|отмен[аёе]|перен[её]с|չկայացած|հետաձգ/i.test(statusText)) return [];

  const dates = $('meta[itemprop="startDate"]');
  const places = $('.occurrence_venue');
  if (dates.length !== 1 || places.length !== 1) return [];
  const match = dates.attr('content')?.match(/^(20\d{2}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return [];
  const date = match[1];
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return [];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yerevan', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(instant);
  if (date < today) return [];

  const venueFields = places.find('[itemprop="name"]');
  const addresses = places.find('meta[itemprop="address"]');
  if (venueFields.length !== 1 || addresses.length !== 1) return [];
  const venue = clean(venueFields.text());
  const address = (addresses.attr('content') || '').split(',').map(clean);
  const city = address.at(-2) || '';
  if (!venue || address.length < 3 || !address[0] || address.at(-1) !== 'Armenia' ||
      !/^[A-Za-z][A-Za-z .'-]{1,79}$/.test(city)) return [];
  return [{
    artist, date, startTime: `${match[2]}:${match[3]}`, venue, city, country: 'AM',
    ticketUrl: url, originalSource: 'www.tomsarkgh.am', scrapedAt
  }];
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  if (config.url !== LISTING || config.domain !== 'www.tomsarkgh.am') return [];
  const concerts: Partial<Concert>[] = [];
  for (const url of detailUrls(html)) {
    // Includes the first detail after the runner's listing GET, per robots delay.
    await delay(Math.max(1000, config.requestDelayMs || 0));
    const response = await axios.get<string>(url, {
      timeout: 30000, maxRedirects: 0, responseType: 'text',
      headers: { 'User-Agent': 'ConcertScraper/1.0 (Tomsarkgh bounded concert pilot)' }
    });
    concerts.push(...parseDetail(response.data, url, scrapedAt));
  }
  return concerts;
}
