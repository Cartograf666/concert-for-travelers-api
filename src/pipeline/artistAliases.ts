import type { ArtistEntry } from '../schemas/artist.js';

/** Normalize artist names for case- and punctuation-insensitive identity checks. */
export function normalizeArtistName(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Adds newly discovered aliases without duplicating an existing normalized name
 * or re-storing the artist's canonical name as an alias.
 */
export function mergeArtistAliases(entry: ArtistEntry, aliases: readonly string[]): boolean {
  const canonical = normalizeArtistName(entry.name);
  const existingAliases = entry.aliases ?? [];
  const merged = new Map<string, string>();

  for (const alias of existingAliases) {
    const normalized = normalizeArtistName(alias);
    if (normalized && normalized !== canonical) merged.set(normalized, alias.trim());
  }
  for (const alias of aliases) {
    const trimmed = alias.trim();
    const normalized = normalizeArtistName(trimmed);
    if (normalized && normalized !== canonical && !merged.has(normalized)) {
      merged.set(normalized, trimmed);
    }
  }

  const next = Array.from(merged.values());
  const changed = existingAliases.length !== next.length || existingAliases.some((alias, index) => alias !== next[index]);
  if (!changed) return false;
  if (next.length > 0) entry.aliases = next;
  else delete entry.aliases;
  return true;
}
