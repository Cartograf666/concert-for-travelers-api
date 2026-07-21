import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { slugify } from '../pipeline/process.js';
import { ArtistEntry } from '../schemas/artist.js';

export function computeSimilarInboundCounts(artists: ArtistEntry[]): Map<string, number> {
  const inbound = new Map<string, number>();
  for (const artist of artists) {
    for (const similar of artist.similarArtists ?? []) {
      if (!similar.slug) continue;
      inbound.set(similar.slug, (inbound.get(similar.slug) ?? 0) + 1);
    }
  }
  return inbound;
}

export function applySimilarInboundCounts(artists: ArtistEntry[]): number {
  const inbound = computeSimilarInboundCounts(artists);
  let changed = 0;
  for (const artist of artists) {
    const count = inbound.get(slugify(artist.name)) ?? 0;
    if (artist.similarInboundCount !== count) {
      artist.similarInboundCount = count;
      changed++;
    }
  }
  return changed;
}

async function main() {
  const artists = (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
  const changed = applySimilarInboundCounts(artists);
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
  console.log(`[SimilarInbound] Updated similarInboundCount for ${changed}/${artists.length} artist(s).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[SimilarInbound] Fatal: ${err.message}`);
    process.exit(1);
  });
}
