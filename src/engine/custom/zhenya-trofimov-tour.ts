import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Scraper for Komnata Kultury / Zhenya Trofimov official website.
 * Matches elements inside repeating Tilda record blocks.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('.t-rec').each((_, rec) => {
    const dateEl = $(rec).find('.tn-elem[data-elem-id="1709639269253"]');
    if (dateEl.length === 0) return;

    const dateText = dateEl.text().trim();
    if (!dateText) return;

    const cityEl = $(rec).find('.tn-elem[data-elem-id="1709639269261"]');
    const venueEl = $(rec).find('.tn-elem[data-elem-id="1709639269247"]');
    
    // Find ticket link button
    const btnEl = $(rec).find('.tn-elem').filter((_, el) => $(el).attr('data-elem-type') === 'button');
    const a = btnEl.find('a');
    const ticketUrl = a.attr('href') || undefined;

    let rawCity = cityEl.text().trim();
    let venue = venueEl.text().trim();
    let city = rawCity;
    let country = 'RU';

    if (city.toLowerCase().includes('казахстан')) {
      city = city.replace(/,\s*казахстан/i, '').trim();
      country = 'KZ';
    } else if (city.toLowerCase().includes('беларусь')) {
      city = city.replace(/,\s*беларусь/i, '').trim();
      country = 'BY';
    }

    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Комната культуры',
      date: dateText,
      venue: venue || config.selectors?.venueNameFallback || 'Unknown Venue',
      city: city || config.selectors?.cityNameFallback || 'Unknown City',
      country,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
