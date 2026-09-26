import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ScrapeCache } from './cache.js';
import { ScraperConfigSchema } from '../schemas/config.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validConfigId(value: unknown): string | null {
  const parsed = ScraperConfigSchema.shape.id.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Returns the read-only artist cache view consumed by the daily publish.
 * Cache records remain on disk for last-good fallback, but records whose
 * configs were deliberately removed no longer enter the published event set.
 */
export async function filterArtistCacheForActiveConfigs(
  cache: ScrapeCache,
  configsDir: string
): Promise<ScrapeCache> {
  let files: string[];
  try {
    files = await fs.readdir(configsDir);
  } catch (error) {
    throw new Error(`Failed to list active artist scraper configs at ${configsDir}: ${errorMessage(error)}`);
  }

  const activeIds = new Set<string>();
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const filePath = path.join(configsDir, file);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      // A filesystem failure is not evidence that a config was deleted. Fail the
      // run rather than publishing a silently truncated artist-cache view.
      throw new Error(`Failed to read artist scraper config ${file}: ${errorMessage(error)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const fallbackId = validConfigId(path.basename(file, '.json'));
      if (fallbackId) {
        // Keep last-good data when a tracked config is temporarily malformed.
        // The filename is safe only because it passes the same ID schema.
        console.warn(`[ArtistCache] Invalid JSON in ${file}; retaining cached ${fallbackId} by filename until the config is repaired.`);
        activeIds.add(fallbackId);
      } else {
        console.warn(`[ArtistCache] Invalid JSON in ${file} and no safe filename ID; no artist cache entry can be matched.`);
      }
      continue;
    }

    const configId = validConfigId(
      parsed && typeof parsed === 'object' && 'id' in parsed
        ? (parsed as { id?: unknown }).id
        : undefined
    );
    if (configId) {
      // Membership follows the config's real ID, not its filename. This keeps a
      // valid renamed config and avoids retaining an obsolete filename-keyed row.
      activeIds.add(configId);
      continue;
    }

    const fallbackId = validConfigId(path.basename(file, '.json'));
    if (fallbackId) {
      console.warn(`[ArtistCache] ${file} has no usable config.id; retaining cached ${fallbackId} by filename until the config is repaired.`);
      activeIds.add(fallbackId);
    } else {
      console.warn(`[ArtistCache] ${file} has no usable config.id or safe filename ID; no artist cache entry can be matched.`);
    }
  }

  return Object.fromEntries(
    Object.entries(cache).filter(([configId]) => activeIds.has(configId))
  );
}
