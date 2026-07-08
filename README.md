# 🎸 Concert For Travelers — API

[![Daily Concert Scrape](https://github.com/Cartograf666/concert-for-travelers-api/actions/workflows/daily-scrape.yml/badge.svg)](https://github.com/Cartograf666/concert-for-travelers-api/actions/workflows/daily-scrape.yml)
[![PR Verification](https://github.com/Cartograf666/concert-for-travelers-api/actions/workflows/pr-test.yml/badge.svg)](https://github.com/Cartograf666/concert-for-travelers-api/actions/workflows/pr-test.yml)
[![Static API](https://img.shields.io/badge/API-static%20JSON-blue)](https://cartograf666.github.io/concert-for-travelers-api/)

> A fully autonomous, self-healing pipeline that scrapes concerts from 90+
> venues, Ticketmaster, Bandsintown, and Eventbrite; matches them against a 63,000+
> artist whitelist; enriches artist metadata via free structured sources and
> Gemini; and publishes it all as a free static JSON API. Zero servers,
> zero manual intervention in the normal case.

This repo is **backend/data-only** — no frontend. A separate app,
[`concerts-for-travelers`](https://github.com/Cartograf666/concerts-for-travelers),
consumes the JSON published here to answer one question: *"Which of the
artists I love are playing where I'll be, and when?"*

---

## Table of Contents

- [Data Sources](#data-sources)
- [Key Features](#key-features)
- [Static API Outputs](#static-api-outputs-dist)
- [Directory Structure](#directory-structure)
- [Local Development & Commands](#local-development--commands)
- [Enrichment & Self-Healing Flow](#enrichment--self-healing-flow-detail)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Data Sources

| Source | Coverage | Cadence | Notes |
|---|---|---|---|
| **Venue scrapers** | 91 configs, per-venue | Daily | `static_selectors`, `json_api`, `custom_js`, `jsonld`, `next_data`, `playwright_render` — whichever fits the site; self-healing keeps them alive. |
| **Ticketmaster Discovery API** | 27 countries | Daily | Broad additive sweep; also surfaces festivals (multi-attraction events). |
| **Bandsintown** | Worldwide, artist-keyed | Daily, batched | The only source with real reach into markets the others miss (Japan, Russia, ...). Public widget feed — polite pacing, cache-backed, self-throttles on any sign of blocking. |
| **Eventbrite** | US, artist-keyed | Daily, batched | Public discovery-page scrape (no third-party events-search API exists anymore) — leading-name relevance filter cuts the noise of a full-text search. See [BACKLOG.md](BACKLOG.md) for the ToS-risk tradeoff this accepts. |
| **Artist tour-page scrapers** | 5 configs today | Weekly | Official tour pages for specific artists — most reliable per-artist source, added by hand. |
| **`discover-artists`** | Deezer + Last.fm charts | Weekly | Self-growing target list: pulls live global + per-genre/per-country charts so the artists being tracked keep pace with what's actually popular, without a human curating it. |

Every raw event — regardless of source — goes through the same
[approved-artist whitelist](#key-features), date normalization, and
deduplication pipeline before publishing.

---

## Key Features

1. **Zero-Ops, Fully Autonomous Architecture** — runs entirely inside GitHub Actions and deploys statically to GitHub Pages. No database, no server, no manual intervention in the normal case: scrape, discover, enrich, heal, and publish all run and self-correct on cron.
2. **Layered, Free-First Artist Enrichment Cascade** — website + socials (Spotify/Instagram/Facebook/YouTube/Telegram/VK) are filled in via, in order of cost: a bulk Wikidata SPARQL sweep (~80 names/query), a per-artist MusicBrainz + Wikidata pass, and only then Gemini for the remaining long tail — so the vast majority of the ~63,000-artist whitelist gets enriched with zero LLM spend.
3. **Multi-Key Gemini Failover** — both enrichment and self-healing rotate through every configured key (`GEMINI_API_KEY`, `_2.._10`, `_RESERV1..10`, or a bulk `GEMINI_API_KEYS` list) and a model cascade (Gemma → Gemini Flash tiers), moving to the next key only once every model on the current one is quota/auth-exhausted — multiplying the free-tier daily budget with zero code changes beyond adding a secret.
4. **Tiered Artist Whitelist Matching** — exact match → whole-word cover/tribute-band filter → coverage-guarded substring match (with an attached-capitalized-neighbor guard so a short entry can't absorb a fragment of a longer, unapproved name) → edit-distance fuzzy fallback. Tuned against real production false-positives/negatives, not just happy-path cases.
5. **Self-Healing CSS Selectors, Auto-Merged** — when a scraper stops returning concerts, an automated flow asks Gemini (structured output, restricted to selector fields — never the venue/city/country fallbacks) to repair it, validates the fix against the cached HTML and the full test suite, opens a PR for the audit trail, and **squash-merges it immediately**. No human in the loop.
6. **Multiple Scraper Strategies** — `static_selectors` and `json_api` cover most venues; `custom_js`, `jsonld`, `next_data`, and `playwright_render` (headless Chromium) handle the rest. A `static_selectors` config auto-recovers via JSON-LD if its selectors ever match zero events.
7. **Deploy Safety Net** — a health-gate refuses to publish on a 0-count or >50% drop vs. the cached baseline; an SSRF guard rejects scraper configs targeting localhost/private/link-local/metadata addresses; a per-domain circuit breaker stops hammering a site after 3 consecutive failures; a freshness watchdog opens a GitHub issue if a scheduled run silently stops firing.
8. **Strict Schema Verification** — every concert is validated against a Zod schema before publishing, including rejecting calendar-invalid dates (e.g. a day/month mix-up) and dropping concerts whose date has already passed.

---

## Static API Outputs (`dist/`)

Deployed to `https://cartograf666.github.io/concert-for-travelers-api/`:

- **`index.json`** — `schemaVersion` (bump on a Concert-shape change worth a consumer noticing), run metrics (`lastRun`, `stats.totalConcerts/uniqueArtists/uniqueCities`), the full unique artist list, and the full unique city list.
- **`concerts.json`** — the complete master array of all upcoming (never past-dated) concerts.
- **`artists/{artist-slug}.json`** — concerts for one artist (e.g. `artists/the-cure.json`), sorted by date.
- **`cities/{city-slug}.json`** — concerts for one city (e.g. `cities/berlin.json`), sorted by date. Stale per-slug files for artists/cities no longer touring are pruned every run.
- **`status.json`** — machine-readable health surface (scrapers ok/failed, stale venues, ticketmaster event count, `conflictDropsLast7Days` — see [Known limitations](#known-limitations)) for the dashboard and the freshness watchdog.
- **`changes.json`** — concerts new since the last run (30-day rolling window), so the consumer can show "N new concerts since your last visit" without diffing all of `concerts.json` itself.

Each concert object follows `src/schemas/concert.ts`: `artist`, `artistWebsite?`, `spotifyId?`, `mbid?`, `artistSocials?` (spotify/instagram/facebook/youtube/telegram/vk), `date` (`YYYY-MM-DD`), `startTime?` (`HH:MM`), `venue`, `venueKind?` (stadium/arena/club/theatre/hall/open-air/other), `city`, `country` (ISO 3166-1 alpha-2), `lat?`/`lng?`, `festival?` (`{name, url?}`), `lineup?`, `priceRange?` (`{min, max, currency}`, Ticketmaster only), `ticketUrl?`, `originalSource`, `scrapedAt`.

---

## Directory Structure

```
├── .github/workflows/
│   ├── daily-scrape.yml        # Daily cron: scrapes venues + Ticketmaster, health-gates, publishes, deploys to Pages
│   ├── artist-scrape.yml       # Daily cron: artist tour-page configs + the Bandsintown + Eventbrite sweeps
│   ├── discover-artists.yml    # Weekly cron: grows the target list from live Deezer/Last.fm charts
│   ├── self-heal.yml           # Triggered after daily-scrape: repairs + auto-merges broken selectors
│   ├── enrich-auto.yml         # Every 3h: free MusicBrainz Tier-0 enrichment sweep
│   ├── enrich-database.yml     # Manual-only: Wikidata bulk pass + heavier Gemini-search enrichment
│   ├── freshness-watchdog.yml  # Independent check that a successful daily run happened recently
│   └── pr-test.yml             # Validates PR code changes, build, and full test suite
├── scrapers/                   # JSON config files for each venue scraper (91)
│   └── artists/                # Artist tour-page scraper configs (5) -- see docs/ADD-VENUE-SCRAPERS.md
├── data/
│   ├── approved_artists.json   # Approved artist whitelist (63,000+), normalization & socials
│   ├── artist_scrape_targets.txt # Self-growing artist target list for discover-artists/Bandsintown/Eventbrite
│   └── artist_denylist.json    # Genre/language/generic terms that must never whitelist-match
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
│   │   ├── ticketmaster.ts     # Ticketmaster Discovery API sweep (27 countries)
│   │   ├── bandsintown.ts      # Bandsintown worldwide artist-keyed sweep
│   │   ├── eventbrite.ts       # Eventbrite artist-keyed discovery-page scrape (US)
│   │   ├── cache.ts            # Per-venue change-detection cache
│   │   ├── structured.ts       # JSON-LD / __NEXT_DATA__ extraction helpers
│   │   ├── gemini_keys.ts      # Multi-key Gemini rotation for enrichment + self-heal
│   │   └── custom/             # Bespoke per-venue custom_js scraper modules
│   ├── pipeline/
│   │   ├── process.ts          # Artist matching, date parsing, normalization, dedup, past-date filter
│   │   └── enrich.ts           # JIT metadata lookup using Gemini API with failover
│   ├── generator/
│   │   └── publish.ts          # Generates and splits JSON endpoints into /dist
│   ├── healing/
│   │   └── repair.ts           # Self-healing logic with model failover cascade (structured output)
│   ├── scripts/                # One-off/batch maintenance scripts (see `npm run` commands below)
│   ├── run.ts                  # Main entry point orchestrator: daily venue + Ticketmaster scrape
│   ├── run-artists.ts          # Entry point orchestrator: artist tour-pages + Bandsintown + Eventbrite sweeps
│   └── heal.ts                 # Main entry point orchestrator for self-healing
├── tests/                      # Automated test suite (node --test)
├── BACKLOG.md                  # Living roadmap -- what's done, in progress, and planned
├── ENRICHMENT_RUNBOOK.md       # Agent runbook for the artist-site enrichment swarm
├── tsconfig.json
└── package.json
```

---

## Local Development & Commands

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
Runs every venue scraper + the Ticketmaster sweep, merges in whatever the artist-scrape job last cached, runs JIT social/website enrichment, writes results to `/dist`, and logs failure reports to `reports/fail-log.json`.
```bash
# Optional: set a Gemini key for enrichment
export GEMINI_API_KEY="your-gemini-key"

npm run scrape
```

### Run the Artist Tour-Page + Bandsintown + Eventbrite Sweep
```bash
npm run scrape-artists
```

### Run Self-Healing Locally
If you have a `reports/fail-log.json` file and a Gemini API Key:
```bash
export GEMINI_API_KEY="your-gemini-key"
npm run heal
```

### Grow the Artist Target List
Pulls live Deezer (keyless) + Last.fm (optional `LASTFM_API_KEY`) charts and appends never-seen popular artists to `data/artist_scrape_targets.txt`.
```bash
npm run discover-artists
```

### Clean the Artist Database
```bash
npm run clean-artists       # typographic noise, case-insensitive dupes, invalid HTML tags
npm run clean-denylist      # removes genre/language/generic terms that slipped into the whitelist
```

### Sync Target Artists Into the Whitelist
A name added to `data/artist_scrape_targets.txt` must also be in `data/approved_artists.json` or its scraped/Bandsintown/Eventbrite shows get dropped as "not approved" -- idempotent, only adds what's missing.
```bash
npm run add-targets
```

### Geocode Venue Coordinates
One-off batch script: geocodes each scraper's fixed venue (name + city + country) via the free OpenStreetMap/Nominatim provider and caches the resulting `lat`/`lng` in the scraper's own JSON config. Skips artist tour-page scrapers (per-row venue, no single fixed coordinate) and configs that already have coordinates.
```bash
export NOMINATIM_EMAIL="you@example.com" # Nominatim's usage policy requires a contact for automated use
npm run geocode-venues
```

### Artist Enrichment Commands
```bash
npm run enrich-auto          # Free MusicBrainz Tier-0 sweep (also runs on a 3h cron)
npm run enrich-wd-bulk       # Bulk Wikidata SPARQL enrichment pass
npm run enrich-sites         # Swarm-harness commands (select/stats/apply) -- see ENRICHMENT_RUNBOOK.md
```

### Audit Rejected Artist Names
Reports raw artist names the scrape cache saw that didn't match the approved whitelist, so a genuinely-missing artist (vs. real noise) is easy to spot and add to the target list.
```bash
npm run audit-gaps
```

### Test a Single Scraper Config
Runs one scraper by id against the live site and prints what it extracted, without touching `/dist` or the approved-artist pipeline.
```bash
npm run test-config -- <scraper-id>
```

### Run Unit Tests
Verifies HTML selector parsing, date normalization, artist matching, deduplication, health-gate logic, and mock LLM repairs:
```bash
npm run test
```

---

## Enrichment & Self-Healing Flow Detail

1. **Daily Scrape**: runs every venue scraper + the Ticketmaster sweep, merges in the artist-scrape job's last cached results (tour-pages + Bandsintown + Eventbrite), applies artist matching + date parsing + normalization + past-date filtering, and health-gates the result before publishing to `/dist` and deploying to GitHub Pages. A failed or empty-result scraper has its HTML sample and error logged to `reports/fail-log.json`.
2. **Free-First Metadata Enrichment**: new artists are enriched in cost order — a bulk Wikidata SPARQL sweep first (fast, ~80 names/query), then a per-artist MusicBrainz + Wikidata pass every 3 hours, and only the remaining long tail goes to Gemini in batches for website + socials.
3. **Multi-Key, Multi-Model Failover**: enrichment and self-healing both rotate through every configured Gemini key and a Gemma/Gemini-Flash model cascade, moving to the next key only once every model on the current one is quota/auth-exhausted.
4. **LLM Selector Repair**: once the Daily Scrape completes, the Self-Healing Pipeline downloads its fail-log artifact and, for each failure, asks Gemini (structured output, selector fields only) to analyze the broken selectors against the cached HTML.
5. **Self-Correction, Auto-Merged**: repaired selectors are tested against the cached HTML sample and the full test suite. If they pass, the venue's config is updated on a fresh branch, opened as a PR (for the audit trail), and **squash-merged immediately** — no manual review gate.
6. **Freshness Watchdog**: independently verifies a successful daily run happened recently and opens a deduplicated GitHub issue if the schedule silently stopped firing, a run hung, or a run was skipped.
7. **Concurrent-Write Safety**: `main` receives commits from several independent jobs (daily-scrape's own enrichment commit, both enrich-* workflows, self-heal's auto-merge). Every auto-commit step retries with a fetch+rebase on a push rejection instead of failing the whole job.

---

## Known Limitations

- **`data/approved_artists.json` is a single shared file with multiple writers**, coordinated by git-push-retry rather than a real transaction. `enrich-auto`/`enrich-database`/`daily-scrape` share the `artist-db-write` concurrency group (GitHub queues them, so they don't literally run in parallel), but an unresolvable rebase conflict against some *other* push to `main` still occasionally makes a writer drop its own commit rather than fail the job. No data is lost (the affected artists just stay pending and get retried next run), but it's wasted API/compute for that attempt. Tracked in `data/conflict-drops.json` (via `npm run record-conflict-drop`) and surfaced as `status.json`'s `conflictDropsLast7Days` / the dashboard — watch for a climbing count.
- **No hard schema-compatibility gate.** `index.json`'s `schemaVersion` is a signal ("something about the Concert shape changed, go check `src/schemas/concert.ts`"), not an enforced contract — every change so far has been additive, so an old consumer that ignores unknown fields is unaffected either way.

---

## Roadmap

[`BACKLOG.md`](BACKLOG.md) is the living roadmap — what's shipped, what's in
progress, and what's planned next, each item noting its touch-point files so
the history stays traceable.

---

## License

ISC (see `package.json`). No formal `LICENSE` file yet.
