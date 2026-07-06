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

/**
 * Batches and queries Gemini to enrich missing artist metadata.
 */
export async function enrichMissingArtistMetadata(
  artistsToEnrich: string[],
  approvedArtistsPath: string,
  apiKey: string
): Promise<void> {
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
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  for (let i = 0; i < missingArtists.length; i += batchSize) {
    const batch = missingArtists.slice(i, i + batchSize);
    console.log(`[Enricher] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missingArtists.length / batchSize)}: ${batch.join(', ')}`);

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
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
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
              spotify: entry.socials?.spotify || null,
              instagram: entry.socials?.instagram || null,
              facebook: entry.socials?.facebook || null,
              youtube: entry.socials?.youtube || null,
              telegram: entry.socials?.telegram || null,
              vk: entry.socials?.vk || null
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
  }

  // 3. Save the updated list back to disk
  try {
    approvedArtists.sort((a, b) => a.name.localeCompare(b.name));
    await fs.writeFile(approvedArtistsPath, JSON.stringify(approvedArtists, null, 2), 'utf-8');
    console.log(`[Enricher] Saved enriched artist whitelist database to: ${approvedArtistsPath}`);
  } catch (err: any) {
    console.error(`[Enricher] Failed to save enriched database: ${err.message}`);
  }
}
