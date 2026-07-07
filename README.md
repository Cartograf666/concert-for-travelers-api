# Resilient Self-Healing Concert Scraper & Metadata Enrichment Network

A serverless, **fully autonomous** concert scraping and metadata enrichment network built with **Node.js**, **TypeScript**, **Cheerio/Playwright**, and **Zod**. It aggregates concert data across multiple venues, normalizes artist names and dates, performs JIT (Just-In-Time) social links extraction, and exposes the aggregated data as a free, highly-performant **Static JSON API**.

This repo is backend/data-only — it has no frontend. A separate repository (`concerts-for-travelers`) consumes the published JSON API described below.

Features an automated **Self-Healing Selector Repair** (auto-fixes broken scrapers and auto-merges the fix, no human in the loop) and a robust **Cascading Model Failover Cascade** powered by the Gemini API to keep scrapers functioning even when target websites change their layouts.

---

## 🚀 Key Features

1. **Zero-Ops, Fully Autonomous Architecture**: Runs entirely inside GitHub Actions workflows and deploys statically to GitHub Pages. Requires no traditional databases or running servers, and no manual intervention in the normal case — scrape, heal, and enrichment all run and self-correct on cron.
2. **JIT Artist Metadata & Socials Enrichment**: Automatically detects newly scraped touring artists with missing info and queries Gemini in batches to lookup their official website and social platforms (Spotify, Instagram, Facebook, YouTube, Telegram, and VK). A free, LLM-less MusicBrainz sweep (`enrich-auto.yml`, every 3h) covers the long tail.
3. **Resilient Cascading Failover Cascade**: To bypass API rate limits on free-tier keys, both enrichment and self-healing systems implement a fallback model list:
   `gemini-3.5-flash` ➡️ `gemini-3.1-flash` ➡️ `gemini-2.5-flash` ➡️ `gemini-2.5-flash-lite` ➡️ `gemini-1.5-flash` ➡️ `gemini-1.5-pro`
4. **Artist Whitelist Database**: Employs a pre-downloaded, sanitized catalog of over **62,000+** artists (seeded from a community artist list, enriched via MusicBrainz/Wikidata/Gemini) to whitelist verified touring acts. Matching is tiered (exact → whole-word cover/tribute filter → substring with a minimum-coverage guard and an attached-capitalized-neighbor guard → edit-distance fuzzy fallback) to reject cover/tribute bands and avoid a short whitelist entry absorbing an unrelated title or a fragment of a longer, unapproved artist's name.
5. **Self-Healing CSS Selectors, Auto-Merged**: If a scraper's CSS selector stops returning concerts, an automated flow queries Gemini to analyze the new HTML sample, repairs the selectors, validates them against the cached HTML sample and the full test suite, opens a PR for the audit trail, and **squash-merges it immediately** — no manual review gate.
6. **Multiple Scraper Strategies**: `static_selectors` (Cheerio CSS selectors) and `json_api` cover most venues; `custom_js` (bespoke per-venue modules under `src/engine/custom/`), `jsonld`, `next_data`, and `playwright_render` (headless Chromium) handle sites that need it.
7. **Deploy Safety Net**: A health-gate compares each run's total concert count against a cached baseline and refuses to deploy on a 0-count or >50% drop; an SSRF guard rejects scraper configs targeting localhost/private/link-local/metadata addresses; a circuit breaker skips a domain after 3 consecutive failures instead of hammering it.
8. **Strict Schema Verification**: Uses Zod schemas to validate scraper configurations and outputs before publishing — including rejecting calendar-invalid dates and dropping concerts whose date has already passed — preventing malformed or stale data from reaching the static endpoints.

---

## 📁 Directory Structure

```
├── .github/workflows/
│   ├── daily-scrape.yml        # Daily cron: scrapes, health-gates, publishes, deploys to Pages
│   ├── self-heal.yml           # Triggered after daily-scrape: repairs + auto-merges broken selectors
│   ├── enrich-auto.yml         # Every 3h: free MusicBrainz Tier-0 enrichment sweep
│   ├── enrich-database.yml     # Manual-only: heavier Gemini-search enrichment in chunks
│   └── pr-test.yml             # Validates PR code changes, build, and full test suite
├── scrapers/                   # JSON config files for each venue scraper (~55+)
├── data/
│   └── approved_artists.json   # Approved artist master list (~62k), normalization & socials
├── docs/
│   ├── ADD-VENUE-SCRAPERS.md   # Convention for adding a new venue scraper
│   └── CONCURRENT-SESSIONS.md  # Coordination notes for concurrent AI sessions on this repo
├── src/
│   ├── schemas/
│   │   ├── concert.ts          # Concert Zod schema (dates, lat/lng, socials, web validation)
│   │   └── config.ts           # Scraper configuration Zod schema + SSRF guard
│   ├── engine/
│   │   ├── runner.ts           # Scraper dispatch (static/json_api/custom_js/jsonld/next_data/
│   │   │                       # playwright_render), circuit breaker, retries
│   │   ├── cache.ts            # Per-venue change-detection cache
│   │   ├── structured.ts       # JSON-LD / __NEXT_DATA__ extraction helpers
│   │   └── custom/             # Bespoke per-venue custom_js scraper modules
│   ├── pipeline/
│   │   ├── process.ts          # Artist matching, date parsing, normalization, dedup, past-date filter
│   │   └── enrich.ts           # JIT metadata lookup using Gemini API with failover
│   ├── generator/
│   │   └── publish.ts          # Generates and splits JSON endpoints into /dist
│   ├── healing/
│   │   └── repair.ts           # Self-healing logic with model failover cascade (structured output)
│   ├── scripts/                # One-off/batch maintenance scripts (see `npm run` commands below)
│   ├── run.ts                  # Main entry point orchestrator for scraping
│   └── heal.ts                 # Main entry point orchestrator for self-healing
├── tests/                      # Automated test suite (node --test)
├── tsconfig.json               # TypeScript compiler config
├── package.json
├── ENRICHMENT_RUNBOOK.md       # Agent runbook for the artist-site enrichment swarm
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

### Artist Enrichment Commands
```bash
npm run enrich-auto          # Free MusicBrainz Tier-0 sweep (also runs on a 3h cron)
npm run enrich-wd-bulk       # Bulk Wikidata enrichment pass
npm run enrich-sites         # Swarm-harness commands (select/stats/apply) -- see ENRICHMENT_RUNBOOK.md
```

### Test a Single Scraper Config
Runs one scraper by id against the live site and prints what it extracted, without touching `/dist` or the approved-artist pipeline -- useful when adding or debugging a venue config.
```bash
npm run test-config -- <scraper-id>
```

### Run Unit Tests
Runs the test suite verifying HTML selector parsing, date normalization, artist matching, deduplication, health-gate logic, and mock LLM repairs:
```bash
npm run test
```

---

## 📂 Static API Outputs (`dist/`)

When deployed, the project acts as a high-speed CDN API exposing the following JSON endpoints at `https://cartograf666.github.io/concert-for-travelers-api/`:

- **`index.json`**: Metadata index containing run metrics (`lastRun`, `stats.totalConcerts/uniqueArtists/uniqueCities`), the full unique artist list, and the full unique city list.
- **`concerts.json`**: The complete master array of all upcoming (never past-dated) concerts.
- **`artists/{artist-slug}.json`**: Concerts for a specific artist (e.g. `artists/the-cure.json`), sorted by date, including their website and socials metadata.
- **`cities/{city-slug}.json`**: Concerts for a specific city (e.g. `cities/berlin.json`), sorted by date. Stale per-slug files from artists/cities no longer touring are pruned each run.

Each concert object follows `src/schemas/concert.ts`: `artist`, `artistWebsite?`, `artistSocials?` (spotify/instagram/facebook/youtube/telegram/vk), `date` (`YYYY-MM-DD`), `venue`, `city`, `country` (ISO 3166-1 alpha-2), `lat?`/`lng?`, `ticketUrl?`, `originalSource`, `scrapedAt`.

---

## 🧬 JIT Enrichment & Self-Healing Flow Detail

1. **Daily Scrape**: A cron job (also manually triggerable) runs every scraper, applies artist matching + date parsing + normalization + past-date filtering, and health-gates the result (refuses to deploy on a 0-count or >50% drop vs. the cached baseline) before publishing to `/dist` and deploying to GitHub Pages. If a scraper fails or returns `0` concerts, the HTML sample and error are logged to `reports/fail-log.json` and uploaded as a workflow artifact.
2. **Metadata Enrichment**: The scraper checks all incoming concert artist names against the approved list. If an artist has no website or socials, the script groups them into batches and queries the highest-priority model in the cascade to extract official Spotify, Instagram, Facebook, YouTube, Telegram, VK, and website URLs. A separate free MusicBrainz-only sweep runs every 3 hours to cover the long tail without spending LLM quota.
3. **Failure Mitigation**: If the main model limits are hit, the model failover cascade seamlessly tries alternative models (`gemini-3.5-flash` ➡️ `gemini-3.1-flash` ➡️ `gemini-2.5-flash` ➡️ `gemini-2.5-flash-lite` ➡️ `gemini-1.5-flash` ➡️ `gemini-1.5-pro`), short-circuiting past the whole cascade on an auth/quota error instead of burning every model's rate limit.
4. **LLM Selector Repair**: Once the Daily Scrape workflow completes, the Self-Healing Pipeline downloads its fail-log artifact. If there are failures, it calls Gemini (structured output, restricted to selector fields only -- venue/city/country fallbacks can never be LLM-controlled) to analyze the broken selectors and the cached HTML.
5. **Self-Correction, Auto-Merged**: The repaired selectors are tested against the cached HTML sample and the full test suite. If they pass, the venue's config under `scrapers/` is updated on a fresh branch, opened as a PR (for the audit trail/diff visibility), and **immediately squash-merged** -- no manual review step blocks the fix from taking effect.
6. **Concurrent-write safety**: `main` receives commits from several independent jobs (daily-scrape's own enrichment commit, both enrich-* workflows, self-heal's auto-merge). Every auto-commit step retries with a fetch+rebase on a push rejection instead of failing the whole job.
