import { z } from 'zod';

// Scraper configs are meant to be community-contributed (a PR drops a new
// scrapers/*.json in). A url pointing at localhost/private-network/link-local
// addresses would let a malicious config make the scraping runner (which runs
// unattended in GitHub Actions) issue requests to internal/metadata endpoints
// and exfiltrate the response via the fail-log/htmlSample artifact -- so those
// hosts are rejected outright. This is a static string check (no DNS resolution),
// so it does not defend against DNS-rebinding; it covers the direct case of a
// literal private IP or a localhost-style hostname in the config itself.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
    if (a === 0) return true;
    return false;
  }

  if (h === '::1' || h === '::') return true; // IPv6 loopback/unspecified
  if (/^fe80:/.test(h)) return true; // IPv6 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // IPv6 unique local (fc00::/7)

  return false;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

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
  countryNameFallback: z.string().min(2).max(2).describe("Fallback country code (2-char)"),
  lat: z.number().min(-90).max(90).optional().describe("Venue latitude (geocoded once via scripts/geocode_venues.ts, cached here to avoid re-querying)"),
  lng: z.number().min(-180).max(180).optional().describe("Venue longitude (geocoded once via scripts/geocode_venues.ts, cached here to avoid re-querying)")
});

export const ScraperConfigSchema = z.object({
  // Strict charset: `id` is interpolated into a filesystem path
  // (path.join(scrapersDir, `${id}.json`) in run.ts, written by the self-healer) and
  // into a dynamic module specifier (import(`./custom/${id}.js`) in runner.ts). Allowing
  // `/`, `.` or `..` here would let a community-contributed config traverse out of
  // scrapers/ (overwrite arbitrary repo files in CI) or load an arbitrary module during
  // the unattended daily run. Lowercase alphanumerics + hyphens only closes both sinks.
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/, "id must be lowercase letters, digits and hyphens only (e.g. club-arena-berlin)").describe("Unique identifier, e.g., club-arena-berlin"),
  domain: z.string().describe("Site domain name, e.g., club-arena-berlin.de"),
  url: z.string().url().refine(
    (u) => {
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        return false;
      }
      return ALLOWED_PROTOCOLS.has(parsed.protocol) && !isBlockedHost(parsed.hostname);
    },
    { message: "url must be http(s) and must not target localhost/private-network/link-local/metadata addresses" }
  ).describe("Target schedule URL to scrape"),
  type: z.enum(['static_selectors', 'json_api', 'custom_js', 'jsonld', 'next_data', 'playwright_render']).default('static_selectors'),
  maxRetries: z.number().int().min(0).max(5).optional().describe("Retry attempts on transient fetch failures (network/timeout/429/5xx). Defaults to 2."),
  requestDelayMs: z.number().int().min(0).optional().describe("Minimum delay between successive requests to this domain (politeness throttle)."),
  allowEmpty: z.boolean().optional().describe("Set true for venues with a genuinely sparse/seasonal schedule, so 0 parsed events is treated as a valid (empty) result instead of a broken-selector failure."),
  selectors: ScraperSelectorsSchema.optional()
});

export type ScraperSelectors = z.infer<typeof ScraperSelectorsSchema>;
export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
