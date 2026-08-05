/**
 * Writing-system helpers for the published output.
 *
 * The API serves an English-language consumer app, but its sources do not: the
 * artist DB carries Wikidata altLabels in every script a label exists in (30,098
 * of 110,794 aliases are non-Latin -- Han, kana, Hangul, Arabic, Hebrew, Thai,
 * Greek, Devanagari, Georgian, Armenian), and Bandsintown returns a venue's own
 * locale often enough that bandsintown.ts has to map "日本" to JP. None of that is
 * wrong data; it is simply unreadable to the audience the published feed is for.
 *
 * So the rule is a PUBLISH-time filter, never a delete: `data/artists/` keeps
 * every script, because the matcher needs 東京事変 to recognise that artist on a
 * Japanese listing page -- which is precisely the concert Bandsintown was added
 * to reach. Only what leaves the building is narrowed.
 */

/**
 * True when a string is readable as English -- Latin letters, digits and
 * punctuation only.
 *
 * Combining marks are allowed so decomposed forms ("Bjo" + combining diaeresis)
 * are not misread as foreign; symbols and emoji are allowed because band names
 * genuinely contain them ("†", "∆", "!!!"). What this rejects is a string
 * carrying letters from a non-Latin script.
 */
export function isLatinReadable(s: string): boolean {
  if (!s) return false;
  // The test is the absence of a script the reader cannot read -- NOT the presence
  // of a Latin letter. Requiring one looks tighter and is wrong: "!!!", "65daysofstatic"
  // and "√Ö" are real acts, and a letterless name is perfectly readable in English.
  // Judging whether a string is a plausible name is a different job, done by the
  // integrity rules in artist_integrity.ts.
  return !/[^\P{L}\p{Script=Latin}]/u.test(s);
}

/** True when a string contains letters from a script other than Latin. */
export function hasNonLatinLetters(s: string): boolean {
  return /[^\P{L}\p{Script=Latin}]/u.test(s);
}

/**
 * Picks the best English-readable spelling from a set of variants for the same
 * thing, or null when every variant is non-Latin.
 *
 * `preferShorter` matters for city names: sources spell one place as "Tokyo",
 * "Tokyo, Japan" and "Tokyo Metropolis", and the bare name is what a UI wants.
 * For artist aliases the opposite is not true, so callers that want stable
 * ordering rather than brevity pass false.
 */
export function pickLatin(variants: string[], preferShorter = true): string | null {
  const latin = variants.filter(isLatinReadable);
  if (latin.length === 0) return null;
  return latin.sort((a, b) => {
    if (preferShorter && a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0];
}
