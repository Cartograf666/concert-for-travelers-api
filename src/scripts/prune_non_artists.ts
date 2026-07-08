import * as fs from 'fs/promises';
import * as path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

interface ArtistEntry {
  name: string;
  artistCheckedAt?: string;
  [key: string]: any;
}

interface ClassificationResult {
  name: string;
  isArtist: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const CURATED_REGIONS = new Set([
  // US States
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia',
  'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  // US State 2-letter codes
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md',
  'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
  'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
  
  // US Territories
  'puerto rico', 'guam', 'american samoa', 'u.s. virgin islands', 'us virgin islands', 'northern mariana islands',
  'pr', 'gu', 'as', 'vi', 'mp',
  
  // Canadian Provinces / Territories
  'alberta', 'british columbia', 'manitoba', 'new brunswick', 'newfoundland and labrador', 'nova scotia', 'ontario', 'prince edward island', 'quebec', 'saskatchewan',
  'northwest territories', 'nunavut', 'yukon',
  'ab', 'bc', 'mb', 'nb', 'nl', 'ns', 'on', 'pe', 'qc', 'sk', 'nt', 'nu', 'yt',
  
  // Australian States / Territories
  'new south wales', 'queensland', 'south australia', 'tasmania', 'victoria', 'western australia', 'australian capital territory', 'northern territory',
  'nsw', 'qld', 'sa', 'tas', 'vic', 'wa', 'act', 'nt',
  
  // UK constituent countries
  'england', 'scotland', 'wales', 'northern ireland',
  
  // Major world cities / prefecture / country forms for City, Country/Prefecture
  'tokyo', 'tokyo prefecture', 'osaka', 'osaka prefecture', 'kyoto', 'kyoto prefecture', 'hokkaido', 'kanagawa', 'aichi', 'saitama', 'chiba',
  'london', 'paris', 'berlin', 'new york city', 'rome', 'madrid', 'beijing', 'seoul', 'singapore', 'sydney', 'melbourne', 'toronto', 'vancouver', 'montreal',
  'japan', 'france', 'germany', 'italy', 'spain', 'united kingdom', 'uk', 'u.k.', 'canada', 'australia', 'usa', 'u.s.a.', 'united states'
]);

const INSTITUTION_KEYWORDS = [
  'Empire', 'Kingdom', 'Dynasty', 'Republic', 'University', 'Hospital', 'Medical Center',
  'Cathedral', 'Museum', 'Airport', 'County', 'Prison', 'Cemetery', 'Battle of', 'War of', 'Province'
];

const KEYWORD_REGEXES = INSTITUTION_KEYWORDS.map(kw => new RegExp(`\\b${kw}\\b`, 'i'));

function isSuspiciousName(name: string | undefined): boolean {
  if (!name || typeof name !== 'string') return false;
  
  // 1. Place-name suffix check
  const lastCommaIdx = name.lastIndexOf(',');
  if (lastCommaIdx !== -1) {
    const suffix = name.slice(lastCommaIdx + 1).trim().toLowerCase();
    if (CURATED_REGIONS.has(suffix)) {
      return true;
    }
  }
  
  // 2. Institution/entity keywords check
  for (const regex of KEYWORD_REGEXES) {
    if (regex.test(name)) {
      return true;
    }
  }
  
  return false;
}

async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
}

async function saveDb(artists: ArtistEntry[]): Promise<void> {
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
}

function cleanAndParseJson(text: string): any {
  let cleaned = text.trim();
  // Try extracting from a markdown code block first
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  } else {
    // If not in a code block, try to find the outer-most curly braces
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1).trim();
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Failed to parse LLM response as JSON. Content: "${text}". Error: ${err.message}`);
  }
}

async function getApiKey(): Promise<string> {
  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    try {
      const dotenvContent = await fs.readFile(path.join(process.cwd(), '.env'), 'utf-8');
      const match = dotenvContent.match(/^GEMINI_API_KEY\s*=\s*["']?(.*?)["']?$/m);
      if (match) apiKey = match[1].trim();
    } catch {}
  }
  if (!apiKey) {
    try {
      const dotenvContent = await fs.readFile(path.join(process.env.HOME || '', '.env'), 'utf-8');
      const match = dotenvContent.match(/^GEMINI_API_KEY\s*=\s*["']?(.*?)["']?$/m);
      if (match) apiKey = match[1].trim();
    } catch {}
  }
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set and could not be loaded from .env.');
  }
  return apiKey;
}

async function appendToJsonArrayFile(filePath: string, newItems: any[]): Promise<void> {
  if (newItems.length === 0) return;
  let items: any[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    items = JSON.parse(content);
    if (!Array.isArray(items)) {
      items = [];
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: failed to read ${filePath}: ${err.message}. Initializing new array.`);
    }
  }
  items.push(...newItems);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(items, null, 2), 'utf-8');
}

async function selectCandidates(n: number, outFile: string): Promise<void> {
  const artists = await loadDb();
  const candidates: string[] = [];
  
  for (const a of artists) {
    if (a.artistCheckedAt) continue;
    if (isSuspiciousName(a.name)) {
      candidates.push(a.name);
      if (candidates.length >= n) {
        break;
      }
    }
  }
  
  await fs.writeFile(outFile, JSON.stringify(candidates, null, 2), 'utf-8');
  console.log(`[prune-non-artists] Selected ${candidates.length} candidates and wrote to ${outFile}`);
}

async function classify(candidatesFile: string, resultsFile: string, batchSize: number, delayMs: number): Promise<void> {
  const apiKey = await getApiKey();
  const content = await fs.readFile(candidatesFile, 'utf-8');
  const candidates: string[] = JSON.parse(content);
  
  if (!Array.isArray(candidates)) {
    throw new Error('Candidates file must contain a JSON array of strings');
  }
  
  if (candidates.length === 0) {
    console.log('[prune-non-artists] Candidates array is empty.');
    await fs.writeFile(resultsFile, JSON.stringify([], null, 2), 'utf-8');
    return;
  }
  
  console.log(`[prune-non-artists] Classifying ${candidates.length} candidates in batches of ${batchSize} (delay ${delayMs}ms)...`);
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const results: ClassificationResult[] = [];
  
  const modelsToTry = [
    { name: 'gemini-2.5-flash', tool: { googleSearch: {} } },
    { name: 'gemini-2.5-pro', tool: { googleSearch: {} } },
    { name: 'gemini-3.5-flash', tool: { googleSearch: {} } }
  ];
  
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    console.log(`[prune-non-artists] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(candidates.length / batchSize)}: ${batch.join(', ')}...`);
    
    const prompt = `Is each of these a real musical artist — a solo musician, band, DJ, composer, orchestra, or similar act that performs/has performed/records music? Or is it something else (a place, institution, historical period/entity, a person who isn't a musician, a disambiguation artifact, etc)? Search to confirm before answering. Note some names are in "Surname, Given" order (Wikipedia article-title convention) and ARE real musicians (e.g. "Hahn, Hilary" is violinist Hilary Hahn) — check thoroughly before concluding someone isn't an artist just because of unusual name order.

Candidate names to process:
${JSON.stringify(batch, null, 2)}

Respond with a JSON object with a single key "results" containing an array of objects for each name, in the exact order requested:
{
  "results": [
    {
      "name": "Exact candidate name from the input",
      "isArtist": true | false,
      "confidence": "high" | "medium" | "low",
      "reason": "one sentence, citing what you found (or didn't) when you searched to confirm"
    }
  ]
}

Use "high" confidence only when you found clear, verifiable evidence either way. Be extremely truthful. Never invent facts or URLs.`;

    let success = false;
    let lastError: any = null;
    
    for (const modelConfig of modelsToTry) {
      const modelName = modelConfig.name;
      try {
        console.log(`[prune-non-artists] Attempting generation with model: ${modelName}`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: [modelConfig.tool as any],
        });
        
        let attempt = 0;
        let batchSuccess = false;
        while (attempt < 3 && !batchSuccess) {
          try {
            const response = await model.generateContent({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            
            const text = response.response.text();
            const parsed = cleanAndParseJson(text);
            
            if (parsed && Array.isArray(parsed.results)) {
              results.push(...parsed.results);
              console.log(`[prune-non-artists] Successfully processed batch using ${modelName}.`);
              success = true;
              batchSuccess = true;
              break; // Success!
            } else {
              console.error(`[prune-non-artists] Invalid format returned for batch:`, text);
              break; // Don't retry parsing issues
            }
          } catch (err: any) {
            const errStr = err.message || '';
            const isRateLimit = errStr.includes('429') || errStr.includes('Quota exceeded') || errStr.includes('Too Many Requests');
            if (isRateLimit && attempt < 2) {
              attempt++;
              let waitTime = 15000 * attempt;
              // Try to parse "Please retry in X.Y s"
              const match = errStr.match(/Please retry in (\d+(?:\.\d+)?)\s*s/i);
              if (match) {
                const seconds = parseFloat(match[1]);
                waitTime = Math.ceil(seconds * 1000) + 1500; // wait extra 1.5s to be safe
              }
              console.warn(`[prune-non-artists] Model ${modelName} hit 429 quota. Waiting ${waitTime / 1000}s to retry (attempt ${attempt}/3)...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
              console.warn(`[prune-non-artists] Model ${modelName} failed: ${err.message}`);
              lastError = err;
              break;
            }
          }
        }
        if (batchSuccess) break;
      } catch (err: any) {
        console.warn(`[prune-non-artists] Model ${modelName} setup failed: ${err.message}`);
        lastError = err;
      }
    }
    
    if (!success) {
      throw new Error(`Failed to process batch after trying all models. Last error: ${lastError?.message}`);
    }
    
    if (i + batchSize < candidates.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  
  await fs.mkdir(path.dirname(resultsFile), { recursive: true });
  await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`[prune-non-artists] Done! Wrote ${results.length} results to ${resultsFile}`);
}

async function apply(resultsFile: string): Promise<void> {
  const artists = await loadDb();
  const results: ClassificationResult[] = JSON.parse(await fs.readFile(resultsFile, 'utf-8'));
  
  const byName = new Map<string, number>();
  artists.forEach((a, i) => byName.set(a.name.toLowerCase(), i));
  
  const now = new Date().toISOString();
  
  let processed = 0;
  let removedCount = 0;
  let flaggedCount = 0;
  const unmatched: string[] = [];
  
  const removedEntries: any[] = [];
  const flaggedEntries: any[] = [];
  const indicesToRemove = new Set<number>();
  
  for (const r of results) {
    if (!r || !r.name) continue;
    
    const idx = byName.get(r.name.toLowerCase());
    if (idx === undefined) {
      unmatched.push(r.name);
      continue;
    }
    
    processed++;
    const entry = artists[idx];
    entry.artistCheckedAt = now;
    
    if (r.isArtist === false) {
      if (r.confidence === 'high') {
        removedEntries.push({ ...entry });
        indicesToRemove.add(idx);
        removedCount++;
      } else {
        flaggedEntries.push({
          name: r.name,
          reason: r.reason,
          confidence: r.confidence,
          flaggedAt: now
        });
        flaggedCount++;
      }
    }
  }
  
  const removedFilePath = path.join(process.cwd(), 'data', 'removed-non-artists.json');
  const reviewFilePath = path.join(process.cwd(), 'data', 'artist-review-needed.json');
  
  await appendToJsonArrayFile(removedFilePath, removedEntries);
  await appendToJsonArrayFile(reviewFilePath, flaggedEntries);
  
  const updatedArtists = artists.filter((_, idx) => !indicesToRemove.has(idx));
  await saveDb(updatedArtists);
  
  console.log(`[prune-non-artists] apply complete:`);
  console.log(`  candidates processed    : ${processed}`);
  console.log(`  marked checked          : ${processed}`);
  console.log(`  removed (high-conf)     : ${removedCount}`);
  console.log(`  flagged (med/low-conf)  : ${flaggedCount}`);
  if (unmatched.length) {
    console.log(`  unmatched (not in DB)   : ${unmatched.length} -> ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '…' : ''}`);
  }
}

async function stats(): Promise<void> {
  const artists = await loadDb();
  const total = artists.length;
  const checked = artists.filter(a => a.artistCheckedAt).length;
  
  let candidatesRemaining = 0;
  for (const a of artists) {
    if (!a.artistCheckedAt && isSuspiciousName(a.name)) {
      candidatesRemaining++;
    }
  }
  
  let removedSoFar = 0;
  try {
    const content = await fs.readFile(path.join(process.cwd(), 'data', 'removed-non-artists.json'), 'utf-8');
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) {
      removedSoFar = arr.length;
    }
  } catch {}
  
  let flaggedForReview = 0;
  try {
    const content = await fs.readFile(path.join(process.cwd(), 'data', 'artist-review-needed.json'), 'utf-8');
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) {
      flaggedForReview = arr.length;
    }
  } catch {}
  
  console.log(`[prune-non-artists] stats:`);
  console.log(`  Total artists in DB     : ${total}`);
  console.log(`  Checked (artistCheckedAt) : ${checked}`);
  console.log(`  Candidates remaining    : ${candidatesRemaining}`);
  console.log(`  Removed so far          : ${removedSoFar}`);
  console.log(`  Flagged for review      : ${flaggedForReview}`);
}

async function main() {
  const [mode, arg1, arg2, arg3, arg4] = process.argv.slice(2);
  switch (mode) {
    case 'candidates':
      if (!arg1 || !arg2) {
        throw new Error('candidates mode requires <N> and <outFile>');
      }
      await selectCandidates(parseInt(arg1, 10), arg2);
      break;
    case 'classify':
      if (!arg1 || !arg2) {
        throw new Error('classify mode requires <candidatesFile> and <resultsFile>');
      }
      await classify(arg1, arg2, parseInt(arg3 || '15', 10), parseInt(arg4 || '4000', 10));
      break;
    case 'apply':
      if (!arg1) {
        throw new Error('apply mode requires <resultsFile>');
      }
      await apply(arg1);
      break;
    case 'stats':
      await stats();
      break;
    default:
      console.error('Usage: prune_non_artists.ts <candidates <N> <outFile> | classify <candidatesFile> <resultsFile> [batchSize] [delayMs] | apply <resultsFile> | stats>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[prune-non-artists] Fatal: ${err.message}`);
  process.exit(1);
});
