import axios from 'axios';
import { SEED_ARTISTS, SEED_ARTIST_WEBSITES as OFFICIAL_WEBSITES } from './seed_artists.js';
import { saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

async function run() {
  const url = 'https://raw.githubusercontent.com/bevacqua/artists/master/data.json';

  console.log(`[Downloader] Fetching data from: ${url}`);
  try {
    const response = await axios.get(url);
    const data = response.data;

    console.log(`[Downloader] Download completed. Checking structure...`);
    
    let artistNames: string[] = [];

    if (Array.isArray(data)) {
      if (typeof data[0] === 'string') {
        artistNames = data;
      } else if (typeof data[0] === 'object' && data[0] !== null) {
        artistNames = data.map((item: any) => {
          if (typeof item === 'string') return item;
          return item.name || item.artist || item.title || item.text || '';
        }).filter(Boolean);
      }
    } else if (typeof data === 'object' && data !== null) {
      console.log(`[Downloader] Data is a dictionary of categories. Extracting items...`);
      for (const key of Object.keys(data)) {
        const list = data[key];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (typeof item === 'string') {
              artistNames.push(item);
            } else if (item && typeof item === 'object') {
              const name = item.text || item.name || item.title || '';
              if (name) artistNames.push(name);
            }
          }
        }
      }
    } else {
      console.error('[Downloader] Unknown data format:', typeof data);
      return;
    }

    // Clean up names: trim, remove empty, and filter out noise
    const cleanedNames = Array.from(
      new Set(
        artistNames
          .map((name) => name.trim())
          .filter((name) => name.length > 1 && !name.includes('http') && !name.includes('wiki/') && !/^[0-9]+$/.test(name))
      )
    );

    // Merge original whitelisted artists to ensure they are always present
    for (const artist of SEED_ARTISTS) {
      if (!cleanedNames.some(n => n.toLowerCase() === artist.toLowerCase())) {
        cleanedNames.push(artist);
      }
    }

    // Sort alphabetically
    cleanedNames.sort((a, b) => a.localeCompare(b));

    // Map to object format with official website
    const artistObjects = cleanedNames.map(name => {
      const lowerName = name.toLowerCase();
      return {
        name,
        website: OFFICIAL_WEBSITES[lowerName] || null
      };
    });

    console.log(`[Downloader] Extracted and structured ${artistObjects.length} unique artists.`);

    await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artistObjects);

    console.log(`[Downloader] Saved ${artistObjects.length} approved artists to: ${PRODUCTION_ARTIST_DB_DIR}`);

  } catch (err: any) {
    console.error(`[Downloader] Error: ${err.message}`);
  }
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
