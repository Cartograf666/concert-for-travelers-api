import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  const approvedArtistsPath = path.join(process.cwd(), 'data', 'approved_artists.json');
  console.log('[Cleaner] Loading approved artists list...');

  const data = await fs.readFile(approvedArtistsPath, 'utf-8');
  const artists = JSON.parse(data);

  console.log(`[Cleaner] Original count: ${artists.length}`);

  const cleanedMap = new Map<string, { name: string; website: string | null; socials?: any }>();

  // Whitelisted seeds to always preserve
  const preserve = new Set([
    "the cure", "rammstein", "metallica", "coldplay", "radiohead",
    "billie eilish", "taylor swift", "daft punk", "depeche mode", "nirvana",
    "system of a down", "linkin park", "massive attack", "portishead",
    "aphex twin", "kraftwerk", "moderat"
  ]);

  for (const entry of artists) {
    const name = entry.name.trim();
    const lowerName = name.toLowerCase();

    // 1. Filter out names starting with weird punctuation
    // Must start with a letter, number, or Russian letter, OR be in our preserve set
    const startsWithValid = /^[a-zA-Z0-9\u0400-\u04FF]/i.test(name);
    if (!startsWithValid && !preserve.has(lowerName)) {
      continue;
    }

    // 2. Filter out names containing Wikipedia tags or HTML noise
    if (
      name.includes('wiki/') || 
      name.includes('http') || 
      name.includes('Category:') ||
      name.includes('[') ||
      name.includes(']')
    ) {
      continue;
    }

    // 3. Deduplicate case-insensitively
    if (cleanedMap.has(lowerName)) {
      const existing = cleanedMap.get(lowerName)!;
      // Prefer the version with more capital letters (usually indicates better casing)
      const existingCaps = (existing.name.match(/[A-Z]/g) || []).length;
      const currentCaps = (name.match(/[A-Z]/g) || []).length;
      
      const website = entry.website || existing.website;
      const socials = entry.socials || existing.socials;

      if (currentCaps > existingCaps) {
        cleanedMap.set(lowerName, { name, website, socials });
      } else {
        cleanedMap.set(lowerName, { name: existing.name, website, socials });
      }
    } else {
      cleanedMap.set(lowerName, {
        name,
        website: entry.website,
        socials: entry.socials
      });
    }
  }

  const cleanedList = Array.from(cleanedMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  
  await fs.writeFile(approvedArtistsPath, JSON.stringify(cleanedList, null, 2), 'utf-8');
  console.log(`[Cleaner] Cleanup complete. Cleaned count: ${cleanedList.length}`);
}

main();
