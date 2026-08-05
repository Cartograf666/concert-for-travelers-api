/**
 * Writing-system helpers for the published output.
 *
 * The feed serves readers of English and Russian; its sources serve everyone. The
 * artist DB carries Wikidata altLabels in every script a label exists in (Han,
 * kana, Hangul, Arabic, Hebrew, Thai, Greek, Devanagari, Georgian, Armenian), and
 * Bandsintown returns a venue's own locale often enough that bandsintown.ts has to
 * map "日本" to JP. None of that is wrong data; it is simply unreadable to the
 * audience the published feed is for.
 *
 * So the rule is a PUBLISH-time filter, never a delete: `data/artists/` keeps
 * every script, because the matcher needs 東京事変 to recognise that artist on a
 * Japanese listing page -- which is precisely the concert Bandsintown was added
 * to reach. Only what leaves the building is narrowed.
 */

/**
 * Scripts the published feed's readers can actually read. Latin and Cyrillic
 * both pass: "Аквариум" and "Мумий Тролль" are exactly as useful to this
 * audience as "Radiohead", and filtering them out to leave a single-script feed
 * would silently drop the Russian-language half of the catalog.
 */
const READABLE_SCRIPT = /\p{Script=Latin}|\p{Script=Cyrillic}/u;
/** Any letter that is neither Latin nor Cyrillic. */
const UNREADABLE_LETTER = /[^\P{L}\p{Script=Latin}\p{Script=Cyrillic}]/u;

/**
 * True when a string carries no script outside Latin and Cyrillic.
 *
 * The test is the ABSENCE of a foreign script, not the presence of a familiar
 * letter. Requiring one looks tighter and is wrong: "!!!" and "65daysofstatic"
 * are real acts, and a letterless name reads fine either way. Judging whether a
 * string is a plausible name is artist_integrity.ts's job, not this one's.
 *
 * Combining marks are allowed so decomposed forms ("Bjo" + combining diaeresis)
 * are not misread as foreign, and symbols pass because band names genuinely
 * contain them ("†", "∆").
 */
export function isReadableScript(s: string): boolean {
  if (!s) return false;
  return !UNREADABLE_LETTER.test(s);
}

/** True when a string contains letters from a script the feed's readers cannot read. */
export function hasUnreadableScript(s: string): boolean {
  return UNREADABLE_LETTER.test(s);
}

/**
 * Picks the best readable spelling from a set of variants for the same thing, or
 * null when every variant is unreadable.
 *
 * Latin is preferred over Cyrillic when both exist, because the feed's primary
 * language is English and "Tokyo" travels further than "Токио" -- but a Cyrillic
 * variant still beats returning nothing.
 *
 * `preferShorter` matters for city names: sources spell one place as "Tokyo",
 * "Tokyo, Japan" and "Tokyo Metropolis", and the bare name is what a UI wants.
 * Callers that want stable ordering rather than brevity pass false.
 */
export function pickReadable(variants: string[], preferShorter = true): string | null {
  const readable = variants.filter(isReadableScript);
  if (readable.length === 0) return null;
  const isLatin = (s: string) => /\p{Script=Latin}/u.test(s);
  return readable.sort((a, b) => {
    const aLatin = isLatin(a);
    const bLatin = isLatin(b);
    if (aLatin !== bLatin) return aLatin ? -1 : 1;
    if (preferShorter && a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0];
}

/** Kept for readability at call sites that only care about the primary language. */
export function isLatinScript(s: string): boolean {
  return isReadableScript(s) && !/\p{Script=Cyrillic}/u.test(s) && READABLE_SCRIPT.test(s);
}
