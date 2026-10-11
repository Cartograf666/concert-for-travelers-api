import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

interface NativeEvent {
  fullUrl?: string;
  startDate?: number;
  endDate?: number;
  location?: { addressTitle?: string; addressLine2?: string; addressCountry?: string };
}

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<RawConcert[]> {
  const data = JSON.parse(body) as { website?: { primaryDomain?: string; timeZone?: string }; upcoming?: NativeEvent[] };
  if (data.website?.primaryDomain !== 'www.shellyberg.com' || !Array.isArray(data.upcoming) || !data.website.timeZone) {
    throw new Error('Shelly Berg native calendar identity, timezone or upcoming events missing');
  }
  const calendarDay = (timestamp: number): string => new Intl.DateTimeFormat('en-CA', {
    timeZone: data.website!.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(timestamp));
  const concerts: RawConcert[] = [];
  for (const event of data.upcoming) {
    const match = /^\/tour\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//.exec(event.fullUrl || '');
    const printed = match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
    const date = printed ? parseDate(printed, scrapedAt) : null;
    if (!date || !Number.isFinite(event.startDate) || !Number.isFinite(event.endDate) ||
        calendarDay(event.startDate!) !== date) throw new Error('Shelly Berg calendar has an inconsistent native date');
    // Cruise periods do not establish a single performance day at the departure port.
    if (calendarDay(event.endDate!) !== date) continue;
    const venue = event.location?.addressTitle?.trim() || undefined;
    const parts = event.location?.addressLine2?.split(',').map(value => value.trim()) || [];
    const city = parts.length >= 2 && !/^\d/.test(parts[0]) ? parts[0] : undefined;
    const label = event.location?.addressCountry?.trim() || '';
    const country = label ? normalizeCountry(label) : undefined;
    concerts.push({ artist: 'Shelly Berg', date, venue, city,
      country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
      ticketUrl: event.fullUrl ? safeAbsoluteUrl(event.fullUrl, config.url) : undefined,
      sourceEventUrl: config.url, originalSource: config.domain, scrapedAt });
  }
  return concerts;
}
