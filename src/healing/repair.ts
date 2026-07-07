import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ScraperConfig, ScraperConfigSchema } from '../schemas/config.js';
import { Concert } from '../schemas/concert.js';
import { extractJsonLd } from '../engine/structured.js';

/**
 * Extracts and parses selectors from LLM text output.
 */
export function cleanAndParseSelectors(responseText: string): any {
  let cleaned = responseText.trim();
  
  // Strip Markdown JSON code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Failed to parse LLM response as JSON. Content: "${cleaned}". Error: ${err.message}`);
  }
}

/**
 * Test a set of selectors against the HTML snippet locally.
 */
export function testSelectorsOnHtml(
  selectors: any,
  config: ScraperConfig,
  html: string
): Partial<Concert>[] {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  
  const { eventBlock, artist, date, ticketUrl, venueNameFallback, cityNameFallback, countryNameFallback } = selectors;
  
  if (!eventBlock || !artist || !date) {
    throw new Error("Missing required selectors: eventBlock, artist, or date");
  }

  const blocks = $(eventBlock);
  if (blocks.length === 0) {
    throw new Error(`Selector "eventBlock" (${eventBlock}) matched 0 elements.`);
  }

  blocks.each((_, element) => {
    const block = $(element);
    const artistText = block.find(artist).text().trim();
    const dateText = block.find(date).text().trim();
    
    let absoluteTicketUrl: string | undefined;
    if (ticketUrl) {
      const ticketEl = block.find(ticketUrl);
      let href = ticketEl.attr('href');
      if (!href && block.is('a')) {
        href = block.attr('href');
      }
      if (href) {
        try {
          absoluteTicketUrl = new URL(href, config.url).toString();
        } catch {
          absoluteTicketUrl = href;
        }
      }
    }

    if (artistText && dateText) {
      concerts.push({
        artist: artistText,
        date: dateText,
        venue: venueNameFallback || selectors.venueNameFallback,
        city: cityNameFallback || selectors.cityNameFallback,
        country: countryNameFallback || selectors.countryNameFallback,
        ticketUrl: absoluteTicketUrl,
        originalSource: config.domain,
        scrapedAt: new Date().toISOString()
      });
    }
  });

  return concerts;
}

/**
 * Repairs a broken scraper configuration by querying the Gemini API.
 */
export async function repairScraperConfig(
  configPath: string,
  htmlSample: string,
  apiKey: string
): Promise<{ success: boolean; config?: ScraperConfig; error?: string }> {
  try {
    // 1. Read broken configuration
    const configContent = await fs.readFile(configPath, 'utf-8');
    const brokenConfig = ScraperConfigSchema.parse(JSON.parse(configContent));

    if (brokenConfig.type !== 'static_selectors' || !brokenConfig.selectors) {
      return {
        success: false,
        error: `Scraper ${brokenConfig.id} is not a static_selectors scraper or is missing selectors.`
      };
    }

    // Pre-LLM probe: many "layout changed" breaks are on sites that embed stable
    // schema.org JSON-LD. If so, switch to type 'jsonld' for free — no Gemini call,
    // no rate-limit pressure, and a far more durable fix than a fresh hashed selector.
    const jsonLdConcerts = extractJsonLd(brokenConfig, htmlSample, new Date().toISOString());
    if (jsonLdConcerts.length > 0) {
      const jsonLdConfig = ScraperConfigSchema.parse({ ...brokenConfig, type: 'jsonld' });
      await fs.writeFile(configPath, JSON.stringify(jsonLdConfig, null, 2), 'utf-8');
      console.log(`[Repair] Recovered ${jsonLdConcerts.length} events via JSON-LD; switched ${brokenConfig.id} to type 'jsonld' (no LLM used).`);
      return { success: true, config: jsonLdConfig };
    }

    console.log(`[Repair] Initiating LLM self-healing for: ${brokenConfig.id}`);

    // 2. Query Gemini API with failover model cascade
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    let result: any = null;
    let lastError: any = null;

    const prompt = `You are a professional self-healing web scraper AI assistant.
We have a concert scraper configuration that has stopped working because the website's HTML layout has changed.

Here is the broken scraper configuration:
${JSON.stringify(brokenConfig, null, 2)}

Here is a sample of the updated HTML from the website:
\`\`\`html
${htmlSample}
\`\`\`

Analyze the updated HTML and generate corrected selectors.
The output must be a JSON object containing the "selectors" block matching the ScraperConfig selectors schema:
{
  "eventBlock": "CSS selector matching the card or element containing a single concert event",
  "artist": "CSS selector inside eventBlock to extract the artist name",
  "date": "CSS selector inside eventBlock to extract the date string",
  "datePattern": "Regex/Format pattern to parse the date, e.g. DD.MM.YYYY (optional)",
  "ticketUrl": "CSS selector inside eventBlock or event link itself for tickets (optional)",
  "venueNameFallback": "Keep unchanged: ${brokenConfig.selectors.venueNameFallback}",
  "cityNameFallback": "Keep unchanged: ${brokenConfig.selectors.cityNameFallback}",
  "countryNameFallback": "Keep unchanged: ${brokenConfig.selectors.countryNameFallback}"
}

Respond with ONLY the JSON object. Do not include markdown code block syntax (like \`\`\`json), explanations, or notes. Ensure the selectors are valid CSS selectors compatible with Cheerio.`;

    for (const modelName of models) {
      try {
        console.log(`[Repair] Attempting generation with model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        result = await model.generateContent(prompt);
        console.log(`[Repair] Model ${modelName} succeeded.`);
        break; // Success! Break out of loop
      } catch (err: any) {
        console.warn(`[Repair] Warning: Failed with model ${modelName} - ${err.message}`);
        lastError = err;
      }
    }

    if (!result) {
      throw new Error(`All Gemini models failed. Last error: ${lastError?.message}`);
    }

    const responseText = result.response.text();

    console.log(`[Repair] LLM response received. Parsing...`);
    const newSelectors = cleanAndParseSelectors(responseText);

    // Ensure fallback names are preserved
    newSelectors.venueNameFallback = brokenConfig.selectors.venueNameFallback;
    newSelectors.cityNameFallback = brokenConfig.selectors.cityNameFallback;
    newSelectors.countryNameFallback = brokenConfig.selectors.countryNameFallback;

    // 3. Validate fixed selectors on the local HTML sample
    console.log(`[Repair] Testing new selectors on HTML sample...`);
    const parsedConcerts = testSelectorsOnHtml(newSelectors, brokenConfig, htmlSample);

    if (parsedConcerts.length === 0) {
      throw new Error("New selectors were generated but extracted 0 events. Invalid selectors.");
    }

    console.log(`[Repair] Test succeeded! Extracted ${parsedConcerts.length} events from HTML sample using new selectors.`);

    // 4. Save the updated configuration
    const updatedConfig: ScraperConfig = {
      ...brokenConfig,
      selectors: newSelectors
    };

    // Double check Zod validation
    const validatedConfig = ScraperConfigSchema.parse(updatedConfig);

    await fs.writeFile(
      configPath,
      JSON.stringify(validatedConfig, null, 2),
      'utf-8'
    );

    console.log(`[Repair] Saved repaired config to: ${configPath}`);
    return {
      success: true,
      config: validatedConfig
    };

  } catch (error: any) {
    console.error(`[Repair] Failed to repair configuration: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}
