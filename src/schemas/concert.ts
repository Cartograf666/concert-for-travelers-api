import { z } from 'zod';

export const ConcertSchema = z.object({
  artist: z.string().min(1).describe("Normalized artist or band name"),
  artistWebsite: z.string().url().or(z.literal("")).optional().describe("Official website of the artist"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO Date: YYYY-MM-DD"),
  venue: z.string().min(1).describe("Name of the venue/club"),
  city: z.string().min(1).describe("City name"),
  country: z.string().min(2).max(2).describe("ISO 3166-1 alpha-2 country code"),
  ticketUrl: z.string().url().or(z.literal("")).optional().describe("URL to buy tickets or event info page, or empty string"),
  originalSource: z.string().describe("Domain name of the source site (e.g., club-arena.de)"),
  scrapedAt: z.string().datetime().describe("ISO datetime when data was extracted")
});

export type Concert = z.infer<typeof ConcertSchema>;
