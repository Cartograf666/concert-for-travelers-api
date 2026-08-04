/**
 * Compares links we collected against an independent, human-curated source
 * (Wikidata) to answer the one question the network layer cannot: not "does
 * this URL respond?" but "is this the RIGHT artist's URL?".
 *
 * Why this layer matters more than it looks: enrich.ts asks a model to recall an
 * artist's website from memory, and a live-but-wrong link is indistinguishable
 * from a live-and-correct one to any reachability check -- a hallucinated domain
 * that happens to be somebody's parked page returns a cheerful 200. Wikidata's
 * P856/P1902/P2003/P2013/P2397/P3185/P3789 are edited by people and cite
 * sources, so agreement is real evidence of correctness and disagreement is real
 * evidence of a defect. It costs one batched SPARQL query per 80 artists, no
 * per-link fetching, and no LLM.
 *
 * It is deliberately incapable of deleting anything. A conflict is written to a
 * report for adjudication -- Wikidata is not infallible (stale links, the wrong
 * entity behind a shared name), and a source that is right 95% of the time must
 * not be wired directly to a destructive action. That is the mistake the
 * verification sweep already made once.
 */

export type LinkVerdict = 'confirmed' | 'conflict' | 'unknown';

export interface FieldComparison {
  field: string;
  ours: string;
  theirs: string | null;
  verdict: LinkVerdict;
}

/** Registrable-ish host: protocol, `www.` and a trailing slash carry no identity. */
function hostKey(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return null; }
}

/** Last meaningful path segment -- the handle in a social URL. */
function handleKey(url: string): string | null {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return null;
    // /channel/UC..., /artist/<id>, /user/<name> -> take the identifier, not the noun.
    const last = segs[segs.length - 1];
    return decodeURIComponent(last).toLowerCase().replace(/^@/, '');
  } catch { return null; }
}

/**
 * Per-field identity. Websites compare by host (an artist's site is the domain,
 * not the path we happened to land on); social links compare by handle, since
 * the same profile is reachable through several URL shapes.
 */
function identity(field: string, url: string): string | null {
  if (field === 'website' || field === 'tourUrl') return hostKey(url);
  return handleKey(url);
}

/**
 * YouTube is the one field where disagreement is usually NOT a defect: Wikidata
 * stores an opaque channel id (UC...), while enrichment tends to store the
 * human-facing /user/ or /@handle form. Those are the same channel under two
 * names and cannot be reconciled without an API call, so a mismatch between the
 * two shapes is reported as unknown rather than as a conflict.
 */
function isYoutubeShapeMismatch(ours: string, theirs: string): boolean {
  const a = handleKey(ours) ?? '';
  const b = handleKey(theirs) ?? '';
  const isChannelId = (s: string) => /^uc[0-9a-z_-]{20,}$/i.test(s);
  return isChannelId(a) !== isChannelId(b);
}

export function compareLink(field: string, ours: string | null | undefined, theirs: string | null | undefined): LinkVerdict {
  if (!ours) return 'unknown';
  if (!theirs) return 'unknown';
  if (field === 'youtube' && isYoutubeShapeMismatch(ours, theirs)) return 'unknown';
  const a = identity(field, ours);
  const b = identity(field, theirs);
  if (!a || !b) return 'unknown';
  return a === b ? 'confirmed' : 'conflict';
}

export interface GroundTruthLinks {
  website?: string | null;
  socials?: Record<string, string | null | undefined>;
}

export const COMPARABLE_FIELDS = ['website', 'spotify', 'instagram', 'facebook', 'youtube', 'vk', 'telegram'] as const;

/** Compares every comparable field of one artist against the curated source. */
export function compareEntry(ours: GroundTruthLinks, theirs: GroundTruthLinks): FieldComparison[] {
  const out: FieldComparison[] = [];
  for (const field of COMPARABLE_FIELDS) {
    const mine = field === 'website' ? ours.website : ours.socials?.[field];
    const yours = field === 'website' ? theirs.website : theirs.socials?.[field];
    if (!mine) continue; // nothing of ours to judge
    out.push({ field, ours: mine, theirs: yours ?? null, verdict: compareLink(field, mine, yours) });
  }
  return out;
}
