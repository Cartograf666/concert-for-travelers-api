import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScraperConfig, ScraperConfigSchema } from '../schemas/config.js';
import { Concert } from '../schemas/concert.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export interface ScraperResult {
  configId: string;
  success: boolean;
  concerts: Partial<Concert>[];
  error?: string;
  htmlSample?: string;
  scrapedAt: string;
}

/**
 * Loads all scraper configurations from the given directory.
 */
export async function loadConfigs(scrapersDir: string): Promise<ScraperConfig[]> {
  try {
    const files = await fs.readdir(scrapersDir);
    const configs: ScraperConfig[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(scrapersDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        
        const validated = ScraperConfigSchema.parse(parsed);
        configs.push(validated);
      }
    }
    return configs;
  } catch (error: any) {
    throw new Error(`Failed to load scraper configurations: ${error.message}`);
  }
}

/**
 * Runs a single static selector-based scraper.
 */
async function runStaticScraper(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  if (!config.selectors) {
    throw new Error(`Selectors are missing for static scraper config: ${config.id}`);
  }

  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  const { eventBlock, artist, date, ticketUrl, venueNameFallback, cityNameFallback, countryNameFallback } = config.selectors;

  $(eventBlock).each((_, element) => {
    const block = $(element);
    
    // Extract artist text
    const artistText = block.find(artist).text().trim();
    
    // Extract date text
    const dateText = block.find(date).text().trim();
    
    // Extract ticket/info URL
    let absoluteTicketUrl: string | undefined;
    if (ticketUrl) {
      const ticketEl = block.find(ticketUrl);
      let href = ticketEl.attr('href');
      
      // Fallback: check if the block itself is an anchor tag and we selected it
      if (!href && block.is('a')) {
        href = block.attr('href');
      }

      if (href) {
        try {
          absoluteTicketUrl = new URL(href, config.url).toString();
        } catch {
          // If URL parsing fails, ignore or keep original
          absoluteTicketUrl = href;
        }
      }
    }

    if (artistText && dateText) {
      concerts.push({
        artist: artistText,
        // We leave date normalization and validation to the pipeline
        date: dateText,
        venue: venueNameFallback,
        city: cityNameFallback,
        country: countryNameFallback,
        ticketUrl: absoluteTicketUrl,
        originalSource: config.domain,
        scrapedAt
      });
    }
  });

  return concerts;
}

/**
 * Runs a single custom JS scraper (looks for custom module under src/engine/custom/{id}.ts or js).
 */
async function runCustomJsScraper(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  // We dynamic import the custom implementation if it exists
  const customModulePath = `./custom/${config.id}.js`;
  try {
    const customScraper = await import(customModulePath);
    if (typeof customScraper.scrape !== 'function') {
      throw new Error(`Module ${customModulePath} does not export a "scrape" function.`);
    }
    return await customScraper.scrape(config, html, scrapedAt);
  } catch (err: any) {
    throw new Error(`Failed to execute custom JS scraper for ${config.id}: ${err.message}`);
  }
}

/**
 * Runs a single scraper config.
 */
export async function runScraper(config: ScraperConfig): Promise<ScraperResult> {
  const scrapedAt = new Date().toISOString();
  let html = '';
  try {
    const response = await axios.get(config.url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000 // 10s timeout
    });

    html = response.data;
    if (typeof html !== 'string') {
      throw new Error(`Response data is not a string. Type: ${typeof html}`);
    }

    let concerts: Partial<Concert>[] = [];
    if (config.type === 'static_selectors') {
      concerts = await runStaticScraper(config, html, scrapedAt);
    } else if (config.type === 'custom_js') {
      concerts = await runCustomJsScraper(config, html, scrapedAt);
    }

    if (concerts.length === 0) {
      throw new Error("Parsed 0 concerts. Website layout might have changed.");
    }

    return {
      configId: config.id,
      success: true,
      concerts,
      scrapedAt
    };
  } catch (error: any) {
    // Capture HTML sample for debugging/self-healing (first 10000 chars)
    const htmlSample = html ? html.slice(0, 10000) : undefined;
    return {
      configId: config.id,
      success: false,
      concerts: [],
      error: error.message,
      htmlSample,
      scrapedAt
    };
  }
}

/**
 * Runs a list of scraper configs concurrently, with a maximum concurrency limit.
 */
export async function runAllScrapers(configs: ScraperConfig[], concurrency = 5): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];
  const remaining = [...configs];

  async function worker() {
    while (remaining.length > 0) {
      const config = remaining.shift();
      if (!config) break;

      console.log(`[Runner] Starting scraper: ${config.id} (${config.url})`);
      try {
        const res = await runScraper(config);
        results.push(res);
        if (res.success) {
          console.log(`[Runner] Success: ${config.id} extracted ${res.concerts.length} events.`);
        } else {
          console.warn(`[Runner] Failed: ${config.id} - Error: ${res.error}`);
        }
      } catch (err: any) {
        console.error(`[Runner] Critical failure executing ${config.id}: ${err.message}`);
        results.push({
          configId: config.id,
          success: false,
          concerts: [],
          error: err.message,
          scrapedAt: new Date().toISOString()
        });
      }
    }
  }

  // Spawn worker promises
  const workers = Array.from({ length: Math.min(concurrency, configs.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
