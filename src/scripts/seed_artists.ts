/**
 * The small set of "must always be present" seed artists, shared between
 * download_artists.ts (re-adds them if missing after a fresh download) and
 * clean_artists.ts (exempts them from the noisy-name filter) so there is one
 * place to add/remove a seed artist instead of two independently-edited lists.
 */
export const SEED_ARTISTS: string[] = [
  'The Cure', 'Rammstein', 'Metallica', 'Coldplay', 'Radiohead',
  'Billie Eilish', 'Taylor Swift', 'Daft Punk', 'Depeche Mode', 'Nirvana',
  'System of a Down', 'Linkin Park', 'Massive Attack', 'Portishead',
  'Aphex Twin', 'Kraftwerk', 'Moderat'
];

export const SEED_ARTIST_WEBSITES: Record<string, string> = {
  'the cure': 'https://www.thecure.com',
  'rammstein': 'https://www.rammstein.de',
  'metallica': 'https://www.metallica.com',
  'coldplay': 'https://www.coldplay.com',
  'radiohead': 'https://www.radiohead.com',
  'billie eilish': 'https://www.billieeilish.com',
  'taylor swift': 'https://www.taylorimages.com',
  'daft punk': 'https://www.daftpunk.com',
  'depeche mode': 'https://www.depechemode.com',
  'nirvana': 'https://www.nirvana.com',
  'system of a down': 'https://www.systemofadown.com',
  'linkin park': 'https://www.linkinpark.com',
  'massive attack': 'https://www.massiveattack.co.uk',
  'portishead': 'https://www.portishead.co.uk',
  'aphex twin': 'https://aphextwin.warp.net',
  'kraftwerk': 'https://www.kraftwerk.com',
  'moderat': 'https://www.moderat.fm'
};
