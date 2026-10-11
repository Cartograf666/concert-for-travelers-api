import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { fetchHtmlForHealing, resolveHttpBackend } from '../runner.js';

const ORIGIN = 'https://www.kittysu.com';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const clean = (value: string) => value.replace(/\s+/g,' ').trim();

function eventUrl(raw: string | undefined): string {
  if (!raw) throw new Error('Kitty Su native event URL missing');
  const url = new URL(raw,ORIGIN);
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      !/^\/event\/[A-Za-z0-9-]+\/?$/.test(url.pathname)) throw new Error('Kitty Su unsafe native event URL');
  return url.href;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url,resolveHttpBackend(config))): Promise<RawConcert[]> {
  if (config.url !== `${ORIGIN}/events` || config.domain !== 'kittysu.com') throw new Error('Kitty Su official source mismatch');
  const $ = cheerio.load(html);
  if (clean($('title').text()) !== 'Kitty Su') throw new Error('Kitty Su native programme identity missing');
  const concerts: RawConcert[] = [];
  const seen = new Map<string,string>();
  const deadline = Date.now()+70000;
  for (const element of $('ul.event-list > li').toArray()) {
    const row = $(element);
    const title = clean(row.find('.event-list-text h3').text());
    const [eventTitle, city] = title.split('|').map(clean);
    if (city?.toLowerCase() !== 'bangalore') continue;
    const listing = clean(row.find('.event-list-text p').text());
    const parts = listing.split('|').map(clean);
    if (!eventTitle || parts.length !== 4 || parts[0] !== 'Bangalore' || parts[1] !== 'India') {
      throw new Error('Kitty Su unverified native listing location');
    }
    const url = eventUrl(row.find('.event-list-img a').attr('href'));
    if (seen.has(url)) {
      if (seen.get(url) !== `${title}|${listing}`) throw new Error('Kitty Su conflicting duplicate event');
      continue;
    }
    seen.set(url,`${title}|${listing}`);
    if (Date.now() > deadline-15000) throw new Error('Kitty Su complete programme exceeds detail fetch budget');
    const detail = cheerio.load(await fetchPage(url));
    const canonical = detail('meta[property="og:url"]').attr('content');
    // The captured canonical URL uses the bare official host; the listing uses
    // www. Permit only that evidenced host pair and the same exact event path.
    let canonicalUrl: URL;
    try { canonicalUrl = new URL(canonical || ''); } catch { throw new Error('Kitty Su native detail identity missing'); }
    if (clean(detail('title').text()) !== eventTitle || canonicalUrl.protocol !== 'https:' ||
        !['kittysu.com','www.kittysu.com'].includes(canonicalUrl.hostname) || canonicalUrl.port ||
        canonicalUrl.username || canonicalUrl.password || canonicalUrl.search || canonicalUrl.hash ||
        canonicalUrl.pathname !== new URL(url).pathname) throw new Error('Kitty Su native detail identity mismatch');
    const description = clean(detail('.event-description').text());
    const artist = description.match(/with (DJ [\p{L}\d .'-]+) on the console/iu)?.[1];
    const dateMatch = description.match(/\b(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+) (20\d{2})\b/);
    const venues = detail('.event-description strong').toArray().map(el => clean(detail(el).text()))
      .filter(text => /^Kitty (?:Ko|Su) .+ Bangalore$/.test(text));
    const listingDate = /^(\d{1,2})\s+([A-Za-z]+)/.exec(parts[2]);
    const time = /\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i.exec(description);
    if (!artist || !dateMatch || venues.length !== 1 || !listingDate || !time ||
        +time[1] < 1 || +time[1] > 12 || +time[2] > 59) throw new Error('Kitty Su missing native performer, full date, time or venue');
    const month = MONTHS.findIndex(value => value.toLowerCase() === dateMatch[2].toLowerCase())+1;
    const date = `${dateMatch[3]}-${String(month).padStart(2,'0')}-${dateMatch[1].padStart(2,'0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    const startTime = `${String(+time[1]%12+(time[3].toUpperCase()==='PM'?12:0)).padStart(2,'0')}:${time[2]}`;
    if (!month || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== date ||
        +listingDate[1] !== +dateMatch[1] || listingDate[2].toLowerCase() !== dateMatch[2].toLowerCase() ||
        parts[3].toUpperCase() !== `${time[1].padStart(2,'0')}:${time[2]} ${time[3].toUpperCase()}`) {
      throw new Error('Kitty Su inconsistent native date/time');
    }
    concerts.push({artist,date,startTime,venue:venues[0],city:parts[0],country:'IN',ticketUrl:url,
      sourceEventUrl:url,originalSource:config.domain,scrapedAt});
  }
  return concerts;
}
