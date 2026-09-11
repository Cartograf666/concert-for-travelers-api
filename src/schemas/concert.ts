import { z } from 'zod';
import { ArtistDiscoverySchema } from './artist_discovery.js';

/**
 * A URL that is safe to publish as a clickable link.
 *
 * Zod's `.url()` only checks that the string parses -- it accepts
 * `javascript:alert(1)`, `data:text/html,<script>...`, `vbscript:` and
 * `file:///etc/passwd` (verified against zod 4). Every URL field below is filled
 * from LLM enrichment output or a scraped page's href and is then published in
 * the static API, where a consumer app renders it as an anchor. A bare `.url()`
 * therefore hands whoever controls a venue page or an enrichment response a
 * stored-XSS primitive in every downstream client.
 *
 * Restricting to http/https costs nothing: an artist website, social profile or
 * ticket link is never any other scheme.
 */
const HTTP_SCHEMES = new Set(['http:', 'https:']);

export const httpUrl = () =>
  z.string().url().refine((value) => {
    try {
      return HTTP_SCHEMES.has(new URL(value).protocol);
    } catch {
      return false;
    }
  }, { message: 'must be an http(s) URL' });

/**
 * Upper bounds on the free-text fields. These are not cosmetic: `city` and
 * `venue` become filenames (dist/cities/{slug}.json), and a scraper config whose
 * `city` selector matches the same element as `venue` emits the entire event
 * block -- ticket blurb, times, lineup and all -- as the "city". Unbounded, that
 * shipped 60+ junk cities into the live API and, once a Japanese listing pushed
 * a slug past the filesystem's 255-BYTE filename limit, crashed publish outright
 * for 23 consecutive nights. The bounds are deliberately loose: the longest real
 * place name in use is ~85 characters, so 120 rejects blurbs without ever
 * touching a genuine city.
 */
export const MAX_CITY_LENGTH = 120;
export const MAX_VENUE_LENGTH = 200;
export const MAX_ARTIST_LENGTH = 200;

export const ConcertSchema = z.object({
  artist: z.string().min(1).max(MAX_ARTIST_LENGTH).describe("Normalized artist or band name"),
  // Optional only so cached legacy concert feeds remain parseable. New pipeline
  // output always includes this stable projection of the matched approved row.
  artistDiscovery: ArtistDiscoverySchema.optional(),
  artistWebsite: httpUrl().or(z.literal("")).optional().describe("Official website of the artist"),
  spotifyId: z.string().optional().describe("Spotify artist ID, parsed from artistSocials.spotify -- lets a consumer app match a loved artist by ID instead of a fragile name string"),
  mbid: z.string().optional().describe("MusicBrainz artist MBID, from MusicBrainz/Wikidata enrichment -- a free, stable canonical artist ID"),
  artistSocials: z.object({
    spotify: httpUrl().or(z.literal("")).optional().nullable(),
    instagram: httpUrl().or(z.literal("")).optional().nullable(),
    facebook: httpUrl().or(z.literal("")).optional().nullable(),
    youtube: httpUrl().or(z.literal("")).optional().nullable(),
    telegram: httpUrl().or(z.literal("")).optional().nullable(),
    vk: httpUrl().or(z.literal("")).optional().nullable()
  }).optional().describe("Official social links of the artist"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("ISO Date: YYYY-MM-DD"),
  venue: z.string().min(1).max(MAX_VENUE_LENGTH).describe("Name of the venue/club"),
  city: z.string().min(1).max(MAX_CITY_LENGTH).describe("City name"),
  country: z.string().min(2).max(2).describe("ISO 3166-1 alpha-2 country code"),
  lat: z.number().min(-90).max(90).optional().describe("Venue latitude, when known"),
  lng: z.number().min(-180).max(180).optional().describe("Venue longitude, when known"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("Event start time (24h HH:MM, local venue time), when a source reliably provides one"),
  venueKind: z.enum(['stadium', 'arena', 'club', 'theatre', 'hall', 'open-air', 'other']).optional().describe("Coarse venue category, inferred from the venue name -- a cheaper substitute for a full address"),
  festival: z.object({
    name: z.string(),
    url: httpUrl().or(z.literal("")).optional()
  }).optional().describe("Set when this concert is part of a multi-artist festival/event, not a standalone show"),
  lineup: z.array(z.string()).optional().describe("Other artists on the same bill (festival support acts/co-headliners), when known"),
  priceRange: z.object({
    min: z.number().min(0),
    max: z.number().min(0),
    currency: z.string()
  }).optional().describe("Best-effort ticket price range, from Ticketmaster's own structured priceRanges only -- scraped venue pages rarely expose a clean structured price, so this is never guessed/parsed from free text"),
  ticketUrl: httpUrl().or(z.literal("")).optional().describe("The artist's own official website when known (NOT a ticket-vendor/aggregator purchase link -- those are often an unlabeled widget or generic city page); falls back to the source's raw ticket/event link only when no artist website is known, or empty string"),
  originalSource: z.string().describe("Domain name of the source site (e.g., club-arena.de)"),
  scrapedAt: z.string().datetime().describe("ISO datetime when data was extracted")
});

export type Concert = z.infer<typeof ConcertSchema>;
