import { SEED_ARTISTS } from './seed_artists.js';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

async function main() {
  console.log('[Cleaner] Loading approved artists list...');

  const artists = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);

  console.log(`[Cleaner] Original count: ${artists.length}`);

  const cleanedMap = new Map<string, Record<string, any>>();

  // Whitelisted seeds to always preserve
  const preserve = new Set(SEED_ARTISTS.map((name) => name.toLowerCase()));

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

    // 3. Deduplicate case-insensitively, keeping every field (not just name/website/socials --
    // dropping enrichedAt/tourUrl/wdBulkTriedAt/etc here would un-mark the whole catalog as
    // pending and make every enrichment tier reprocess artists it already finished).
    //
    // Also fold in the Wikipedia disambiguation-suffix case ("Hacktivist" vs "Hacktivist
    // (band)"): the 2026-07 Wikipedia-list import (commit 9589d1e) added plenty of these
    // as separate entries. Key on the name with a trailing "(band|musician|singer|...)"
    // suffix stripped, so both variants land on the same dedup key and merge into one.
    const dedupSuffix = /\s*\((band|musician|singer|artist|rapper|duo|group)\)\s*$/i;
    const dedupKey = lowerName.replace(dedupSuffix, '');

    if (cleanedMap.has(dedupKey)) {
      const existing = cleanedMap.get(dedupKey)!;
      // Prefer whichever name has no disambiguation suffix; else more capital letters
      // (usually indicates better casing).
      const existingHasSuffix = dedupSuffix.test(existing.name);
      const currentHasSuffix = dedupSuffix.test(name);
      const existingCaps = (existing.name.match(/[A-Z]/g) || []).length;
      const currentCaps = (name.match(/[A-Z]/g) || []).length;
      const preferCurrentCasing = existingHasSuffix !== currentHasSuffix
        ? currentHasSuffix === false
        : currentCaps > existingCaps;

      cleanedMap.set(dedupKey, {
        ...existing,
        ...entry,
        name: preferCurrentCasing ? name : existing.name,
        website: entry.website || existing.website,
        tourUrl: entry.tourUrl || existing.tourUrl,
        socials: entry.socials || existing.socials,
        enrichedAt: entry.enrichedAt || existing.enrichedAt
      });
    } else {
      cleanedMap.set(dedupKey, { ...entry, name });
    }
  }

  const cleanedList = Array.from(cleanedMap.values());

  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, cleanedList);
  console.log(`[Cleaner] Cleanup complete. Cleaned count: ${cleanedList.length}`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
