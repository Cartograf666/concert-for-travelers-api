import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

const OFFICIAL_WEBSITES: Record<string, string> = {
  "the cure": "https://www.thecure.com",
  "rammstein": "https://www.rammstein.de",
  "metallica": "https://www.metallica.com",
  "coldplay": "https://www.coldplay.com",
  "radiohead": "https://www.radiohead.com",
  "billie eilish": "https://www.billieeilish.com",
  "taylor swift": "https://www.taylorimages.com",
  "daft punk": "https://www.daftpunk.com",
  "depeche mode": "https://www.depechemode.com",
  "nirvana": "https://www.nirvana.com",
  "system of a down": "https://www.systemofadown.com",
  "linkin park": "https://www.linkinpark.com",
  "massive attack": "https://www.massiveattack.co.uk",
  "portishead": "https://www.portishead.co.uk",
  "aphex twin": "https://aphextwin.warp.net",
  "kraftwerk": "https://www.kraftwerk.com",
  "moderat": "https://www.moderat.fm"
};

async function run() {
  const url = 'https://raw.githubusercontent.com/bevacqua/artists/master/data.json';
  const outputPath = path.join(process.cwd(), 'data', 'approved_artists.json');

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
    const originalApproved = [
      "The Cure", "Rammstein", "Metallica", "Coldplay", "Radiohead",
      "Billie Eilish", "Taylor Swift", "Daft Punk", "Depeche Mode", "Nirvana",
      "System of a Down", "Linkin Park", "Massive Attack", "Portishead",
      "Aphex Twin", "Kraftwerk", "Moderat"
    ];

    for (const artist of originalApproved) {
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

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await fs.writeFile(
      outputPath,
      JSON.stringify(artistObjects, null, 2),
      'utf-8'
    );

    console.log(`[Downloader] Saved ${artistObjects.length} approved artists to: ${outputPath}`);

  } catch (err: any) {
    console.error(`[Downloader] Error: ${err.message}`);
  }
}

run();
