import { z } from 'zod';

export const ScraperSelectorsSchema = z.object({
  eventBlock: z.string().describe("Selector matching the card containing one event"),
  artist: z.string().describe("Selector inside event block for artist name"),
  date: z.string().describe("Selector inside event block for date string"),
  datePattern: z.string().optional().describe("Regex/Format pattern to parse the date, e.g., DD.MM.YYYY"),
  ticketUrl: z.string().optional().describe("Selector for the event detail/ticket link"),
  venueNameFallback: z.string().describe("Fallback venue name if not dynamic"),
  cityNameFallback: z.string().describe("Fallback city name"),
  countryNameFallback: z.string().min(2).max(2).describe("Fallback country code (2-char)")
});

export const ScraperConfigSchema = z.object({
  id: z.string().describe("Unique identifier, e.g., club-arena-berlin"),
  domain: z.string().describe("Site domain name, e.g., club-arena-berlin.de"),
  url: z.string().url().describe("Target schedule URL to scrape"),
  type: z.enum(['static_selectors', 'custom_js']).default('static_selectors'),
  selectors: ScraperSelectorsSchema.optional()
});

export type ScraperSelectors = z.infer<typeof ScraperSelectorsSchema>;
export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
