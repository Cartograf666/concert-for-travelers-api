import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

type ScheduleEvent = {
  title?: unknown;
  ara?: unknown;
  iso?: unknown;
  url?: unknown;
};

function eventActs(title: string): { artist: string; lineup?: string[] } {
  // The schedule sometimes appends a local promotional date to an act name.
  const dated = title.match(/^(.+?) Live Tallinn \d{1,2}\. [\p{L}]+ 20\d{2}$/u);
  if (dated) return { artist: dated[1] };

  // A comma-separated bill with explicit country tags identifies each act.
  const bill = title.split(',').map((part) => part.trim());
  const acts = bill.map((part) => part.match(/^(.+?) \([A-Z]{2}\)$/)?.[1]);
  if (bill.length > 1 && acts.every((act): act is string => !!act)) {
    return { artist: acts[0]!, lineup: acts.slice(1) as string[] };
  }
  return { artist: title };
}

/** The venue's own schedule widget reads this first-party JSON feed. */
export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  let data: { ok?: unknown; events?: unknown };
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('Helitehas schedule is not valid JSON');
  }
  // The official widget falls back to its manual schedule when fewer than three
  // records arrive. Treat that state as a failed scrape so run.ts retains cache.
  if (data?.ok !== true || !Array.isArray(data.events) || data.events.length < 3) {
    throw new Error('Helitehas schedule is unavailable or incomplete');
  }

  const concerts: Partial<Concert>[] = [];
  for (const item of data.events as ScheduleEvent[]) {
    if (!item || typeof item !== 'object' || item.ara !== false) continue;
    if (typeof item.title !== 'string' || typeof item.iso !== 'string') continue;
    const title = item.title.replace(/\s+/g, ' ').trim();
    const { artist, lineup } = eventActs(title);
    const match = item.iso.match(/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):\d{2}(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
    if (!artist || !match || !Number.isFinite(Date.parse(item.iso))) continue;
    const date = match[1];
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;

    const href = typeof item.url === 'string' ? item.url.replace(/&#0?38;|&amp;/gi, '&') : '';
    concerts.push({
      artist,
      lineup,
      date,
      startTime: `${match[2]}:${match[3]}`,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain,
      scrapedAt
    });
  }
  return concerts;
}
