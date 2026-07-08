import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { getGeminiKeys, loadDotEnvFallback } from '../engine/gemini_keys.js';

/**
 * Model cascade, ordered by free-tier daily-quota headroom (checked live against
 * this project's actual rate-limit dashboard, ai.google.dev -> Rate Limits).
 * gemini-2.0-flash/-lite and gemini-2.5-pro are 0 RPD on this tier -- skipped
 * entirely, trying them would just waste a guaranteed-429 call every batch.
 *
 * The dashboard's display name isn't always the real, callable v1beta model ID --
 * confirmed live via `models?key=...` (the "Debug Model IDs" step): "Gemini 3
 * Flash" is actually `gemini-3-flash-preview`, "Gemma 4 31B"/"Gemma 4 26B" are
 * `gemma-4-31b-it`/`gemma-4-26b-a4b-it`. Using the bare dashboard-style names
 * (gemini-3-flash, gemma-4-31b, gemma-4-26b) 404s every time.
 *
 * The two Gemma models close the cascade: far more generous quota (1.5K RPD,
 * unlimited TPM) but do NOT support the googleSearch grounding tool, so they
 * can't verify a CURRENT tour date -- last-resort, no-search fallback only
 * (still fine for "does this artist have a well-known official site").
 */
const MODEL_CASCADE: { name: string; useSearch: boolean }[] = [
  { name: 'gemini-2.5-flash', useSearch: true },
  { name: 'gemini-2.5-flash-lite', useSearch: true },
  { name: 'gemini-3-flash-preview', useSearch: true },
  { name: 'gemini-3.1-flash-lite', useSearch: true },
  { name: 'gemini-3.5-flash', useSearch: true },
  { name: 'gemma-4-31b-it', useSearch: false },
  { name: 'gemma-4-26b-a4b-it', useSearch: false },
];

/** True for auth/quota errors -- the caller should mark this exact (key, model)
 * pair exhausted and move on, rather than retrying it again this run. */
function isQuotaOrAuthError(err: any): boolean {
  const status = err?.status ?? err?.statusCode;
  return status === 401 || status === 403 || status === 429;
}

/** True when the model ID itself doesn't exist/isn't callable (404) -- this is
 * permanent for the whole run (not transient like a 503), so the caller should
 * mark it exhausted just like a quota error rather than retrying it every batch. */
function isUnknownModelError(err: any): boolean {
  const status = err?.status ?? err?.statusCode;
  return status === 404;
}

async function loadDb() {
  return loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
}

function cleanAndParseJson(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Failed to parse LLM response as JSON. Content: "${cleaned}". Error: ${err.message}`);
  }
}

async function main() {
  await loadDotEnvFallback();

  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) {
    console.error('Error: no Gemini API key set (GEMINI_API_KEY[/_2/_3/_RESERV1..]) and none could be loaded from .env.');
    process.exit(1);
  }
  console.log(`[enrich-gemini-search] ${apiKeys.length} Gemini key(s) available for failover.`);

  const limitArg = process.argv[2] || '5';
  const outFileArg = process.argv[3] || '/tmp/results.json';
  const batchSizeArg = process.argv[4] || '3';
  const delayMsArg = process.argv[5] || '4000';
  const limit = parseInt(limitArg, 10);
  const batchSize = parseInt(batchSizeArg, 10);
  const delayMs = parseInt(delayMsArg, 10);

  if (isNaN(limit) || limit <= 0) {
    console.error('Error: Limit must be a positive integer.');
    process.exit(1);
  }
  if (isNaN(batchSize) || batchSize <= 0) {
    console.error('Error: batchSize must be a positive integer.');
    process.exit(1);
  }
  if (isNaN(delayMs) || delayMs < 0) {
    console.error('Error: delayMs must be a non-negative integer.');
    process.exit(1);
  }

  console.log(`[enrich-gemini-search] Loading database to select next ${limit} artists...`);
  const artists = await loadDb();
  const pending: string[] = [];
  for (const a of artists) {
    // sitesTriedAt: this same tier already looked at this artist and found nothing
    // (see enrich_sites.ts apply()) -- skip re-asking, but it's distinct from
    // enrichedAt so a clean miss here doesn't strand the artist from other tiers.
    if (!a.enrichedAt && !a.sitesTriedAt) pending.push(a.name);
    if (pending.length >= limit) break;
  }

  if (pending.length === 0) {
    console.log('[enrich-gemini-search] No pending artists found. Everything is enriched!');
    return;
  }

  console.log(`[enrich-gemini-search] Selected ${pending.length} artists: ${pending.join(', ')}`);

  const results: any[] = [];
  // (key index, model name) pairs already confirmed exhausted/broken this run --
  // skip retrying them on later batches instead of wasting a guaranteed-fail call.
  const exhausted = new Set<string>();

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    console.log(`[enrich-gemini-search] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(pending.length / batchSize)}: ${batch.join(', ')}...`);

    const prompt = `You are a meticulous music-industry data researcher and fact-checker.
For EACH artist/band below, find their real, current concert information sources and official profiles.

Artists to process:
${JSON.stringify(batch, null, 2)}

For each artist, perform search queries to find:
1. website: The artist's OWN official website (a domain they control, or official label/management site). NOT ticketmaster, songkick, bandsintown, setlist.fm, wikipedia, spotify, youtube, a fan site, or a store. null if none.
2. tourUrl: The exact page listing UPCOMING concert dates with cities (commonly /tour, /shows, /live, /concerts, /dates, /events). Check if it currently shows dated shows with city names. Prefer a page on the official site; if dates are only in an embedded Bandsintown/Songkick widget, still return the tour page URL but set scraper=null. null if none.
3. socials: Official profile URLs for spotify, instagram, facebook, youtube, telegram, vk. null for any you can't confirm official.
4. scraper: ONLY set (non-null) if you are certain the tourUrl is static, server-rendered HTML with repeating event rows you can target with CSS selectors. Then provide:
   - domain: Host of tourUrl (e.g. "www.sabaton.net")
   - url: Equal to tourUrl
   - type: "static_selectors"
   - selectors:
     - eventBlock: One repeating show row selector (e.g., ".event-row", "div.tour-item")
     - artistNameFallback: The artist's exact name
     - date: Date selector inside eventBlock
     - city: City selector inside eventBlock (or null)
     - venue: Venue selector inside eventBlock (or null)
     - country: Country selector inside eventBlock (or null)
     - ticketUrl: Ticket link selector inside eventBlock (or null)
     - venueNameFallback: "" if per-row venue exists, else a fallback
     - cityNameFallback: "" if per-row city exists, else a fallback
     - countryNameFallback: 2-letter ISO best guess for the main country of the tour
   If JS-rendered, a widget, or unsure of selectors, set scraper = null. A null scraper is much better than guessed selectors.
5. confidence: "high" only if you found the site and tour page and are certain; else "medium" or "low".

Your response must be a JSON object with a single key "results" containing an array of objects for each artist, in the exact order requested:
{
  "results": [
    {
      "name": "Artist Name",
      "website": "...",
      "tourUrl": "...",
      "socials": {
        "spotify": "...",
        "instagram": "...",
        "facebook": "...",
        "youtube": "...",
        "telegram": "...",
        "vk": "..."
      },
      "scraper": null or { ... },
      "confidence": "high"|"medium"|"low"
    }
  ]
}

Be extremely truthful. Never invent a URL. Return null rather than guess. Output every artist exactly once, using the exact input name.`;

    const noSearchNote = '\n\nNote: you do NOT have live web search for this request -- answer only from well-established training knowledge, and use confidence "low" for anything you are not highly certain of (especially tourUrl, which changes over time and you cannot verify live).';

    let success = false;
    let lastError: any = null;

    // Outer loop over keys: an auth/quota error exhausts that (key, model) pair, not
    // necessarily the whole key -- move to the next model first, and only actually
    // advance to the next key once every model in the cascade has failed for this one.
    outer: for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
      const genAI = new GoogleGenerativeAI(apiKeys[keyIdx]);
      for (const modelConfig of MODEL_CASCADE) {
        const exhaustedKey = `${keyIdx}:${modelConfig.name}`;
        if (exhausted.has(exhaustedKey)) continue;

        try {
          console.log(`[enrich-gemini-search] Attempting generation with model: ${modelConfig.name} (key ${keyIdx + 1}/${apiKeys.length}, search=${modelConfig.useSearch})`);
          const model = genAI.getGenerativeModel({
            model: modelConfig.name,
            tools: modelConfig.useSearch ? [{ googleSearch: {} } as any] : undefined,
          });

          const response = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: modelConfig.useSearch ? prompt : prompt + noSearchNote }] }],
          });

          const text = response.response.text();
          const parsed = cleanAndParseJson(text);

          if (parsed && Array.isArray(parsed.results)) {
            results.push(...parsed.results);
            console.log(`[enrich-gemini-search] Successfully processed batch using ${modelConfig.name}. Found websites: ${parsed.results.filter((r: any) => r.website).length}, tourUrls: ${parsed.results.filter((r: any) => r.tourUrl).length}`);
            success = true;
            break outer;
          } else {
            console.error(`[enrich-gemini-search] Invalid format returned for batch:`, text);
          }
        } catch (err: any) {
          if (isQuotaOrAuthError(err)) {
            console.warn(`[enrich-gemini-search] Auth/quota error on ${modelConfig.name} (key ${keyIdx + 1}, status ${err?.statusCode ?? err?.status}) -- marking exhausted, trying next model/key: ${err.message}`);
            exhausted.add(exhaustedKey);
          } else if (isUnknownModelError(err)) {
            console.warn(`[enrich-gemini-search] ${modelConfig.name} doesn't exist for this API version (404) -- marking exhausted so it isn't retried every batch: ${err.message}`);
            exhausted.add(exhaustedKey);
          } else {
            // Transient (e.g. 503 "high demand") -- worth retrying on a later batch,
            // so deliberately NOT added to `exhausted`.
            console.warn(`[enrich-gemini-search] Model ${modelConfig.name} failed: ${err.message}`);
          }
          lastError = err;
        }
      }
    }

    if (!success) {
      console.error(`[enrich-gemini-search] Failed to process batch after trying all ${apiKeys.length} key(s) x ${MODEL_CASCADE.length} model(s). Last error: ${lastError?.message}`);

      // Every (key, model) pair is a confirmed dead end -- no point burning the rest
      // of this run's batches (and the calling workflow's remaining sub-chunks) on
      // guaranteed-fail attempts. Stop now instead of looping to the end of `limit`
      // doing nothing; the calling shell loop greps for this exact line to break its
      // own outer loop early too (same pattern as the "nothing pending" early-exit).
      if (exhausted.size >= apiKeys.length * MODEL_CASCADE.length) {
        console.error('[enrich-gemini-search] All keys/models exhausted -- stopping early.');
        break;
      }
    }

    // Delay between batches to respect free-tier RPM limits (tune via 5th CLI arg)
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outFileArg), { recursive: true });
  await fs.writeFile(outFileArg, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`[enrich-gemini-search] Done! Wrote ${results.length} results to ${outFileArg}`);
}

main().catch((err) => {
  console.error('[enrich-gemini-search] Fatal error:', err);
  process.exit(1);
});
