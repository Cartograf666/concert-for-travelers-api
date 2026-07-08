import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ArtistSocials {
  spotify?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  telegram?: string | null;
  vk?: string | null;
}

export interface ArtistEntry {
  name: string;
  website: string | null;
  socials?: ArtistSocials;
}

/** Matches repair.ts's check: 401/403/429 mean this key/model is unauthorized or
 * out of quota; 404 means the model ID itself doesn't exist (e.g. a deprecated
 * model still listed in the cascade). Every case is permanent for the rest of
 * this run -- retrying the same model again is pointless either way, so both
 * get treated identically ("skip this model, don't come back to it"). The old
 * @google/generative-ai SDK doesn't structure errors as consistently as the
 * Vercel AI SDK repair.ts uses, so this also falls back to sniffing the message. */
function isAuthOrQuotaError(err: any): boolean {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if (status === 401 || status === 403 || status === 404 || status === 429) return true;
  return /\b(401|403|404|429)\b|quota|rate.?limit|not found/i.test(err?.message || '');
}

/**
 * Strips markdown and parses the LLM output as JSON.
 */
function cleanAndParseArtistBatch(text: string): ArtistEntry[] {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error(`[Enricher] Failed to parse batch JSON. Text: "${cleaned}". Error: ${err.message}`);
    return [];
  }
}

export type GenerateEnrichmentFn = (args: { prompt: string; modelName: string; apiKey: string }) => Promise<string>;

async function defaultGenerateEnrichment({ prompt, modelName, apiKey }: { prompt: string; modelName: string; apiKey: string }): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Ordered by daily-quota generosity on the free tier (checked live against the
// project's actual rate-limit dashboard), not capability -- this is a simple
// factual lookup (does an artist have a known website/social link), not a task
// that needs the strongest reasoning model. Gemma's free RPD is ~75x a Gemini
// Flash tier's (1500 vs 20), so trying it first before ever touching the
// Gemini-branded quota meaningfully cuts how often this cascade hits 429s at
// all. gemini-1.5-flash/gemini-1.5-pro are deliberately absent: they no longer
// appear in the project's model catalog at all (deprecated), so every batch
// was wasting a guaranteed-fail attempt on them.
export const DEFAULT_ENRICHMENT_MODELS = [
  'gemma-4-26b', 'gemma-4-31b',
  'gemini-3.1-flash-lite', 'gemini-3-flash',
  'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'
];

/**
 * Batches and queries Gemini to enrich missing artist metadata. `generateFn` and
 * `models` are both injectable (default to the real Gemini call / real model
 * cascade) so the quota-exhaustion/early-exit logic can be tested without hitting
 * a real API or depending on the exact current model lineup.
 */
export async function enrichMissingArtistMetadata(
  artistsToEnrich: string[],
  approvedArtistsPath: string,
  apiKeys: string | string[],
  generateFn: GenerateEnrichmentFn = defaultGenerateEnrichment,
  models: string[] = DEFAULT_ENRICHMENT_MODELS
): Promise<void> {
  // Accept a single key (back-compat) or several; rotate to the next when every
  // model on the current key is quota-exhausted, to multiply the small per-key
  // free-tier daily budget.
  const keys = (Array.isArray(apiKeys) ? apiKeys : [apiKeys]).filter(Boolean);
  if (keys.length === 0) {
    console.error('[Enricher] No Gemini API key provided. Skipping enrichment.');
    return;
  }

  if (artistsToEnrich.length === 0) {
    console.log('[Enricher] No artists to check for enrichment.');
    return;
  }

  // 1. Read existing whitelist
  let approvedArtists: ArtistEntry[] = [];
  try {
    const data = await fs.readFile(approvedArtistsPath, 'utf-8');
    approvedArtists = JSON.parse(data);
  } catch (err: any) {
    console.error(`[Enricher] Could not load approved artists list for enrichment: ${err.message}`);
    return;
  }

  // 2. Identify which of the scraped artists have missing metadata
  const missingArtists = artistsToEnrich.filter(name => {
    const entry = approvedArtists.find(a => a.name.toLowerCase() === name.toLowerCase());
    // Enrich if entry doesn't exist, has null website, or lacks socials
    return !entry || entry.website === null || !entry.socials;
  });

  if (missingArtists.length === 0) {
    console.log('[Enricher] All active artists already have metadata populated. Skipping.');
    return;
  }

  console.log(`[Enricher] Found ${missingArtists.length} active artists with missing metadata. Querying Gemini...`);

  // Batch artists to avoid overloading (e.g. 15 per batch)
  const batchSize = 15;
  const totalBatches = Math.ceil(missingArtists.length / batchSize);

  // Models confirmed quota-exhausted (401/403/429) THIS run. Free-tier daily quotas
  // are small (e.g. 20 requests/day per model) -- on a big enrichment run they can
  // exhaust within the first few batches, and without this the cascade would retry
  // every dead model on every single remaining batch: N batches x however-many
  // doomed attempts each, for no gain -- real case observed with the Ticketmaster
  // sweep surfacing far more never-before-seen artists than a typical run.
  const exhaustedModels = new Set<string>();
  const modelsAvailable = models;
  // Which key we're currently on; advances only when the current key's whole model
  // list is exhausted. `allExhausted` short-circuits the remaining batches once every
  // key has also run dry.
  let currentKeyIdx = 0;
  let allExhausted = false;

  for (let i = 0; i < missingArtists.length; i += batchSize) {
    if (allExhausted) {
      console.error(`[Enricher] All models across all ${keys.length} key(s) are quota-exhausted for this run -- stopping early instead of grinding through the remaining ${missingArtists.length - i} artists. They'll be picked up on the next run.`);
      break;
    }

    const batch = missingArtists.slice(i, i + batchSize);
    console.log(`[Enricher] Processing batch ${Math.floor(i / batchSize) + 1}/${totalBatches}: ${batch.join(', ')}`);

    const prompt = `You are a professional music database editor.
Find the official website and official social media profiles (Spotify artist link, Instagram profile, Facebook page, YouTube channel, Telegram channel, and VK group) for the following artists/bands:
${JSON.stringify(batch)}

Your output must be a valid JSON array of objects conforming to this shape:
[
  {
    "name": "Exact artist name from input list",
    "website": "Official website URL (or null if not found)",
    "socials": {
      "spotify": "Spotify artist URL (or null)",
      "instagram": "Official Instagram URL (or null)",
      "facebook": "Official Facebook URL (or null)",
      "youtube": "Official YouTube channel URL (or null)",
      "telegram": "Official Telegram URL (or null)",
      "vk": "Official VK URL (or null)"
    }
  }
]

Provide ONLY the raw JSON array. Do not include markdown code block backticks (\`\`\`json) or any explanations. If a URL is missing or cannot be found, set it to null.`;

    try {
      let responseText: string | null = null;
      let lastError: any = null;

      // Try every non-exhausted model on the current key; if they all exhaust,
      // rotate to the next key (fresh quota, models reset) and try again. Only give
      // up on the batch once no key has an available model left.
      while (responseText === null) {
        for (const modelName of modelsAvailable) {
          if (exhaustedModels.has(modelName)) continue;
          try {
            console.log(`[Enricher] Attempting generation with model: ${modelName} (key ${currentKeyIdx + 1}/${keys.length})`);
            responseText = await generateFn({ prompt, modelName, apiKey: keys[currentKeyIdx] });
            console.log(`[Enricher] Model ${modelName} succeeded.`);
            break; // Success! Break out of model loop
          } catch (err: any) {
            console.warn(`[Enricher] Warning: Failed with model ${modelName} - ${err.message}`);
            lastError = err;
            if (isAuthOrQuotaError(err)) {
              console.warn(`[Enricher] ${modelName} is unavailable (quota/auth/not-found) on key ${currentKeyIdx + 1} -- skipping it for the rest of this key.`);
              exhaustedModels.add(modelName);
            }
          }
        }

        if (responseText !== null) break;
        // Every model on this key is exhausted -- rotate to the next key if any.
        if (currentKeyIdx < keys.length - 1) {
          currentKeyIdx++;
          exhaustedModels.clear();
          console.warn(`[Enricher] All models exhausted on the previous key -- rotating to key ${currentKeyIdx + 1}/${keys.length}.`);
          continue;
        }
        // No keys left with any working model.
        allExhausted = true;
        break;
      }

      if (responseText === null) {
        throw new Error(`All available Gemini models failed across all keys for batch enrichment. Last error: ${lastError?.message}`);
      }

      const enrichedEntries = cleanAndParseArtistBatch(responseText);

      // Apply the enriched metadata back to our database
      for (const entry of enrichedEntries) {
        if (!entry.name) continue;
        
        const index = approvedArtists.findIndex(a => a.name.toLowerCase() === entry.name.toLowerCase());
        if (index !== -1) {
          approvedArtists[index] = {
            ...approvedArtists[index],
            website: entry.website || approvedArtists[index].website || null,
            socials: {
              spotify: entry.socials?.spotify || approvedArtists[index].socials?.spotify || null,
              instagram: entry.socials?.instagram || approvedArtists[index].socials?.instagram || null,
              facebook: entry.socials?.facebook || approvedArtists[index].socials?.facebook || null,
              youtube: entry.socials?.youtube || approvedArtists[index].socials?.youtube || null,
              telegram: entry.socials?.telegram || approvedArtists[index].socials?.telegram || null,
              vk: entry.socials?.vk || approvedArtists[index].socials?.vk || null
            }
          };
          console.log(`[Enricher] Enriched metadata for: ${entry.name}`);
        } else {
          // If for some reason they weren't in the list, add them now
          approvedArtists.push({
            name: entry.name,
            website: entry.website || null,
            socials: entry.socials || {}
          });
          console.log(`[Enricher] Added and enriched metadata for new artist: ${entry.name}`);
        }
      }
    } catch (err: any) {
      console.error(`[Enricher] Failed to process batch: ${err.message}`);
    }

    // Save after every batch, not just at the end -- a run that gets cancelled,
    // times out, or hits the all-models-exhausted early-exit above would otherwise
    // lose every batch's work done so far. Same reasoning as the early-exit itself:
    // observed live on a run where quota ran out partway through a large batch list.
    try {
      approvedArtists.sort((a, b) => a.name.localeCompare(b.name));
      await fs.writeFile(approvedArtistsPath, JSON.stringify(approvedArtists, null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`[Enricher] Failed to save enriched database after batch: ${err.message}`);
    }
  }

  console.log(`[Enricher] Saved enriched artist whitelist database to: ${approvedArtistsPath}`);
}
