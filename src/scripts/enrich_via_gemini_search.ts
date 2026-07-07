import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs/promises';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'approved_artists.json');

async function loadDb() {
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw);
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
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Try loading from .env in project root
    try {
      const dotenvContent = await fs.readFile(path.join(process.cwd(), '.env'), 'utf-8');
      const match = dotenvContent.match(/^GEMINI_API_KEY\s*=\s*["']?(.*?)["']?$/m);
      if (match) apiKey = match[1].trim();
    } catch {}
  }
  if (!apiKey) {
    // Try loading from ~/.env
    try {
      const dotenvContent = await fs.readFile(path.join(process.env.HOME || '', '.env'), 'utf-8');
      const match = dotenvContent.match(/^GEMINI_API_KEY\s*=\s*["']?(.*?)["']?$/m);
      if (match) apiKey = match[1].trim();
    } catch {}
  }

  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is not set and could not be loaded from .env.');
    process.exit(1);
  }

  const limitArg = process.argv[2] || '5';
  const outFileArg = process.argv[3] || '/tmp/results.json';
  const limit = parseInt(limitArg, 10);

  if (isNaN(limit) || limit <= 0) {
    console.error('Error: Limit must be a positive integer.');
    process.exit(1);
  }

  console.log(`[enrich-gemini-search] Loading database to select next ${limit} artists...`);
  const artists = await loadDb();
  const pending: string[] = [];
  for (const a of artists) {
    if (!a.enrichedAt) pending.push(a.name);
    if (pending.length >= limit) break;
  }

  if (pending.length === 0) {
    console.log('[enrich-gemini-search] No pending artists found. Everything is enriched!');
    return;
  }

  console.log(`[enrich-gemini-search] Selected ${pending.length} artists: ${pending.join(', ')}`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const batchSize = 3; // small batches to ensure precise search for each artist
  const results: any[] = [];
  
  const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

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

    let success = false;
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`[enrich-gemini-search] Attempting generation with model: ${modelName}`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: [{ googleSearchRetrieval: {} } as any],
        });

        const response = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        });

        const text = response.response.text();
        const parsed = cleanAndParseJson(text);

        if (parsed && Array.isArray(parsed.results)) {
          results.push(...parsed.results);
          console.log(`[enrich-gemini-search] Successfully processed batch using ${modelName}. Found websites: ${parsed.results.filter((r: any) => r.website).length}, tourUrls: ${parsed.results.filter((r: any) => r.tourUrl).length}`);
          success = true;
          break; // Success! Break out of the model loop
        } else {
          console.error(`[enrich-gemini-search] Invalid format returned for batch:`, text);
        }
      } catch (err: any) {
        console.warn(`[enrich-gemini-search] Model ${modelName} failed: ${err.message}`);
        lastError = err;
      }
    }

    if (!success) {
      console.error(`[enrich-gemini-search] Failed to process batch after trying all models. Last error: ${lastError?.message}`);
    }

    // Small delay between batches to respect rate limits
    await new Promise((resolve) => setTimeout(resolve, 3000));
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
