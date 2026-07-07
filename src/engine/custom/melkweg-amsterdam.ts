import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Melkweg's agenda page is a Next.js SSR app with no reliable static class
 * names and no standalone JSON API endpoint. The full event list is embedded
 * as pre-fetched data inside the <script id="__NEXT_DATA__"> payload instead.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').html();
  if (!raw) {
    throw new Error('Could not find __NEXT_DATA__ script tag in Melkweg page');
  }

  const data = JSON.parse(raw);
  const contentBlocks = data?.props?.pageProps?.pageData?.attributes?.content;
  const agendaBlock = Array.isArray(contentBlocks)
    ? contentBlocks.find((b: any) => b?.attributes?.layout === 'agenda') ?? contentBlocks[0]
    : undefined;
  const events = agendaBlock?.attributes?.initialEvents;

  if (!Array.isArray(events)) {
    throw new Error('Could not find initialEvents array in Melkweg __NEXT_DATA__ payload');
  }

  const concerts: Partial<Concert>[] = [];
  for (const event of events) {
    const artistText = String(event?.attributes?.name || '').trim();
    const dateText = String(event?.attributes?.startDate || '').trim();
    if (!artistText || !dateText) continue;

    let ticketUrl: string | undefined;
    const relUrl = event?.attributes?.url;
    if (relUrl) {
      try {
        ticketUrl = new URL(relUrl, config.url).toString();
      } catch {
        ticketUrl = relUrl;
      }
    }

    concerts.push({
      artist: artistText,
      date: dateText,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  }

  return concerts;
}
