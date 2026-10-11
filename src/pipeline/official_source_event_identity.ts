import type { Concert, RawConcert } from '../schemas/concert.js';

const BLUE_OCTOBER_SPOTIFY_ID = '1TJbmc7jTpw78GKCiMpvDh';

// Finite 2026-10-10 official programme / existing-public counterpart pairs.
// Fields: full date, native path, country, native city/venue, provider/city/venue.
// Evidence: tests/fixtures/blue-october-event-pairs-20261010.json. These are
// event identities, never general city/venue aliases or a global source priority.
const BLUE_OCTOBER_PAIRS = [
  ["2026-10-22", "/tour-dates-detail/the-paramount", "US", "Abilene", "The Paramount", "ticketmaster.com", "Abilene", "Paramount Theatre-Abilene"],
  ["2026-10-23", "/tour-dates-detail/the-buddy-holly", "US", "Lubbock", "The Buddy Holly", "ticketmaster.com", "Lubbock", "Helen DeVitt Jones Theater at The Buddy Holly Hall"],
  ["2026-10-24", "/tour-dates-detail/tulsa-theater", "US", "Tulsa", "Tulsa Theater", "ticketmaster.com", "Tulsa", "Tulsa Theater"],
  ["2026-10-25", "/tour-dates-detail/orpheum-theatre", "US", "Wichita", "Orpheum Theatre", "ticketmaster.com", "Wichita", "Orpheum Theatre - Wichita KS"],
  ["2026-10-28", "/tour-dates-detail/the-pabst-theater", "US", "Milwaukee", "The Pabst Theater", "ticketmaster.com", "Milwaukee", "Pabst Theater"],
  ["2026-10-29", "/tour-dates-detail/glc-live-at-20-monroe", "US", "Grand Rapids", "GLC Live at 20 Monroe", "ticketmaster.com", "Grand Rapids", "GLC Live at 20 Monroe"],
  ["2026-10-30", "/tour-dates-detail/the-fillmore-detroit", "US", "Detroit", "The Fillmore Detroit", "ticketmaster.com", "Detroit", "The Fillmore Detroit"],
  ["2026-10-31", "/tour-dates-detail/the-danforth-music-hall", "CA", "Toronto", "The Danforth Music Hall", "ticketmaster.com", "Toronto", "The Danforth Music Hall"],
  ["2026-11-01", "/tour-dates-detail/mtelus", "CA", "Montreal", "MTELUS", "ticketmaster.com", "Montreal", "MTELUS"],
  ["2026-11-03", "/tour-dates-detail/state-theatre", "US", "Portland", "State Theatre", "ticketmaster.com", "Portland", "State Theatre"],
  ["2026-11-04", "/tour-dates-detail/palladium-times-square", "US", "New York", "Palladium Times Square", "bandsintown.com", "New York", "Palladium Times Square"],
  ["2026-11-06", "/tour-dates-detail/hart-theatre-at-the-egg", "US", "Albany", "Hart Theatre at The Egg", "ticketmaster.com", "Albany", "Hart Theatre at The Egg"],
  ["2026-11-07", "/tour-dates-detail/the-agora", "US", "Cleveland", "The Agora", "ticketmaster.com", "Cleveland", "Agora Theatre"],
  ["2026-11-08", "/tour-dates-detail/brown-county-music-center", "US", "Nashville", "Brown County Music Center", "ticketmaster.com", "Nashville", "Brown County Music Center"],
  ["2026-11-11", "/tour-dates-detail/riviera-theatre-buffalo", "US", "North Tonawanda", "Riviera Theatre", "ticketmaster.com", "North Tonawanda", "Riviera Theatre-NY"],
  ["2026-11-12", "/tour-dates-detail/count-basie-center-for-the-arts", "US", "Red Bank", "Count Basie Center For The Arts", "ticketmaster.com", "Red Bank", "Hackensack Meridian Health Theatre at the Count Basie Center"],
  ["2026-11-13", "/tour-dates-detail/citizens-house-of-blues", "US", "Boston", "Citizens House of Blues", "ticketmaster.com", "Boston", "Citizens House of Blues Boston"],
  ["2026-11-14", "/tour-dates-detail/f.m.-kirby-center-for-the-performing-arts", "US", "Wilkes-Barre", "F.M. Kirby Center for the Performing Arts", "ticketmaster.com", "Wilkes Barre", "F.M. Kirby Center"],
  ["2026-11-15", "/tour-dates-detail/the-fillmore-philadelphia", "US", "Philadelphia", "The Fillmore Philadelphia", "ticketmaster.com", "Philadelphia", "The Fillmore Philadelphia"],
  ["2026-11-17", "/tour-dates-detail/the-fillmore-charlotte", "US", "Charlotte", "The Fillmore Charlotte", "ticketmaster.com", "Charlotte", "The Fillmore Charlotte"],
  ["2026-11-19", "/tour-dates-detail/five", "US", "Jacksonville", "FIVE", "ticketmaster.com", "Jacksonville", "FIVE"],
  ["2026-11-20", "/tour-dates-detail/ruth-eckerd-hall", "US", "Clearwater", "Ruth Eckerd Hall", "ticketmaster.com", "Clearwater", "Ruth Eckerd Hall"],
  ["2026-11-21", "/tour-dates-detail/hard-rock-live-orlando", "US", "Orlando", "Hard Rock Live", "ticketmaster.com", "Orlando", "Hard Rock Live Orlando"],
  ["2026-11-22", "/tour-dates-detail/tabernacle", "US", "Atlanta", "Tabernacle", "ticketmaster.com", "Atlanta", "Tabernacle Presented by iTHINK Financial"],
  ["2026-11-25", "/tour-dates-detail/the-truth", "US", "Nashville", "The Truth", "ticketmaster.com", "Nashville", "The Truth"],
  ["2026-11-27", "/tour-dates-detail/the-pavilion-at-toyota-music-factory", "US", "Irving", "The Pavilion at Toyota Music Factory (Night 1)", "ticketmaster.com", "Irving", "The Pavilion at Toyota Music Factory"],
  ["2026-11-28", "/tour-dates-detail/the-pavilion-at-toyota-music-factory-(night-1)", "US", "Irving", "The Pavilion at Toyota Music Factory (Night 2)", "ticketmaster.com", "Irving", "The Pavilion at Toyota Music Factory"],
  ["2026-12-03", "/tour-dates-detail/the-midland-theatre", "US", "Kansas City", "The Midland Theatre", "ticketmaster.com", "Kansas City", "The Midland Theatre - MO"],
  ["2026-12-04", "/tour-dates-detail/the-fillmore-minneapolis", "US", "Minneapolis", "The Fillmore Minneapolis", "ticketmaster.com", "Minneapolis", "The Fillmore Minneapolis presented by Affinity Plus"],
  ["2026-12-05", "/tour-dates-detail/the-astro", "US", "La Vista", "The Astro", "ticketmaster.com", "La Vista", "The Astro Theater"],
  ["2026-12-06", "/tour-dates-detail/the-criterion", "US", "Oklahoma City", "The Criterion", "ticketmaster.com", "Oklahoma City", "Criterion Theater - Oklahoma City"],
  ["2026-12-09", "/tour-dates-detail/the-hall", "US", "Little Rock", "The Hall", "ticketmaster.com", "Little Rock", "The Hall"],
  ["2026-12-10", "/tour-dates-detail/jefferson-theatre", "US", "Beaumont", "Jefferson Theatre", "ticketmaster.com", "Beaumont", "Jefferson Theatre"],
  ["2026-12-11", "/tour-dates-detail/bass-concert-hall", "US", "Austin", "Bass Concert Hall", "ticketmaster.com", "Austin", "Bass Concert Hall"],
  ["2026-12-12", "/tour-dates-detail/boeing-center-at-tech-port", "US", "San Antonio", "Boeing Center at Tech Port", "ticketmaster.com", "San Antonio", "Boeing Center at Tech Port"],
  ["2026-12-13", "/tour-dates-detail/payne-arena", "US", "Hidalgo", "Payne Arena", "ticketmaster.com", "Hidalgo", "Payne Arena"],
  ["2026-12-17", "/tour-dates-detail/selena-auditorium", "US", "Corpus Christi", "Selena Auditorium", "ticketmaster.com", "Corpus Christi", "Selena Auditorium"],
  ["2026-12-18", "/tour-dates-detail/713-music-hall", "US", "Houston", "713 Music Hall (Night 1)", "ticketmaster.com", "Houston", "713 Music Hall"],
  ["2026-12-19", "/tour-dates-detail/713-music-hall-(night-2)", "US", "Houston", "713 Music Hall (Night 2)", "ticketmaster.com", "Houston", "713 Music Hall"],
  ["2026-12-20", "/tour-dates-detail/713-music-hall-(night-3)", "US", "Houston", "713 Music Hall (Night 3)", "ticketmaster.com", "Houston", "713 Music Hall"],
  ["2027-01-29", "/tour-dates-detail/wagner-no%C3%ABl-performing-arts-center", "US", "Midland", "Wagner Noël Performing Arts Center", "ticketmaster.com", "Midland", "Wagner Noel Performing Arts Center"],
  ["2027-01-30", "/tour-dates-detail/plaza-theatre", "US", "El Paso", "Plaza Theatre", "ticketmaster.com", "El Paso", "The Plaza Theatre Performing Arts Center"],
  ["2027-01-31", "/tour-dates-detail/globe-news-center-for-the-performing-arts", "US", "Amarillo", "Globe-News Center for the Performing Arts", "ticketmaster.com", "Amarillo", "Globe News Center for the Performing Arts"],
  ["2027-02-03", "/tour-dates-detail/the-rialto-theatre", "US", "Tucson", "The Rialto Theatre", "ticketmaster.com", "Tucson", "Rialto Theatre-Tucson"],
  ["2027-02-04", "/tour-dates-detail/revel", "US", "Albuquerque", "Revel", "ticketmaster.com", "Albuquerque", "Revel Entertainment Center"],
  ["2027-02-05", "/tour-dates-detail/the-van-buren-night-1", "US", "Phoenix", "The Van Buren (Night 1)", "ticketmaster.com", "Phoenix", "The Van Buren"],
  ["2027-02-06", "/tour-dates-detail/the-van-buren-night-2", "US", "Phoenix", "The Van Buren (Night 2)", "ticketmaster.com", "Phoenix", "The Van Buren"],
  ["2027-02-07", "/tour-dates-detail/the-wiltern", "US", "Los Angeles", "The Wiltern", "ticketmaster.com", "Los Angeles", "The Wiltern"],
  ["2027-02-10", "/tour-dates-detail/fremont-theatre", "US", "San Luis Obispo", "Fremont Theatre", "ticketmaster.com", "San Luis Obispo", "Fremont Theater"],
  ["2027-02-11", "/tour-dates-detail/harrah%E2%80%99s-resort-southern-california", "US", "Funner", "Harrah’s Resort Southern California", "ticketmaster.com", "Valley Center", "Harrah's Resort SoCal - The Events Center"],
  ["2027-02-12", "/tour-dates-detail/majestic-ventura-theater", "US", "Ventura", "Majestic Ventura Theater", "ticketmaster.com", "Ventura", "Ventura Theater"],
  ["2027-02-13", "/tour-dates-detail/brooklyn-bowl", "US", "Las Vegas", "Brooklyn Bowl", "ticketmaster.com", "Las Vegas", "Brooklyn Bowl Las Vegas"],
  ["2027-02-17", "/tour-dates-detail/fox-theater", "US", "Bakersfield", "Fox Theater", "ticketmaster.com", "Bakersfield", "Bakersfield Fox Theater"],
  ["2027-02-18", "/tour-dates-detail/regency", "US", "San Francisco", "Regency", "ticketmaster.com", "San Francisco", "The Regency Ballroom"],
  ["2027-02-19", "/tour-dates-detail/channel-24-(night-1)", "US", "Sacramento", "Channel 24 (Night 1)", "ticketmaster.com", "Sacramento", "Channel 24"],
  ["2027-02-20", "/tour-dates-detail/channel-24", "US", "Sacramento", "Channel 24 (Night 2)", "ticketmaster.com", "Sacramento", "Channel 24"],
  ["2027-02-21", "/tour-dates-detail/silver-legacy-resort---grande-exposition-hall", "US", "Reno", "Silver Legacy Resort - Grande Exposition Hall", "ticketmaster.com", "Reno", "Silver Legacy Casino Reno"],
  ["2027-02-24", "/tour-dates-detail/knitting-factory-spokane", "US", "Spokane", "Knitting Factory Spokane", "ticketmaster.com", "Spokane", "Knitting Factory - Spokane"],
  ["2027-02-25", "/tour-dates-detail/commodore-ballroom", "CA", "Vancouver", "Commodore Ballroom", "ticketmaster.com", "Vancouver", "Commodore Ballroom"],
  ["2027-02-26", "/tour-dates-detail/moore-theatre", "US", "Seattle", "Moore Theatre", "ticketmaster.com", "Seattle", "Moore Theatre"],
  ["2027-02-27", "/tour-dates-detail/roseland-theater-night1", "US", "Portland", "Roseland Theater (Night 1)", "ticketmaster.com", "Portland", "Roseland Theater"],
  ["2027-02-28", "/tour-dates-detail/roseland-theater-night-2", "US", "Portland", "Roseland Theater (Night 2)", "ticketmaster.com", "Portland", "Roseland Theater"],
  ["2027-03-03", "/tour-dates-detail/knitting-factory-boise", "US", "Boise", "Knitting Factory Boise", "ticketmaster.com", "Boise", "Knitting Factory - Boise"],
  ["2027-03-05", "/tour-dates-detail/the-complex", "US", "Salt Lake City", "The Complex", "ticketmaster.com", "Salt Lake City", "The Complex - UT"],
  ["2027-03-06", "/tour-dates-detail/mission-ballroom", "US", "Denver", "Mission Ballroom", "ticketmaster.com", "Denver", "Mission Ballroom"],
  ["2027-03-07", "/tour-dates-detail/pikes-peak-center", "US", "Colorado Springs", "Pikes Peak Center", "ticketmaster.com", "Colorado Springs", "Pikes Peak Center"],
  ["2027-03-11", "/tour-dates-detail/riviera-theatre-chicago", "US", "Chicago", "Riviera Theatre", "ticketmaster.com", "Chicago", "Riviera Theatre- IL"],
  ["2027-03-12", "/tour-dates-detail/hoyt-sherman-place", "US", "Des Moines", "Hoyt Sherman Place", "ticketmaster.com", "Des Moines", "Hoyt Sherman Place"],
  ["2027-03-13", "/tour-dates-detail/the-factory", "US", "Chesterfield", "The Factory", "bandsintown.com", "Chesterfield", "The Factory"],
  ["2027-03-14", "/tour-dates-detail/hard-rock-live-rockford", "US", "Rockford", "Hard Rock Live Rockford", "ticketmaster.com", "Rockford", "Hard Rock Live Rockford"],
] as const;

// Nine primary-complete Teenage Fanclub records (ES/FR/BE); incomplete
// countries and later proof cohorts are deliberately absent from this registry.
const TEENAGE_FANCLUB_PAIRS = [
  ["2026-10-10", "https://justlifemusic.com/teenage/", "ES", "Oviedo", "Almacenes Kuivi", "bandsintown.com", "Oviedo", "Kuivi Pop Up"],
  ["2026-10-11", "https://justlifemusic.com/teenage/", "ES", "Bilbao", "Antzokia", "bandsintown.com", "Bilbao", "Kafe Antzokia"],
  ["2026-10-12", "https://justlifemusic.com/teenage/", "ES", "Zaragoza", "Jardin de Invierno", "bandsintown.com", "Zaragoza", "Invierno Garden"],
  ["2026-10-14", "https://justlifemusic.com/teenage/", "ES", "Pamplona", "Zentral", "bandsintown.com", "Pamplona", "Zentral"],
  ["2026-10-15", "https://justlifemusic.com/teenage/", "ES", "Madrid", "Sala Wagon", "bandsintown.com", "Madrid", "Wagon"],
  ["2026-10-16", "https://justlifemusic.com/teenage/", "ES", "Valencia", "Sala Moon", "bandsintown.com", "Valencia", "Moon Valencia"],
  ["2026-10-17", "https://justlifemusic.com/teenage/", "ES", "Barcelona", "Razzmatazz 2", "bandsintown.com", "Barcelona", "Razzmatazz 2"],
  ["2026-10-19", "https://marchegare.fr/agenda/teenage-fanclub", "FR", "Lyon", "Marché Gare", "bandsintown.com", "Lyon", "Le Marché Gare"],
  ["2026-10-24", "https://teenage.fanclub.tickets.cactusmusic.be/selection", "BE", "Bruges", "Cactus Club", "bandsintown.com", "Brugge", "Cactus Club"],
] as const;

/** Match only a captured event occurrence and exact location/source labels.
 * The native source URL remains internal; output always keeps one whole record.
 * New dates, venue moves and unknown labels cannot inherit these old pairs. */
export function verifiedOfficialSourceEventIdentity(raw: RawConcert, concert: Concert):
  { pairKey: string; dedupeCity: string; sourceRank: number } | undefined {
  const blue = concert.artist === 'Blue October' && concert.spotifyId === BLUE_OCTOBER_SPOTIFY_ID;
  const teenage = concert.artist === 'Teenage Fanclub' && concert.spotifyId === '5a92s1P4G2L54x4U6c7t1i';
  if ((!blue && !teenage) || raw.artist?.trim().toLowerCase() !== concert.artist.toLowerCase() ||
      raw.date !== concert.date) return;
  const source = raw.originalSource?.trim().toLowerCase();
  const native = (blue ? ['blueoctober.com','www.blueoctober.com'] : ['teenagefanclub.com','www.teenagefanclub.com'])
    .includes(source || '');
  let nativeHref: string | undefined;
  if (native) {
    try {
      const url = new URL(raw.sourceEventUrl || raw.ticketUrl || '');
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return;
      url.pathname = url.pathname.replace(/\/$/, '');
      nativeHref = url.href;
    } catch { return; }
  }
  const pairs = blue ? BLUE_OCTOBER_PAIRS : TEENAGE_FANCLUB_PAIRS;
  const pair = pairs.find(([date, eventUrl, country, nativeCity, nativeVenue, provider, providerCity, providerVenue]) => {
    const proofUrl = new URL(eventUrl, 'https://www.blueoctober.com');
    proofUrl.pathname = proofUrl.pathname.replace(/\/$/, '');
    return concert.date === date && concert.country === country && (native
      ? nativeHref === proofUrl.href && concert.city === nativeCity && concert.venue === nativeVenue
      : source === provider && concert.city === providerCity && concert.venue === providerVenue);
  });
  if (!pair) return;
  return { pairKey: `${blue ? 'blueoctober' : 'teenagefanclub'}:${pair[1]}`, dedupeCity: pair[6], sourceRank: native ? 1 : 2 };
}
