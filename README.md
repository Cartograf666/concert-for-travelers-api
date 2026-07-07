# Resilient Self-Healing Concert Scraper & Metadata Enrichment Network

A serverless, zero-maintenance concert scraping and metadata enrichment network built with **Node.js**, **TypeScript**, **Cheerio**, and **Zod**. It aggregates concert data across multiple venues, normalizes artist names and dates, performs JIT (Just-In-Time) social links extraction, and exposes the aggregated data as a free, highly-performant **Static JSON API**. 

Features an automated **Self-Healing Selector Repair** and a robust **Cascading Model Failover Cascade** powered by the Gemini API to keep scrapers functioning even when target websites change their layouts.

---

## 🚀 Key Features

1. **Zero-Ops Serverless Architecture**: Runs entirely inside GitHub Actions workflows and deploys statically to GitHub Pages. Requires no traditional databases or running servers.
2. **JIT Artist Metadata & Socials Enrichment**: Automatically detects newly scraped touring artists with missing info and queries Gemini in batches to lookup their official website and social platforms (Spotify, Instagram, Facebook, YouTube, Telegram, and VK).
3. **Resilient Cascading Failover Cascade**: To bypass API rate limits on free-tier keys, both enrichment and self-healing systems implement a fallback model list:
   `gemini-3.5-flash` ➡️ `gemini-3.1-flash` ➡️ `gemini-2.5-flash` ➡️ `gemini-2.5-flash-lite` ➡️ `gemini-1.5-flash` ➡️ `gemini-1.5-pro`
4. **Artist Whitelist Database**: Employs a pre-downloaded, sanitized catalog of over **62,000+** artists (seeded from a community artist list, enriched via MusicBrainz/Wikidata/Gemini) to whitelist verified touring acts and automatically filters out local cover/tribute bands.
5. **Self-Healing CSS Selectors**: If a scraper's CSS selector stops returning concerts, an automated flow queries Gemini to analyze the new HTML sample, repairs the selectors, validates them locally, and commits the fix back to the repository.
6. **Strict Schema Verification**: Uses Zod schemas to validate scraper configurations and outputs before publishing, preventing malformed data from reaching the static endpoints.

---

## 📁 Directory Structure

```
├── .github/workflows/
│   ├── daily-scrape.yml        # Daily cron job that scrapes, enriches, and publishes
│   ├── self-heal.yml           # Auto-heals selectors if scraping failures are logged
│   └── pr-test.yml             # Validates PR code changes and compiler checks
├── scrapers/                   # JSON config files for each venue scraper
├── data/
│   └── approved_artists.json   # Approved artist master list for normalization & socials
├── src/
│   ├── schemas/
│   │   ├── concert.ts          # Concert Zod schema (with socials and web validation)
│   │   └── config.ts           # Scraper configuration Zod schema
│   ├── engine/
│   │   └── runner.ts           # Axios and Cheerio scraper core execution
│   ├── pipeline/
│   │   ├── process.ts          # Normalization, relative-date parsing, deduplication
│   │   └── enrich.ts           # JIT metadata lookup using Gemini API with failover
│   ├── generator/
│   │   └── publish.ts          # Generates and splits JSON endpoints into /dist
│   ├── healing/
│   │   └── repair.ts           # Self-healing logic with model failover cascade
│   ├── scripts/
│   │   ├── download_artists.ts # Seed database downloader (community artist list)
│   │   ├── clean_artists.ts    # Cleans Approved Artists from typographic noise/duplicates
│   │   └── geocode_venues.ts   # One-off batch geocoder for venue lat/lng (Nominatim/OSM)
│   ├── run.ts                  # Main entry point orchestrator for scraping
│   └── heal.ts                 # Main entry point orchestrator for self-healing
├── tests/                      # Automated test suite (node --test)
├── tsconfig.json               # TypeScript compiler config
├── package.json
└── README.md
```

---

## 🛠️ Local Development & Commands

### Prerequisites
- Node.js v20+
- A Gemini API Key (optional, needed for JIT enrichment & self-healing)

### Installation
```bash
npm install
```

### Compile Code
```bash
npm run build
```

### Run Scraper & Aggregator
This will run all scrapers in `scrapers/`, run JIT social/website enrichment on Gemini, write results to `/dist`, and log failure reports to `reports/fail-log.json`.
```bash
# Optional: Set Gemini key for enrichment
export GEMINI_API_KEY="your-gemini-key"

npm run scrape
```

### Run Self-Healing Locally
If you have a `reports/fail-log.json` file and a Gemini API Key, you can execute the healer locally:
```bash
export GEMINI_API_KEY="your-gemini-key"
npm run heal
```

### Clean Artist Database
Cleans the raw approved artists list from typographic noise, case-insensitive duplicates, and invalid HTML tags.
```bash
npm run clean-artists
```

### Geocode Venue Coordinates
One-off batch script: geocodes each scraper's fixed venue (name + city + country) via the free OpenStreetMap/Nominatim provider and caches the resulting `lat`/`lng` in the scraper's own JSON config. Skips artist tour-page scrapers (per-row venue, no single fixed coordinate) and configs that already have coordinates.
```bash
# Set a real contact address -- Nominatim's usage policy requires one for automated use
export NOMINATIM_EMAIL="you@example.com"
npm run geocode-venues
```

### Run Unit Tests
Runs the test suite verifying HTML selector parsing, date normalization, deduplication, and mock LLM repairs:
```bash
npm run test
```

---

## 📂 Static API Outputs (`dist/`)

When deployed, the project acts as a high-speed CDN API exposing the following JSON endpoints:

- **`index.json`**: Metadata index containing run metrics, statistics, unique artist list, and unique city list.
- **`concerts.json`**: The complete, unfiltered master array of all upcoming concerts.
- **`artists/{artist-slug}.json`**: Filtered concerts for a specific artist (e.g. `artists/the-cure.json`), including their website and socials metadata.
- **`cities/{city-slug}.json`**: Filtered concerts for a specific city (e.g. `cities/berlin.json`).

---

## 🧬 JIT Enrichment & Self-Healing Flow Detail

1. **Daily Scrape**: A cron job runs. If a scraper fails or returns `0` concerts, the HTML sample and error are logged to `reports/fail-log.json`.
2. **Metadata Enrichment**: The scraper checks all incoming concert artist names against the approved list. If an artist has no website or socials, the script groups them into batches and queries the highest-priority model in the cascade to extract official Spotify, Instagram, Facebook, YouTube, Telegram, VK, and website URLs.
3. **Failure Mitigation**: If the main model limits are hit, the model failover cascade seamlessly tries alternative models (`gemini-3.5-flash` ➡️ `gemini-3.1-flash` ➡️ `gemini-2.5-flash` ➡️ `gemini-2.5-flash-lite` ➡️ `gemini-1.5-flash` ➡️ `gemini-1.5-pro`).
4. **LLM Selector Repair**: If failures occurred, the healing workflow calls Gemini to analyze the broken selectors and the cached HTML.
5. **Self-Correction**: Once Gemini returns new CSS selectors, they are tested locally on the cached HTML. If they successfully parse the page, the venue's config under `scrapers/` is updated, committed, and pushed back to the `main` branch.
