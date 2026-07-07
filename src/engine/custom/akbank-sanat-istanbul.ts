import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  // Find all event blocks (div with data-category attribute)
  $('div[data-category]').each((_, el) => {
    const block = $(el);

    // Get artist name from the second paragraph's second span
    const artist = block.find('p:nth-of-type(2) span:nth-of-type(2)').text().trim();

    // Get time from p.hour
    const time = block.find('p.hour').text().trim();

    // Find the parent div with data-day attribute to get the date
    let dateStr = '';
    let parent = $(el).parent();
    while (parent.length && !dateStr) {
      const dayAttr = parent.attr('data-day');
      if (dayAttr) {
        dateStr = dayAttr;
        break;
      }
      parent = parent.parent();
    }

    // If date found, combine with time
    let date = '';
    if (dateStr) {
      // dateStr is in format DD.MM, need to add year
      // Parse current year from page context (default to 2026)
      const yearSelect = $('select#cf-year');
      const year = yearSelect.find('option:selected').val() || '2026';

      // Convert DD.MM to DD.MM.YYYY
      date = `${dateStr}.${year}`;

      // Also add time if available
      if (time) {
        date = `${date} ${time}`;
      }
    }

    if (!artist || !date) return;

    concerts.push({
      artist,
      date,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
