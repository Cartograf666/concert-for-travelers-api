import type { RawConcert } from '../schemas/concert.js';

/** Old Mozarteum cards supplied only day/month and a blanket composer fallback.
 * The native programme extractor supplies a full date and internal event URL.
 * Reject legacy shapes before general date parsing can guess their year; this
 * is provenance validation, never an approval/artist-matching bypass. */
export function mozarteumProvenanceDropReason(raw: RawConcert): 'badDate' | 'notApproved' | undefined {
  if (!['mozarteum.at', 'www.mozarteum.at'].includes(raw.originalSource?.trim().toLowerCase() || '')) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) return 'badDate';
  const date = new Date(`${raw.date}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10) !== raw.date) return 'badDate';
  try {
    const url = new URL(raw.sourceEventUrl || '');
    if (url.protocol !== 'https:' || !['mozarteum.at','www.mozarteum.at'].includes(url.hostname) ||
        url.port || url.username || url.password || url.search || url.hash ||
        !/^\/(?:en\/)?events\/[^/]+\/?$/.test(url.pathname)) return 'notApproved';
  } catch { return 'notApproved'; }
}
