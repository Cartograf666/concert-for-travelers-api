/**
 * Collects all configured Google/Gemini API keys, in priority order, so the model
 * cascades (enrichment, self-heal) can rotate to a fresh key once every model on the
 * current one is quota-exhausted. Free-tier daily quotas are small and per-key, so a
 * big run can burn through one key's whole model list; a second/third key multiplies
 * the daily budget with zero code change beyond adding the secret.
 *
 * Sources (deduped, blanks dropped, order preserved):
 *   - GEMINI_API_KEY (primary)
 *   - GEMINI_API_KEY_2 .. _10  and  GEMINI_API_KEY_RESERV1 .. RESERV10 (reserves)
 *   - GEMINI_API_KEYS: a single comma/space/newline-separated list (convenient for
 *     stuffing several keys into one secret)
 */
export function getGeminiKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys: string[] = [];

  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  // Reserve/numbered keys, tried after the primary. Both naming schemes supported
  // (_2/_3... and _RESERV1/_RESERV2...) so it doesn't matter which the secrets use.
  for (let i = 1; i <= 10; i++) {
    if (i >= 2 && env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]!);
    if (env[`GEMINI_API_KEY_RESERV${i}`]) keys.push(env[`GEMINI_API_KEY_RESERV${i}`]!);
  }
  // Bulk list in a single var.
  if (env.GEMINI_API_KEYS) {
    for (const part of env.GEMINI_API_KEYS.split(/[,\s]+/)) {
      if (part) keys.push(part);
    }
  }

  // Dedupe (a key set in two places shouldn't be tried twice) while keeping order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const k of keys) {
    const trimmed = k.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      unique.push(trimmed);
    }
  }
  return unique;
}
