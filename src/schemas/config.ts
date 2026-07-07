import { z } from 'zod';

export const ScraperSelectorsSchema = z.object({
  eventBlock: z.string().describe("Selector matching the card containing one event"),
  artist: z.string().optional().describe("Selector inside event block for artist name (omit on single-artist tour pages)"),
  artistNameFallback: z.string().optional().describe("Fixed artist name when the page is one artist's own tour list"),
  date: z.string().describe("Selector inside event block for date string"),
  datePattern: z.string().optional().describe("Regex/Format pattern to parse the date, e.g., DD.MM.YYYY"),
  ticketUrl: z.string().optional().describe("Selector for the event detail/ticket link"),
  venue: z.string().optional().describe("Selector inside event block for per-row venue name (artist tour pages)"),
  city: z.string().optional().describe("Selector inside event block for per-row city name (artist tour pages)"),
  country: z.string().optional().describe("Selector inside event block for per-row country code (artist tour pages)"),
  venueNameFallback: z.string().describe("Fallback venue name if not dynamic"),
  cityNameFallback: z.string().describe("Fallback city name"),
  countryNameFallback: z.string().min(2).max(2).describe("Fallback country code (2-char)")
});

export const ScraperConfigSchema = z.object({
  id: z.string().describe("Unique identifier, e.g., club-arena-berlin"),
  domain: z.string().describe("Site domain name, e.g., club-arena-berlin.de"),
  url: z.string().url().describe("Target schedule URL to scrape"),
  type: z.enum(['static_selectors', 'json_api', 'custom_js', 'jsonld', 'next_data']).default('static_selectors'),
  maxRetries: z.number().int().min(0).max(5).optional().describe("Retry attempts on transient fetch failures (network/timeout/429/5xx). Defaults to 2."),
  requestDelayMs: z.number().int().min(0).optional().describe("Minimum delay between successive requests to this domain (politeness throttle)."),
  selectors: ScraperSelectorsSchema.optional()
});

export type ScraperSelectors = z.infer<typeof ScraperSelectorsSchema>;
export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
