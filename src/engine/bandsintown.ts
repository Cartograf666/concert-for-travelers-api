import axios from 'axios';
import * as fs from 'fs/promises';
import { Concert } from '../schemas/concert.js';

const BIT_BASE = 'https://rest.bandsintown.com/artists';

// The generic identifier a browser-embedded Bandsintown widget sends. This hits
// the PUBLIC widget feed (the same event data any embedded widget shows), NOT the
// gated partner API. Overridable via BANDSINTOWN_APP_ID so a real partner id can be
// slotted in later without a code change. Used politely -- rate-limited, cached, and
// self-throttling on any sign of blocking (see the sweep's consecutive-block guard).
const DEFAULT_APP_ID = 'js_127.0.0.1';

// ~1 request/second. Deliberately gentle -- this is a courtesy use of a public feed,
// not a licensed high-throughput API, so spacing matters more than raw speed.
const REQUEST_DELAY_MS = 1100;

// Per-run cap so the ~1400-artist list is worked in batches across scheduled runs
// ("пачками по очереди") rather than one giant blast. Stalest-first ordering means
// each run picks up where the last left off; overridable via env for a faster
// initial fill vs. gentler steady-state refresh.
const DEFAULT_MAX_ARTISTS_PER_RUN = 800;

// An artist fetched more recently than this is skipped this run -- tour dates don't
// change hour to hour, and this is what lets the per-run cap cycle through the whole
// list instead of re-fetching the same head of it every time.
const DEFAULT_FRESHNESS_DAYS = 6;

// Stop the whole sweep after this many consecutive request failures -- a sustained
// run of errors (esp. 403/429) most likely means the app_id/IP got throttled or
// blocked, and hammering further would only make it worse. Remaining artists fall
// back to their cached events, same as a per-artist failure.
const BLOCK_STREAK_LIMIT = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Full-English-name -> ISO 3166-1 alpha-2, built once from Intl over the complete
// alpha-2 set (Bandsintown is worldwide, so unlike the venue path this can't assume
// a small fixed country list). Bandsintown renders country as a full name
// ("United States", "Czechia"), but ConcertSchema requires a 2-letter code.
const ALL_ALPHA2 = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
];

function buildNameToCode(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of ALL_ALPHA2) {
      const name = dn.of(code);
      if (name) map.set(name.toLowerCase(), code);
    }
  } catch {
    // Intl.DisplayNames unavailable -- fall through to the alias table only.
  }
  // Bandsintown's spellings that don't match Intl's canonical English name.
  map.set('turkey', 'TR');
  map.set('russia', 'RU');
  map.set('south korea', 'KR');
  map.set('north korea', 'KP');
  map.set('czech republic', 'CZ');
  map.set('usa', 'US');
  map.set('united states of america', 'US');
  map.set('uk', 'GB');
  map.set('vietnam', 'VN');
  map.set('laos', 'LA');
  map.set('syria', 'SY');
  map.set('taiwan', 'TW');
  map.set('macau', 'MO');
  map.set('ivory coast', 'CI');
  map.set('democratic republic of the congo', 'CD');
  map.set('republic of the congo', 'CG');
  map.set('bolivia', 'BO');
  map.set('venezuela', 'VE');
  map.set('tanzania', 'TZ');
  map.set('moldova', 'MD');
  // Native-script names -- Bandsintown mostly returns English, but occasionally a
  // venue's own locale leaks through (observed live: a Japanese venue came back as
  // "日本", not "Japan"). Cover the big touring markets so those events aren't
  // silently dropped -- Japan especially is the exact gap that motivated this source.
  map.set('日本', 'JP');
  map.set('中国', 'CN');
  map.set('中國', 'CN');
  map.set('대한민국', 'KR');
  map.set('한국', 'KR');
  map.set('台灣', 'TW');
  map.set('台湾', 'TW');
  map.set('香港', 'HK');
  map.set('ประเทศไทย', 'TH');
  map.set('ไทย', 'TH');
  map.set('россия', 'RU');
  map.set('deutschland', 'DE');
  map.set('españa', 'ES');
  map.set('méxico', 'MX');
  map.set('brasil', 'BR');
  return map;
}
const NAME_TO_CODE = buildNameToCode();

/** Bandsintown country name -> ISO alpha-2, or null if unmappable (event dropped). */
export function bandsintownCountryToCode(name: string | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  // Only a 2-letter ASCII string is already an ISO code -- guard against 2-glyph
  // native-script names (e.g. "日本") being mistaken for one and passed through raw.
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return NAME_TO_CODE.get(trimmed.toLowerCase()) ?? null;
}

export interface BandsintownCache {
  [artistName: string]: {
    fetchedAt: string;
    concerts: Partial<Concert>[];
  };
}

export async function loadBandsintownCache(cachePath: string): Promise<BandsintownCache> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveBandsintownCache(cachePath: string, cache: BandsintownCache): Promise<void> {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

interface BitEvent {
  starts_at?: string;
  datetime?: string;
  url?: string;
  offers?: Array<{ url?: string }>;
  artist?: { name?: string };
  lineup?: string[];
  venue?: {
    name?: string;
    city?: string;
    country?: string;
    latitude?: string;
    longitude?: string;
  };
}

export function mapBitEventToConcert(event: BitEvent, queriedArtist: string, scrapedAt: string): Partial<Concert> | null {
  // Prefer the queried name (guaranteed to match a whitelist entry when the target
  // list overlaps the approved list) over Bandsintown's own spelling, which can
  // differ in casing/punctuation and slip past the matcher.
  const artist = queriedArtist || event.artist?.name || event.lineup?.[0];
  const rawDate = event.starts_at || event.datetime;
  const date = rawDate ? rawDate.slice(0, 10) : undefined; // ISO datetime -> YYYY-MM-DD
  const venue = event.venue;
  const country = bandsintownCountryToCode(venue?.country);

  if (!artist || !date || !venue?.name || !venue?.city || !country) {
    return null;
  }

  const lat = venue.latitude ? parseFloat(venue.latitude) : undefined;
  const lng = venue.longitude ? parseFloat(venue.longitude) : undefined;

  return {
    artist,
    date,
    venue: venue.name,
    city: venue.city,
    country,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    ticketUrl: event.offers?.[0]?.url || event.url,
    originalSource: 'bandsintown.com',
    scrapedAt
  };
}

export type BitFetchFn = (artist: string, appId: string, baseUrl: string) => Promise<BitEvent[]>;

const defaultBitFetch: BitFetchFn = async (artist, appId, baseUrl) => {
  // Bandsintown's path segment: '/' in a name breaks the route, so encode it.
  const url = `${baseUrl}/${encodeURIComponent(artist)}/events`;
  const res = await axios.get(url, {
    params: { app_id: appId },
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return Array.isArray(res.data) ? res.data : [];
};

export interface BandsintownSweepOptions {
  appId?: string;
  cache?: BandsintownCache;
  maxPerRun?: number;
  freshnessDays?: number;
  baseUrl?: string;
  fetchFn?: BitFetchFn;
  delayMs?: number;
}

/**
 * Artist-keyed concert sweep over Bandsintown's public widget feed. Unlike the
 * venue/Ticketmaster sources (bounded to markets we enumerate), this is keyed by
 * artist, so it covers wherever an artist actually tours worldwide -- the point of
 * it is markets the other sources miss (e.g. Japan). Feeds the same processConcerts
 * whitelist filter as everything else.
 *
 * Batched + resumable: only the stalest `maxPerRun` artists are actually re-fetched
 * each run (stale = not fetched within `freshnessDays`); everyone else's cached
 * events are still returned so the published set stays complete. The cache is
 * mutated in place and saved by the caller. Stops early on a sustained failure
 * streak (likely a block) and falls back to cache for the remainder.
 */
export async function fetchBandsintownConcerts(
  artists: string[],
  options: BandsintownSweepOptions = {}
): Promise<Partial<Concert>[]> {
  const appId = options.appId || process.env.BANDSINTOWN_APP_ID || DEFAULT_APP_ID;
  const cache = options.cache ?? {};
  const maxPerRun = options.maxPerRun ?? DEFAULT_MAX_ARTISTS_PER_RUN;
  const freshnessDays = options.freshnessDays ?? DEFAULT_FRESHNESS_DAYS;
  const baseUrl = options.baseUrl ?? BIT_BASE;
  const fetchFn = options.fetchFn ?? defaultBitFetch;
  const delayMs = options.delayMs ?? REQUEST_DELAY_MS;

  const scrapedAt = new Date().toISOString();
  const freshCutoff = Date.now() - freshnessDays * 24 * 60 * 60 * 1000;

  // De-dupe and drop blanks, then order stalest-first (never-fetched before
  // long-ago-fetched before recently-fetched) so the per-run cap advances through
  // the whole list over successive runs instead of re-doing the same head.
  const unique = Array.from(new Set(artists.map((a) => a.trim()).filter(Boolean)));
  const staleness = (name: string): number => {
    const c = cache[name];
    if (!c) return -Infinity; // never fetched -> highest priority
    return new Date(c.fetchedAt).getTime();
  };
  const ordered = [...unique].sort((a, b) => staleness(a) - staleness(b));

  let fetched = 0;
  let blockStreak = 0;
  let stopped = false;

  for (const artist of ordered) {
    if (stopped) break;
    if (fetched >= maxPerRun) break;

    const cached = cache[artist];
    if (cached && new Date(cached.fetchedAt).getTime() > freshCutoff) {
      continue; // still fresh -- leave it, its concerts are merged in at the end
    }

    try {
      const events = await fetchFn(artist, appId, baseUrl);
      const concerts: Partial<Concert>[] = [];
      for (const ev of events) {
        const c = mapBitEventToConcert(ev, artist, scrapedAt);
        if (c) concerts.push(c);
      }
      cache[artist] = { fetchedAt: scrapedAt, concerts };
      blockStreak = 0;
      fetched++;
      await sleep(delayMs);
    } catch (err: any) {
      const status = err.response?.status;
      // A 404 just means Bandsintown has no page for that exact name -- record an
      // empty result so we don't retry it every run, and it's NOT a block signal.
      if (status === 404) {
        cache[artist] = { fetchedAt: scrapedAt, concerts: [] };
        blockStreak = 0;
        fetched++;
        await sleep(delayMs);
        continue;
      }
      blockStreak++;
      console.warn(`[Bandsintown] ${artist} failed (${status ?? err.message}); streak ${blockStreak}/${BLOCK_STREAK_LIMIT}. Keeping any cached events.`);
      if (blockStreak >= BLOCK_STREAK_LIMIT) {
        console.error(`[Bandsintown] ${BLOCK_STREAK_LIMIT} consecutive failures -- likely throttled/blocked. Stopping this run; remaining artists use cached events.`);
        stopped = true;
      }
    }
  }

  // Return every artist's events -- freshly fetched this run plus everyone else's
  // last-good cache -- so a batched/partial run still publishes the full picture.
  const all: Partial<Concert>[] = [];
  for (const entry of Object.values(cache)) {
    all.push(...entry.concerts);
  }

  console.log(`[Bandsintown] Fetched ${fetched} artists this run (cap ${maxPerRun}); ${Object.keys(cache).length} cached total -> ${all.length} raw events.`);
  return all;
}
