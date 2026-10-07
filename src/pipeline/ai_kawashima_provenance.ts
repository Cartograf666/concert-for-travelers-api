import type { Concert } from '../schemas/concert.js';

const AI_KAWASHIMA_MBID = '6d7ef4a5-26c9-45e7-ad19-24ec48c50ed4';
// Captured official-index cache used a headline as venue and a prefecture as city.
// Official event details identify venues in Sakura and Tokai. Keep old fallback
// rows quarantined without changing the source cache or rejecting corrected rows.
const LEGACY_INVALID_ROWS = [
  ['2026-11-15', '千葉', '「ベトナムフェスタ in 神奈川2026」詳細情報公開！'],
  ['2026-10-31', '愛知', '食べて・遊べる！太田川オータムフェスタ2026']
] as const;

export function isInvalidLegacyAiKawashimaEvent(
  raw: Partial<Concert>, normalizedDate: string, matchedMbid?: string | null
): boolean {
  if (matchedMbid !== AI_KAWASHIMA_MBID || raw.country?.trim().toUpperCase() !== 'JP' ||
      !['kawashimaai.com', 'www.kawashimaai.com'].includes(raw.originalSource?.trim().toLowerCase() || '')) return false;
  return LEGACY_INVALID_ROWS.some(([date, prefecture, headline]) =>
    normalizedDate === date && raw.city?.trim() === prefecture && raw.venue?.trim() === headline);
}
