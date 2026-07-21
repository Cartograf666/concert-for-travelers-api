import { GoogleGenerativeAI } from '@google/generative-ai';
import { load as loadHtml } from 'cheerio';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { slugify } from '../pipeline/process.js';
import { isBlockedHost, ScraperConfigSchema, ScraperConfig } from '../schemas/config.js';
import { ArtistEntry } from '../schemas/artist.js';
import { getGeminiKeys, loadDotEnvFallback } from '../engine/gemini_keys.js';

const SCRAPERS_ARTISTS_DIR = path.join(process.cwd(), 'scrapers', 'artists');
const HTML_SAMPLE_LIMIT = 60000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'ConcertForTravelers/1.0 (+https://github.com/)';
const MODEL_CASCADE = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'];

export interface TourScraperCandidate {
  name: string;
  tourUrl: string;
}

interface ExtractionResult {
  name: string;
  scraper: unknown | null;
  reason?: string;
}

async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
}

async function saveDb(artists: ArtistEntry[]): Promise<void> {
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
}

function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripNulls).filter((v) => v !== null && v !== undefined) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

export async function loadExistingArtistScraperNames(dir = SCRAPERS_ARTISTS_DIR): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const config = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8'));
        const name = config?.selectors?.artistNameFallback;
        if (typeof name === 'string' && name.trim()) names.add(name.trim().toLowerCase());
      } catch {
        // Ignore malformed configs here; the scraper loader reports them.
      }
    }
  } catch {
    // No artist scraper directory yet.
  }
  return names;
}

export function selectTourScraperCandidates(
  artists: ArtistEntry[],
  existingScraperNames: Set<string>,
  limit: number
): TourScraperCandidate[] {
  const pending: TourScraperCandidate[] = [];
  for (const artist of artists) {
    if (!artist.tourUrl || artist.tourScraperTriedAt) continue;
    if (artist.tier && artist.tier !== 'professional') continue;
    if (existingScraperNames.has(artist.name.toLowerCase())) continue;
    pending.push({ name: artist.name, tourUrl: artist.tourUrl });
    if (pending.length >= limit) break;
  }
  return pending;
}

export function buildScraperConfig(name: string, tourUrl: string, rawScraper: unknown): ScraperConfig | null {
  if (!rawScraper || typeof rawScraper !== 'object') return null;
  let domain = '';
  try {
    const parsedUrl = new URL(tourUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    if (isBlockedHost(parsedUrl.hostname)) return null;
    domain = parsedUrl.hostname;
  } catch {
    return null;
  }
  const raw = rawScraper as Record<string, unknown>;
  const rawSelectors =
    raw.selectors && typeof raw.selectors === 'object' && !Array.isArray(raw.selectors)
      ? raw.selectors as Record<string, unknown>
      : {};
  const candidate = stripNulls({
    ...raw,
    id: `artist-${slugify(name)}`,
    domain,
    url: tourUrl,
    type: 'static_selectors',
    selectors: {
      ...rawSelectors,
      artistNameFallback: name
    }
  });
  const parsed = ScraperConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function validateStaticSelectorsAgainstHtml(html: string, config: ScraperConfig): { ok: boolean; reason: string } {
  if (config.type !== 'static_selectors') return { ok: false, reason: `unsupported type ${config.type}` };
  if (!config.selectors) return { ok: false, reason: 'missing selectors' };
  const { eventBlock, date } = config.selectors;
  if (!eventBlock || !date) return { ok: false, reason: 'missing eventBlock/date selectors' };

  try {
    const $ = loadHtml(html);
    const blocks = $(eventBlock);
    if (blocks.length === 0) return { ok: false, reason: `eventBlock matched 0 nodes: ${eventBlock}` };
    const dateMatches = blocks
      .toArray()
      .filter((block) => $(block).find(date).first().text().trim().length > 0).length;
    if (dateMatches === 0) return { ok: false, reason: `date selector matched 0 non-empty nodes inside eventBlock: ${date}` };
    return { ok: true, reason: `eventBlocks=${blocks.length}, dateMatches=${dateMatches}` };
  } catch (err: any) {
    return { ok: false, reason: `selector validation failed: ${err.message}` };
  }
}

export async function fetchTourHtml(tourUrl: string, redirectsLeft = MAX_REDIRECTS): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(tourUrl);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (isBlockedHost(parsed.hostname)) return null;

  const res = await fetch(tourUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000),
    redirect: 'manual'
  } as any);
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers?.get('location');
    if (!location || redirectsLeft <= 0) return null;
    let nextUrl: string;
    try {
      nextUrl = new URL(location, tourUrl).toString();
    } catch {
      return null;
    }
    return fetchTourHtml(nextUrl, redirectsLeft - 1);
  }
  if (!res.ok) return null;
  const html = await res.text();
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .slice(0, HTML_SAMPLE_LIMIT);
}

function cleanAndParseJson(text: string): any {
  let cleaned = text.trim();
  const block = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (block) cleaned = block[1].trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}

async function extractWithGemini(apiKeys: string[], candidate: TourScraperCandidate, html: string): Promise<ExtractionResult> {
  const prompt = `Given this artist tour page HTML sample, extract a static_selectors scraper config if the page has server-rendered repeated event rows.

Artist: ${candidate.name}
Tour URL: ${candidate.tourUrl}

Return JSON:
{
  "name": "${candidate.name}",
  "scraper": null OR {
    "type": "static_selectors",
    "selectors": {
      "eventBlock": "...",
      "date": "...",
      "venue": "...",
      "city": "...",
      "country": "...",
      "ticketUrl": "...",
      "venueNameFallback": "",
      "cityNameFallback": "",
      "countryNameFallback": "GB"
    }
  },
  "reason": "short explanation"
}

Only return scraper when selectors are grounded in repeated HTML in the sample. Use null for JS-rendered, widget-only, or uncertain pages.

HTML sample:
${html}`;

  let lastError: any = null;
  for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
    const genAI = new GoogleGenerativeAI(apiKeys[keyIdx]);
    for (const modelName of MODEL_CASCADE) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const response = await model.generateContent(prompt);
        const parsed = cleanAndParseJson(response.response.text());
        return { name: candidate.name, scraper: parsed?.scraper ?? null, reason: parsed?.reason };
      } catch (err: any) {
        lastError = err;
        const status = err?.status ?? err?.statusCode;
        if (![401, 403, 404, 429].includes(status)) {
          console.warn(`[tour-scraper] ${modelName} failed for ${candidate.name}: ${err.message}`);
        }
      }
    }
  }
  throw new Error(`All Gemini models failed for ${candidate.name}: ${lastError?.message ?? 'unknown error'}`);
}

async function run(limit: number): Promise<void> {
  await loadDotEnvFallback();
  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) throw new Error('No Gemini API key set for tour scraper extraction.');

  const artists = await loadDb();
  const existing = await loadExistingArtistScraperNames();
  const candidates = selectTourScraperCandidates(artists, existing, limit);
  if (candidates.length === 0) {
    console.log('[tour-scraper] No pending tourUrl scraper candidates.');
    return;
  }

  await fs.mkdir(SCRAPERS_ARTISTS_DIR, { recursive: true });
  const byName = new Map(artists.map((artist) => [artist.name.toLowerCase(), artist]));
  const now = new Date().toISOString();
  let created = 0;
  let attempted = 0;

  for (const candidate of candidates) {
    const artist = byName.get(candidate.name.toLowerCase());
    if (!artist) continue;
    attempted++;
    artist.tourScraperTriedAt = now;

    try {
      const html = await fetchTourHtml(candidate.tourUrl);
      if (!html) {
        console.log(`[tour-scraper] ${candidate.name}: could not fetch tourUrl.`);
        continue;
      }

      const result = await extractWithGemini(apiKeys, candidate, html);
      const config = buildScraperConfig(candidate.name, candidate.tourUrl, result.scraper);
      if (!config) {
        console.log(`[tour-scraper] ${candidate.name}: no valid static scraper (${result.reason ?? 'no reason'}).`);
        continue;
      }

      const validation = validateStaticSelectorsAgainstHtml(html, config);
      if (!validation.ok) {
        console.log(`[tour-scraper] ${candidate.name}: selector validation failed (${validation.reason}).`);
        continue;
      }

      await fs.writeFile(path.join(SCRAPERS_ARTISTS_DIR, `${config.id}.json`), JSON.stringify(config, null, 2), 'utf-8');
      artist.tourScraperCreatedAt = now;
      created++;
      console.log(`[tour-scraper] ${candidate.name}: wrote ${config.id}.json (${validation.reason})`);
    } catch (err: any) {
      console.warn(`[tour-scraper] ${candidate.name}: failed, keeping progress and continuing (${err.message}).`);
    } finally {
      await saveDb(artists);
    }
  }

  console.log(`[tour-scraper] Done. attempted=${attempted}, configsCreated=${created}.`);
}

async function select(limit: number): Promise<void> {
  const artists = await loadDb();
  const existing = await loadExistingArtistScraperNames();
  const candidates = selectTourScraperCandidates(artists, existing, limit);
  process.stdout.write(JSON.stringify(candidates, null, 2) + '\n');
}

async function main() {
  const [mode, arg1] = process.argv.slice(2);
  const limit = parseInt(arg1 || '100', 10);
  if (mode === 'select') return select(limit);
  if (!mode || mode === 'run') return run(limit);
  console.error('Usage: extract_tour_scrapers.ts <run <N=100> | select <N=100>>');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tour-scraper] Fatal: ${err.message}`);
    process.exit(1);
  });
}
