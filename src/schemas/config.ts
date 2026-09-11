import { z } from 'zod';

// Scraper configs are meant to be community-contributed (a PR drops a new
// scrapers/*.json in). A url pointing at localhost/private-network/link-local
// addresses would let a malicious config make the scraping runner (which runs
// unattended in GitHub Actions) issue requests to internal/metadata endpoints
// and exfiltrate the response via the fail-log/htmlSample artifact -- so those
// hosts are rejected outright. This is a static string check (no DNS resolution),
// so it does not defend against DNS-rebinding; it covers the direct case of a
// literal private IP or a localhost-style hostname in the config itself.
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;

  // Private-network name suffixes and the named cloud metadata host. A venue or
  // artist site never lives on one of these, and `metadata.google.internal` is a
  // real credential endpoint reachable by name rather than by the 169.254 literal
  // the numeric rules below cover.
  if (h === 'metadata.google.internal') return true;
  for (const suffix of ['.internal', '.local', '.lan', '.home.arpa', '.intranet', '.corp']) {
    if (h.endsWith(suffix)) return true;
  }

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10) -- carrier-side private space
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark (198.18.0.0/15)
    // TEST-NET blocks: reserved for documentation, so a config pointing at one is
    // a copy-paste from an example rather than a real venue.
    if (a === 192 && b === 0 && Number(ipv4[3]) === 2) return true; // 192.0.2.0/24
    if (a === 198 && b === 51 && Number(ipv4[3]) === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && Number(ipv4[3]) === 113) return true; // 203.0.113.0/24
    if (a >= 224) return true; // multicast (224/4) and reserved (240/4)
    return false;
  }

  // Non-standard integer / hex / leading-zero IP encodings that the OS resolver may still
  // accept (http://2130706433 = 127.0.0.1, http://0x7f000001, http://0177.0.0.1). We can't
  // safely canonicalize every form, so reject anything that looks like a numeric-literal
  // host outright — a real DNS hostname never looks like this.
  if (/^\d+$/.test(h)) return true;                       // bare decimal integer
  if (/^0x[0-9a-f]+$/i.test(h)) return true;              // bare hex
  if (/^(0x[0-9a-f]+|0[0-7]*|\d+)(\.(0x[0-9a-f]+|0[0-7]*|\d+)){1,3}$/i.test(h)
      && /(^0x|\.0x|^0\d|\.0\d)/i.test(h)) return true;   // dotted form with a hex/octal octet

  const ipv6 = parseIpv6(h);
  if (ipv6 !== null) {
    // IPv6 wrappers need explicit handling before the public-unicast allowlist.
    // IPv4-mapped/compatible/translated forms are protocol-internal, not public
    // IPv6 destinations; accepting them creates alternate spellings for a URL
    // that should have used the ordinary IPv4 policy.
    const lowV4 = Number(ipv6 & 0xffffffffn);
    if (inIpv6Prefix(ipv6, 96, 0n) ||
        inIpv6Prefix(ipv6, 96, 0xffffn) ||
        inIpv6Prefix(ipv6, 96, 0xffff0000n)) return true;

    // RFC 6052's well-known NAT64 prefix is globally reachable, but only when
    // it embeds an IPv4 address our normal public-address policy allows.
    if (inIpv6Prefix(ipv6, 96, 0x64ff9b0000000000000000n)) {
      return isBlockedHost(formatIpv4(lowV4));
    }

    // Everything outside global unicast is denied by default. This covers
    // unspecified/loopback, discard-only, local-use NAT64, site-local
    // (fec0::/10), unique-local, link-local, multicast, and the currently
    // reserved address space. Keeping this as an allowlist prevents a newly
    // exposed special range from silently becoming an SSRF bypass.
    if (!inIpv6Prefix(ipv6, 3, 0x1n)) return true; // 2000::/3

    // Non-global special-purpose blocks that sit inside 2000::/3. 2001::/23 is
    // reserved for IETF protocol assignments (with a few service-specific
    // exceptions that are not web origins), 2002::/16 is deprecated 6to4, and
    // the two documentation ranges must never appear as a live destination.
    if (inIpv6Prefix(ipv6, 23, 0x100080n) || // 2001::/23
        inIpv6Prefix(ipv6, 32, 0x20010db8n) ||
        inIpv6Prefix(ipv6, 16, 0x2002n) ||
        inIpv6Prefix(ipv6, 20, 0x3fff0n)) return true;

    return false; // ordinary public global-unicast AAAA record
  }

  return false;
}

/** Whether a parsed IPv6 integer begins with the supplied high-order prefix. */
function inIpv6Prefix(address: bigint, bits: number, prefix: bigint): boolean {
  return (address >> BigInt(128 - bits)) === prefix;
}

/** Converts a 32-bit IPv4 value to the dotted spelling consumed by the v4 policy. */
function formatIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

/**
 * Parses a valid IPv6 literal into an unsigned 128-bit number. URL/DNS callers
 * give us canonical hex, but accepting a dotted tail here also keeps direct
 * policy checks correct for the common ::ffff:192.168.0.1 spelling.
 */
function parseIpv6(input: string): bigint | null {
  if (!input.includes(':') || input.includes('%')) return null;
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const parts = side.split(':');
    const words: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const match = part.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (!match || match.slice(1).some((octet) => Number(octet) > 255)) return null;
        words.push((Number(match[1]) << 8) | Number(match[2]), (Number(match[3]) << 8) | Number(match[4]));
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
        words.push(parseInt(part, 16));
      }
    }
    return words;
  };
  const left = parseSide(halves[0]);
  const right = parseSide(halves[1] ?? '');
  if (!left || !right) return null;
  const hasCompression = halves.length === 2;
  if ((hasCompression && left.length + right.length >= 8) || (!hasCompression && left.length + right.length !== 8)) return null;
  const words = hasCompression
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : left;
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
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
  httpClient: z.enum(['axios', 'got-scraping']).optional().describe("Plain-HTTP fetch backend for this venue (ignored by 'playwright_render'). 'axios' (default) rotates a static User-Agent; 'got-scraping' generates a full, order-correct browser header set (sec-ch-ua, sec-fetch-*) to get past header-fingerprint anti-bot checks. The global env override SCRAPER_HTTP_BACKEND wins over this per-config value."),
  maxRetries: z.number().int().min(0).max(5).optional().describe("Retry attempts on transient fetch failures (network/timeout/429/5xx). Defaults to 2."),
  // Bounded because this value is not always human-written: enrich_sites and
  // extract_tour_scrapers build configs out of LLM output, and politeDelay
  // reserves the next slot in a per-domain map shared by every config on that
  // host BEFORE it sleeps. An unbounded value therefore stalls not just its own
  // scraper but every sibling on the same domain for the rest of the run. Ten
  // minutes is far beyond any real politeness need and still bounded.
  requestDelayMs: z.number().int().min(0).max(600000).optional().describe("Minimum delay between successive requests to this domain (politeness throttle), max 10 minutes."),
  allowEmpty: z.boolean().optional().describe("Set true for venues with a genuinely sparse/seasonal schedule, so 0 parsed events is treated as a valid (empty) result instead of a broken-selector failure."),
  selectors: ScraperSelectorsSchema.optional()
});

export type ScraperSelectors = z.infer<typeof ScraperSelectorsSchema>;
export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
