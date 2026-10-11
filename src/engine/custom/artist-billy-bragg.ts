import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

// Exact cities in the November/December UK dates confirmed by the native
// Squeeze/Billy announcement; new places never inherit a blanket GB fallback.
const UK_CITIES = new Set('Glasgow|Blackpool|Nottingham|Newcastle|Stockton|Hull|Leeds|Liverpool|Manchester|London|Cardiff|Birmingham|Swansea|Plymouth|Portsmouth|Bournemouth|Brighton'.split('|'));

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('Billy Bragg') || !$('.single_event_list').length) {
    throw new Error('Billy Bragg official upcoming shows missing');
  }
  const concerts: Partial<Concert>[] = [];
  $('.single_event_list').each((_, element) => {
    const row = $(element);
    const day = row.find('.eventlist_day').text().trim();
    const month = row.find('.eventlist_month').text().trim();
    const year = row.find('.eventlist_year').text().trim();
    // A festival range does not establish Billy's exact performance day.
    if (day.includes('-')) return;
    const date = `${day} ${month} ${year}`;
    if (!/^20\d{2}$/.test(year) || !/^\d{1,2}(?:-\d{1,2})?$/.test(day) ||
        (!day.includes('-') && !parseDate(date, scrapedAt))) throw new Error('Billy Bragg incomplete native date');
    const title = row.find('.event_list_title').text().trim();
    const venue = row.find('.event_venue').text().trim();
    const location = row.find('.event_list_location').text().replace(/\s+/g, ' ').trim();
    let city: string | undefined = title.split(' – ')[1]?.trim();
    let country: string | undefined;
    if (UK_CITIES.has(city || '') && /^(nov|dec)$/i.test(month) && year === '2026') country = 'GB';
    else if (location.endsWith(', Denmark')) {
      city = location.split(',').at(-2)?.trim(); country = 'DK';
    } else if (location.endsWith(', Spain')) {
      city = location.split(',')[0].trim(); country = 'ES';
    }
    if (!venue || !city || !country) throw new Error(`Billy Bragg unverified native location: ${location}`);
    const href = row.find('a').first().attr('href');
    if (!href) throw new Error('Billy Bragg native detail link missing');
    concerts.push({ artist: 'Billy Bragg', date, venue, city, country,
      ticketUrl: safeAbsoluteUrl(href, config.url),
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
