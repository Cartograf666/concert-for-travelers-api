import { z } from 'zod';

export const ConcertSchema = z.object({
  artist: z.string().min(1).describe("Normalized artist or band name"),
  artistWebsite: z.string().url().or(z.literal("")).optional().describe("Official website of the artist"),
  spotifyId: z.string().optional().describe("Spotify artist ID, parsed from artistSocials.spotify -- lets a consumer app match a loved artist by ID instead of a fragile name string"),
  mbid: z.string().optional().describe("MusicBrainz artist MBID, from MusicBrainz/Wikidata enrichment -- a free, stable canonical artist ID"),
  artistSocials: z.object({
    spotify: z.string().url().or(z.literal("")).optional().nullable(),
    instagram: z.string().url().or(z.literal("")).optional().nullable(),
    facebook: z.string().url().or(z.literal("")).optional().nullable(),
    youtube: z.string().url().or(z.literal("")).optional().nullable(),
    telegram: z.string().url().or(z.literal("")).optional().nullable(),
    vk: z.string().url().or(z.literal("")).optional().nullable()
  }).optional().describe("Official social links of the artist"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO Date: YYYY-MM-DD"),
  venue: z.string().min(1).describe("Name of the venue/club"),
  city: z.string().min(1).describe("City name"),
  country: z.string().min(2).max(2).describe("ISO 3166-1 alpha-2 country code"),
  lat: z.number().min(-90).max(90).optional().describe("Venue latitude, when known"),
  lng: z.number().min(-180).max(180).optional().describe("Venue longitude, when known"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("Event start time (24h HH:MM, local venue time), when a source reliably provides one"),
  venueKind: z.enum(['stadium', 'arena', 'club', 'theatre', 'hall', 'open-air', 'other']).optional().describe("Coarse venue category, inferred from the venue name -- a cheaper substitute for a full address"),
  festival: z.object({
    name: z.string(),
    url: z.string().url().or(z.literal("")).optional()
  }).optional().describe("Set when this concert is part of a multi-artist festival/event, not a standalone show"),
  lineup: z.array(z.string()).optional().describe("Other artists on the same bill (festival support acts/co-headliners), when known"),
  ticketUrl: z.string().url().or(z.literal("")).optional().describe("URL to buy tickets or event info page, or empty string"),
  originalSource: z.string().describe("Domain name of the source site (e.g., club-arena.de)"),
  scrapedAt: z.string().datetime().describe("ISO datetime when data was extracted")
});

export type Concert = z.infer<typeof ConcertSchema>;
