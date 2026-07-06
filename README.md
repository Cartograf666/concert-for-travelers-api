# Community-Driven Self-Healing Concert Scraper Network

A serverless, zero-maintenance concert scraping network built with Node.js, TypeScript, Cheerio, and Zod. It aggregates concert data across venues, normalizes artist names and dates, and exposes the aggregated data as a free, highly-performant Static JSON API. It features self-healing capabilities powered by the Gemini API to fix broken scrapers automatically when website layouts change.

## 🚀 Key Features

1. **Zero-Ops Infrastructure**: Fully runs inside GitHub Actions and deploys to GitHub Pages as static JSON. No traditional databases needed.
2. **Community-Driven**: New venues/scrapers and artists can be added by simply making a Pull Request modifying `scrapers/` or `data/approved_artists.json`.
3. **Self-Healing**: If a scraper's CSS selector fails, a post-scrape job calls the Gemini API (`gemini-2.5-flash`) to analyze the new HTML layout, corrects the selectors, tests them locally, and automatically pushes the fix back to the `main` branch.
4. **Strict Schema Validation**: Uses Zod to validate configs and outputs before publishing, preventing corrupted data from entering the static endpoints.

---

## 📁 Directory Structure

```
├── .github/workflows/
│   ├── daily-scrape.yml        # Cron job running every day at 03:00 UTC
│   ├── self-heal.yml           # Runs after daily-scrape to fix broken selectors
│   └── pr-test.yml             # Validates scrapers and code changes on PRs
├── scrapers/                   # JSON config files for each scraped venue/club
├── data/
│   └── approved_artists.json   # Approved artist master list for normalization
├── src/
│   ├── schemas/
│   │   ├── concert.ts          # Concert Zod schema
│   │   └── config.ts           # Scraper configuration Zod schema
│   ├── engine/
│   │   └── runner.ts           # Axios and Cheerio scraper core execution
│   ├── pipeline/
│   │   └── process.ts          # Normalization, relative-date parsing, deduplication
│   ├── generator/
│   │   └── publish.ts          # Generates and splits JSON files into /dist
│   ├── healing/
│   │   └── repair.ts           # Self-healing logic using @google/generative-ai
│   ├── run.ts                  # Entry CLI orchestrator for scraping
│   └── heal.ts                 # Entry CLI orchestrator for self-healing
├── tests/                      # Automated test suite
└── package.json
```

---

## 🛠️ Local Development & Commands

### Prerequisites
- Node.js v20+
- A Gemini API Key (for self-healing)

### Installation
```bash
npm install
```

### Compile Code
```bash
npm run build
```

### Run Scraper
This executes all scrapers in the `scrapers/` folder, processes results, outputs static endpoints to `dist/`, and writes failures to `reports/fail-log.json`.
```bash
npm run scrape
```

### Run Self-Healing Locally
If you have a `reports/fail-log.json` file and a Gemini API Key, you can execute the healer locally:
```bash
export GEMINI_API_KEY="your-gemini-api-key"
npm run heal
```

### Run Tests
Runs the test suite verifying parser extraction, date parsing, deduplication, and mock LLM repairs using Node.js's native test runner.
```bash
npm run test
```

---

## 📂 Static API Outputs (`dist/`)

The following files are published under the `dist/` directory (serving as a high-speed CDN API):

- **`index.json`**: Metadata index containing run metrics, statistics, unique artist list, and unique city list.
- **`concerts.json`**: The complete, unfiltered master array of all concerts.
- **`artists/{artist-slug}.json`**: Filtered concerts for a specific artist (e.g. `artists/the-cure.json`).
- **`cities/{city-slug}.json`**: Filtered concerts for a specific city (e.g. `cities/berlin.json`).

---

## 🧬 Self-Healing Flow Detail

1. **Daily Scrape**: A cron job runs. If a scraper config returns `0` concerts or crashes, it is logged to `reports/fail-log.json` alongside a captured HTML sample of the page.
2. **Failure Detected**: The self-healing workflow is triggered if `reports/fail-log.json` is not empty.
3. **LLM Selector Repair**: The healer calls the Gemini API (`gemini-2.5-flash`), providing it with the broken configuration and the updated HTML sample.
4. **Validation Test**: The new selectors returned by Gemini are tested locally on the cached HTML sample.
5. **Auto-Commit**: If the test successfully extracts concerts, the JSON config file under `scrapers/` is overwritten, and the action automatically commits and pushes the fix back to the repository.
