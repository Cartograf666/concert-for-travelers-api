import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Scraper for Vintage (Винтаж) official tour page.
 * The page is a Tilda grid with absolute positioning.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);

  // Find the specific Tilda artboard containing the afisha list
  const artboard = $('.t396__artboard').filter((_, el) => {
    return $(el).text().includes('АФИША');
  });

  if (artboard.length === 0) {
    throw new Error('Could not find Tilda artboard containing АФИША');
  }

  // Find all elements within this artboard
  const elements: {
    id: string;
    type: string;
    top: number;
    left: number;
    text: string;
    href?: string;
  }[] = [];

  artboard.find('.tn-elem').each((_, el) => {
    const id = $(el).attr('data-elem-id') || '';
    const type = $(el).attr('data-elem-type') || '';
    const top = parseInt($(el).attr('data-field-top-value') || '0', 10);
    const left = parseInt($(el).attr('data-field-left-value') || '0', 10);

    const a = $(el).find('a');
    const href = a.attr('href') || undefined;

    // Replace <br> tags with space to avoid word joining
    const htmlContent = $(el).html() || '';
    const text = htmlContent
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    elements.push({ id, type, top, left, text, href });
  });

  // Split into left and right columns (Tilda grid width is typically 1200px)
  const colA = elements.filter(e => e.left < 500);
  const colB = elements.filter(e => e.left >= 500);

  const concerts: Partial<Concert>[] = [];

  const processColumn = (colElems: typeof elements) => {
    // Dates are text elements matching DD.MM
    const dates = colElems.filter(e => e.type === 'text' && /^\d{2}\.\d{2}$/.test(e.text));
    const locations = colElems.filter(e => e.type === 'text' && !/^\d{2}\.\d{2}$/.test(e.text) && e.text && e.text !== 'АФИША');
    const buttons = colElems.filter(e => e.type === 'button' && e.href);

    for (const d of dates) {
      // Find closest location text
      const loc = locations.find(l => Math.abs(l.top - d.top) < 60);
      if (!loc) continue;

      // Find closest ticket button
      const btn = buttons.find(b => Math.abs(b.top - d.top) < 80);
      const ticketUrl = btn?.href;

      // Parse city, venue, and country from location text
      let city = '';
      let venue = '';
      let country = 'RU';

      const locUpper = loc.text.toUpperCase();
      if (locUpper.includes('МОСКВА')) {
        city = 'Москва';
        venue = loc.text.replace(/москва/i, '').replace(/[\s,–-]+/g, ' ').trim();
      } else if (locUpper.includes('САНКТ-ПЕТЕРБУРГ') || locUpper.includes('СПБ')) {
        city = 'Санкт-Петербург';
        venue = loc.text.replace(/санкт-петербург|спб/i, '').replace(/[\s,–-]+/g, ' ').trim();
      } else if (locUpper.includes('КИШИНЕВ')) {
        city = 'Кишинев';
        venue = loc.text.replace(/кишинев/i, '').replace(/[\s,–-]+/g, ' ').trim();
        country = 'MD';
      } else if (locUpper.includes('КИПР')) {
        city = 'Кипр';
        venue = loc.text.replace(/кипр/i, '').replace(/[\s,–-]+/g, ' ').trim();
        country = 'CY';
      } else if (locUpper.includes('ТУРЦИЯ')) {
        country = 'TR';
        const match = loc.text.match(/турция,\s*(kemer|belek|side)?\s*(.*)/i);
        if (match) {
          city = match[1] ? match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase() : 'Turkey';
          venue = match[2].replace(/&amp;/g, '&').trim();
        } else {
          city = 'Turkey';
          venue = loc.text.replace(/турция/i, '').replace(/[\s,–-]+/g, ' ').replace(/&amp;/g, '&').trim();
        }
      } else {
        city = loc.text;
        venue = loc.text;
      }

      concerts.push({
        artist: 'Винтаж',
        date: d.text,
        venue: venue || config.selectors?.venueNameFallback || 'Unknown Venue',
        city: city || config.selectors?.cityNameFallback || 'Unknown City',
        country,
        ticketUrl,
        originalSource: config.domain,
        scrapedAt
      });
    }
  };

  processColumn(colA);
  processColumn(colB);

  return concerts;
}
