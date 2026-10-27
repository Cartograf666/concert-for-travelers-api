import type { Concert, RawConcert } from '../schemas/concert.js';
import { knownSourceEventIdentity } from './publication_quality.js';

// Independent native IDs, not a fabricated shared provider ID. The official
// page has one 19:00 session matching BIT's captured lineup/day/time/country.
// Proof, source URLs, capture times and hashes: king-radiant-identity-20261028/proof.json.
function verifiedKingRadiantOccurrence(raw: RawConcert, concert: Concert):
  { pairKey: string; dedupeCity: string; sourceRank: number } | undefined {
  if (concert.artist !== 'King Gizzard & the Lizard Wizard' ||
      concert.spotifyId !== '6XYvaoDGE0VmRt83Jss9Sn' ||
      raw.artist?.trim().toLowerCase() !== concert.artist.toLowerCase() ||
      raw.date !== '2027-06-09' || concert.date !== raw.date || concert.country !== 'FR') return;
  const eventUrl = raw.sourceEventUrl ?? raw.eventUrl;
  const native = raw.originalSource === 'radiant-bellevue.fr' &&
    concert.city === 'Caluire et Cuire' && concert.venue === 'Radiant-Bellevue' &&
    eventUrl === 'https://radiant-bellevue.fr/spectacles/king-gizzard-the-lizard-wizard/' &&
    raw.ticketUrl === 'https://billetterie.radiant-bellevue.fr/fr/meeting/1574/king_gizzard_the_lizard_wizard' &&
    (concert.startTime === undefined || concert.startTime === '19:00');
  const bitId = knownSourceEventIdentity('https://www.bandsintown.com/e/109083165');
  const peer = raw.originalSource === 'bandsintown.com' &&
    concert.city === 'Lyon 01' && concert.venue === 'Radiant - Bellevue' &&
    concert.startTime === '19:00' && knownSourceEventIdentity(eventUrl) === bitId &&
    (!raw.ticketUrl || knownSourceEventIdentity(raw.ticketUrl) === bitId);
  if (!native && !peer) return;
  return { pairKey: 'kinggizzard:radiant:meeting1574:bit109083165',
    dedupeCity: 'Caluire et Cuire', sourceRank: native ? 2 : 1 };
}

// Exact captured occurrences, not general venue/city aliases or source authority.
// Primary evidence and full peer records: tests/fixtures/normalization-integrity-20261011/occurrence-proof.json.
// Columns: artist, stable ID, date, country, native source/URL/city/venue, peer source/city/venue, winner.
const PAIRS = [
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2026-10-17", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Hokes Bluff", "The Bluff Amphitheater", "bandsintown.com", "Hokes Bluff", "The Bluff Amphitheater", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2026-10-30", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Nashville", "The Pinnacle", "bandsintown.com", "Nashville", "The Pinnacle", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2026-12-06", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Las Vegas", "Resorts World Theatre", "bandsintown.com", "Las Vegas", "Resorts World Theatre", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2026-12-10", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Las Vegas", "Resorts World Theatre", "bandsintown.com", "Las Vegas", "Resorts World Theatre", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-04-29", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Raleigh", "Walnut Creek Amphitheater", "bandsintown.com", "Raleigh", "Coastal Credit Union Music Park At Walnut Creek", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-04-30", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Knoxville", "Food City Center", "bandsintown.com", "Knoxville", "Food City Center", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-01", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Greenville", "Bon Secours Arena", "bandsintown.com", "Greenville", "Bon Secours Wellness Arena", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-06", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Fort Worth", "Dickies Arena", "bandsintown.com", "Fort Worth", "Dickies Arena", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-07", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Wichita", "INTRUST Bank Arena", "bandsintown.com", "Wichita", "Intrust Bank Arena", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-08", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Rogers", "Walmart Amphitheater", "bandsintown.com", "Rogers", "Walmart AMP", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-20", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Tulsa", "BOK Center", "bandsintown.com", "Tulsa", "BOK Center", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-21", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Dallas", "Dos Equis Pavilion", "bandsintown.com", "Dallas", "Dos Equis Pavilion", "peer"],
  ["Randy Houser", "spotifyId", "5L4MvJ2724g0W1YVpLd0uY", "2027-05-22", "US", "www.randyhouser.com", "https://www.randyhouser.com/tour", "Lafayette", "CAJUNDOME", "bandsintown.com", "Lafayette", "CAJUNDOME Arena & Convention Center", "peer"],
  ["Excision", "spotifyId", "5FKchcZpQOkqFvXBj1aCvb", "2026-10-22", "US", "excision.ca", "https://excision.ca/tour-dates/", "Live Oak", "Spirit of the Suwannee Music Park", "bandsintown.com", "Live Oak", "Hulaween 2026", "native"],
  ["Excision", "spotifyId", "5FKchcZpQOkqFvXBj1aCvb", "2026-10-30", "US", "excision.ca", "https://excision.ca/tour-dates/", "San Bernardino", "NOS Events Center", "bandsintown.com", "San Bernardino", "Escape: Psycho Circus 2026", "native"],
  ["Excision", "spotifyId", "5FKchcZpQOkqFvXBj1aCvb", "2026-12-04", "US", "excision.ca", "https://excision.ca/tour-dates/", "Milwaukee", "The Rave", "ticketmaster.com", "Milwaukee", "The Rave-Eagles Club", "peer"],
  ["Excision", "spotifyId", "5FKchcZpQOkqFvXBj1aCvb", "2026-12-05", "US", "excision.ca", "https://excision.ca/tour-dates/", "Milwaukee", "The Rave", "ticketmaster.com", "Milwaukee", "The Rave-Eagles Club", "peer"],
  ["Excision", "spotifyId", "5FKchcZpQOkqFvXBj1aCvb", "2026-12-12", "US", "excision.ca", "https://excision.ca/tour-dates/", "Kapolei", "Echoa Ridge", "bandsintown.com", "Kapolei", "Echoa Ridge Hawaii", "peer"],
  ["Admiral Fallow", "mbid", "1955e302-1c18-4e95-8f48-2a7c8b6a6604", "2026-10-21", "GB", "www.admiralfallow.com", "https://www.admiralfallow.com/shows", "Birmingham", "Hare & Hounds", "bandsintown.com", "Birmingham", "The Hare and Hounds", "peer"],
  ["Admiral Fallow", "mbid", "1955e302-1c18-4e95-8f48-2a7c8b6a6604", "2026-10-22", "GB", "www.admiralfallow.com", "https://www.admiralfallow.com/shows", "Sheffield", "Yellow Arch", "bandsintown.com", "Sheffield", "Yellow Arch Studios", "peer"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-10-14", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Fresno", "Big Fresno Fair", "ticketmaster.com", "Fresno", "Fresno Fairgrounds", "peer"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-10-15", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Los Angeles", "Hollywood Palladium", "bandsintown.com", "Los Angeles", "Where It All Began - Los Angeles", "native"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-10-17", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Flagstaff", "Pepsi Amphitheater at Fort Tuthill Park", "ticketmaster.com", "Flagstaff", "Pepsi Amphitheater", "peer"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-10-18", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Tucson", "Rialto Theatre", "ticketmaster.com", "Tucson", "Rialto Theatre-Tucson", "peer"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-12-04", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Honolulu", "Waikiki Shell", "ticketmaster.com", "Honolulu", "Tom Moffatt Waikiki Shell", "peer"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-12-05", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Kahului", "Maui Arts & Cultural Center - Yokouchi Pavilion", "bandsintown.com", "Kahului", "Where It All Began - Maui", "native"],
  ["Iration", "spotifyId", "0q9lPhJHW5R9J7RXIJRbTk", "2026-12-06", "US", "www.irationmusic.com", "https://www.irationmusic.com/tour", "Kailua-Kona", "The Brew", "bandsintown.com", "Kailua-kona", "Where It All Began - Hawai'i", "native"],
  ["Shelly Berg", "mbid", "1c66448e-a92d-4703-8429-68e7e181e578", "2026-12-09", "US", "www.shellyberg.com", "https://www.shellyberg.com/tour?format=json", "Irvine", "Irvine Barclay Theatre", "bandsintown.com", "Irvine", "Swingin' Through the Holidays", "native"],
  ["Shelly Berg", "mbid", "1c66448e-a92d-4703-8429-68e7e181e578", "2027-05-14", "US", "www.shellyberg.com", "https://www.shellyberg.com/tour?format=json", "Irvine", "Irvine Barclay Theatre", "bandsintown.com", "Irvine", "Ella & Joe: A Tribute to the Music and Style of Ella Fitzgerald and Joe Williams", "native"],
  ["Turmion Kätilöt", "spotifyId", "76t3VPzCEYAlrZhVAY7yjg", "2027-02-22", "PL", "turmionkatilot.com", "https://turmionkatilot.com/shows/", "Krakow", "Zaścianek", "ticketmaster.com", "Krakow", "Klub Zaścianek", "peer"],
  ["Turmion Kätilöt", "spotifyId", "76t3VPzCEYAlrZhVAY7yjg", "2027-02-23", "AT", "turmionkatilot.com", "https://turmionkatilot.com/shows/", "Wien", "Szene Wien", "bandsintown.com", "Wien", "Szene", "peer"],
  ["Turmion Kätilöt", "spotifyId", "76t3VPzCEYAlrZhVAY7yjg", "2027-02-24", "DE", "turmionkatilot.com", "https://turmionkatilot.com/shows/", "München", "Backstage Halle", "bandsintown.com", "München", "Backstage", "peer"],
  ["Turmion Kätilöt", "spotifyId", "76t3VPzCEYAlrZhVAY7yjg", "2027-02-25", "CH", "turmionkatilot.com", "https://turmionkatilot.com/shows/", "Pratteln", "Z7", "bandsintown.com", "Pratteln", "Z7 Konzertfabrik", "peer"],
  ["Turmion Kätilöt", "spotifyId", "76t3VPzCEYAlrZhVAY7yjg", "2027-02-26", "FR", "turmionkatilot.com", "https://turmionkatilot.com/shows/", "Paris", "Le Backstage by the Mill", "bandsintown.com", "Paris", "Backstage By The Mill", "peer"],
  ["Turmion Kätilöt", "spotifyId", "76t3VPzCEYAlrZhVAY7yjg", "2027-02-27", "DE", "turmionkatilot.com", "https://turmionkatilot.com/shows/", "Mörlenbach", "Live Music Hall", "bandsintown.com", "Mörlenbach", "LIVE MUSIC HALL Weiher", "peer"],
  ["Paul Carrack", "spotifyId", "0FFuvdY7fuiuTmHN9unYoz", "2026-10-18", "DE", "paulcarrack.net", "https://paulcarrack.net/live", "Berlin", "HUXLEY'S NEUE WELT", "bandsintown.com", "Berlin", "Tempodrom", "native"],
  ["Paul Carrack", "spotifyId", "0FFuvdY7fuiuTmHN9unYoz", "2026-10-19", "DE", "paulcarrack.net", "https://paulcarrack.net/live", "Zwickau", "Konzert- und Ballhaus Neue Welt", "bandsintown.com", "Zwickau", "Sparkassen-Arena Zwickau", "native"],
  ["American Composers Orchestra", "artistWebsite", "http://www.americancomposers.org/", "2026-10-27", "US", "www.americancomposers.org", "https://www.americancomposers.org/performances-events", "New York", "Zankel Hall, Carnegie Hall", "bandsintown.com", "New York", "Carnegie Hall", "peer"],
  ["American Composers Orchestra", "artistWebsite", "http://www.americancomposers.org/", "2027-03-18", "US", "www.americancomposers.org", "https://www.americancomposers.org/performances-events", "New York", "Zankel Hall, Carnegie Hall", "bandsintown.com", "New York", "Carnegie Hall", "peer"],
  ["Rachael Sage", "spotifyId", "7EedWEoxpzbiPNkqkDp3Vw", "2026-10-30", "GB", "www.rachaelsage.com", "https://www.rachaelsage.com/tour", "Manchester", "The Castle Hotel", "bandsintown.com", "Greater", "The Castle, Manchester", "native"],
  ["Bonnie Pink", "spotifyId", "0ogtEa0KT8kmWr6n0UoAqu", "2026-10-11", "JP", "www.bonniepink.jp", "https://www.bonniepink.jp/live", "Ono", "六呂師高原", "bandsintown.com", "Katsuyama", "六呂師高原", "native"],
] as const;

export function verifiedNormalizationOccurrence(raw: RawConcert, concert: Concert):
  { pairKey: string; dedupeCity: string; sourceRank: number } | undefined {
  const radiant = verifiedKingRadiantOccurrence(raw, concert);
  if (radiant) return radiant;
  if (raw.artist !== concert.artist || raw.date !== concert.date) return;
  const pair = PAIRS.find(([artist, field, id, date, country, source, url, city, venue, peer, peerCity, peerVenue]) =>
    concert.artist === artist && concert[field] === id && concert.date === date && concert.country === country &&
    ((raw.originalSource === source && raw.sourceEventUrl === url && concert.city === city && concert.venue === venue) ||
     (raw.originalSource === peer && concert.city === peerCity && concert.venue === peerVenue)));
  if (!pair) return;
  const native = raw.originalSource === pair[5];
  return { pairKey: `normalization:${pair[2]}:${pair[3]}:${pair[8]}`, dedupeCity: pair[7],
    sourceRank: native === (pair[12] === 'native') ? 2 : 1 };
}
