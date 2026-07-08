# Backlog

Living backlog for the concert-data API. Backend/data-only repo — a separate
app (`concerts-for-travelers`) consumes the published JSON.

**North-star user flow (consumer app):**
User adds the artists they love → enters vacation date windows → app returns
which concerts they can attend, and where. This repo's job is to feed that flow
with data rich enough to (1) **match** the user's artists reliably, (2) **place**
each concert in space and time, and (3) **rank** the options.

Legend: ✅ done · 🚧 in progress · ⬜ planned · 💡 idea

---

## ✅ Done

- **Concert sources**: venue scrapers (91 configs), Ticketmaster (27 countries),
  Bandsintown (artist-keyed, worldwide — covers Asia/Japan and RU artists).
- **Static JSON API on GitHub Pages**: `concerts.json`, `artists/{slug}.json`,
  `cities/{slug}.json`, `index.json`, `status.json`, dashboard `index.html`.
- **Per-concert data**: artist, artistWebsite, artistSocials (spotify/instagram/
  facebook/youtube/telegram/vk), date (YYYY-MM-DD), venue, city, country (ISO2),
  lat/lng (optional), ticketUrl, originalSource, scrapedAt.
- **Self-healing scrapers**: broken CSS selectors auto-repaired via Gemini,
  validated, PR'd, and squash-merged with no human gate. JSON-LD fast-path before
  ever calling the LLM.
- **Artist whitelist DB**: ~63.5k artists, tiered name-matching (exact → cover/
  tribute filter → coverage-guarded substring → fuzzy). Socials on ~27k, enriched
  via MusicBrainz (2.7k) + Wikidata-bulk (23.6k).
- **Self-growing target list**: `discover-artists` (weekly) pulls live charts →
  Deezer + Last.fm (+738 worldwide). Target list 1424 → 2204. Spotify dropped
  (free tier blocks Web API).
- **Multi-key Gemini failover**: rotate to the next key
  (`GEMINI_API_KEY`, `_RESERV1/2`, `_2.._10`, `GEMINI_API_KEYS`) once every model
  on the current key is quota/auth-exhausted. Covers enrich + self-heal + run.
  → `src/engine/gemini_keys.ts`.

---

## 🚧 In progress

### Bandsintown coverage gap (client measured ~60% loss vs a live-only fetch)
Consumer app's own compare-script measured concerts present in this repo's
publish output but missing when it fetches Bandsintown live itself, ~60% for
spot-checked artists (AC/DC, A Day To Remember — both already in
`data/artist_scrape_targets.txt`). Root cause confirmed against this repo, not
the client: `artist-scrape.yml`'s Bandsintown sweep ran **weekly** at
800/2205 targets per run (~3-week full cycle) — an artist can sit stale for
weeks before its next fetch.

Plan (sequenced; don't touch the client/cut the server until the gate at the
end passes):
1. ✅ Cron `weekly -> daily` (`.github/workflows/artist-scrape.yml`).
   2205/800 ≈ 3-day initial backlog fill; steady-state throughput (~367/day
   for a 6-day freshness window, `DEFAULT_FRESHNESS_DAYS` in
   `src/engine/bandsintown.ts`) comfortably inside the 800/day cap — daily is
   sufficient, not overkill. Repo is public, so GH Actions minutes are free;
   no cost concern.
2. ✅ Dedupe case-variant duplicates in `data/artist_scrape_targets.txt`:
   2205 → 2126 (78 case-variant duplicates removed, e.g. "A Day to Remember"/
   "A Day To Remember"/"a day to remember" all counted as 3 separate
   Bandsintown fetch slots for one real artist, since
   `fetchBandsintownConcerts`'s own de-dupe is case-sensitive). →
   `src/scripts/clean_scrape_targets.ts`, run against the live target list.
3. ⬜ **Blocked on the user.** Point official tour-page scrapers
   (`scrapers/artists/*.json` — more reliable than the public Bandsintown
   widget feed, no rate-limit/block risk) at the artists users actually search
   for most. Needs a top-N-by-query-volume list from the consumer app's own
   usage data; not available in this repo.
4. ⬜ **Needs real elapsed time.** Let the new daily cron run 1-2 real cycles
   (at least one 6-day freshness window) before re-measuring.
5. ⬜ **Needs the client repo's tooling.** Re-run the consumer app's
   compare-script against fresh data.
6. ⬜ Decision gate: gap down to ~10-15% or less → cut the server, client
   moves to plain static fetch. Still high → the problem is coverage (missing
   scrapers/targets), not cron frequency — expand step 3, don't re-tune cron.

---

## ⬜ Planned — data richness roadmap

Ordered by leverage on the north-star flow. **Constraint: free sources only —
no Spotify API (paid tier unavailable).** Sourcing noted per item.

### Tier 0 — cleanup (quick)
- ⬜ **Filter genre/place-name noise out of artist names.** `Alternative rock`,
  `Amsterdam`, `Anonymous`, `Area` leak into the published artist index and
  pollute matching. Extend `data/artist_denylist.json` + a stop-list guard.

### Tier 1 — make matching work (identity)
- ⬜ **Canonical artist IDs on every concert: `spotifyId` + `mbid`.**
  *Highest-leverage item.* Neither needs a paid API:
  - `spotifyId` — **parsed from the `socials.spotify` URL we already store**
    (`open.spotify.com/artist/<ID>`). No Spotify API call.
  - `mbid` — from the existing MusicBrainz enrichment.
  Lets the consumer app match loved artists **by ID** instead of fragile strings.
  → schema `src/schemas/concert.ts`, populate in `src/pipeline/process.ts`.
- ⬜ **Guaranteed geocoding — lat/lng on every concert, not optional.**
  "Near where I'll be" breaks when coordinates are missing. Geocode step with a
  persistent cache (free geocoder). → `src/pipeline/process.ts`.

### Tier 2 — ranking & recommendations
- ⬜ **Published artist metadata catalog: `dist/artists.json`** — keyed by artist
  ID: name, aliases, genres, image, popularity, socials. Consumer loads it once
  and joins to concerts by ID; keeps per-concert files lean. Also becomes the
  full artist directory for the app's "add the artists you love" autocomplete
  (today `index.json` only lists artists that already have concerts).
- ⬜ **Genres/tags per artist** — "similar to what I love".
  *Source:* Last.fm `artist.getTopTags` / `artist.getInfo` (connected) +
  MusicBrainz tags. No Spotify.
- ⬜ **Popularity signal** — rank many options.
  *Source:* Last.fm `listeners` + `playcount` from `artist.getInfo`. No Spotify.
- ⬜ **Artist image / thumbnail** — small preview for the consumer app UI.
  *Source:* Deezer artist `picture_small/medium` (free, no key, already used for
  discovery); Ticketmaster attraction image as fallback. (Last.fm images are
  deprecated/placeholder — don't use.)

### Tier 3 — richer events
- ⬜ **Event time** (doors/start), not just the date.
- ⬜ **Festival awareness**: festival name **+ festival URL (name as a link)** +
  lineup / support acts. One festival = many artists = one trip — big for
  "I love 3 of these 30 acts".
- ⬜ **Venue kind** instead of a full address: `stadium` / `arena` / `club` /
  `open-air`, etc. Infer from venue-name keywords + Ticketmaster venue type.
- 💡 **Price** — best-effort only. Add if a source exposes it cleanly
  (Ticketmaster priceRanges); skip otherwise. Not a priority.

### Tier 4 — dropped
- ❌ Nearest airport (IATA) — not needed.
- ❌ Full venue address — not needed (replaced by "venue kind" above).

---

## 💡 Ideas / parking lot

- 💡 Publish a lightweight changelog feed (`dist/changes.json`) so the consumer
  can show "newly announced since your last visit".
- 💡 Deduplicate the same show scraped from multiple sources (venue + Ticketmaster
  + Bandsintown) into one canonical concert with merged ticket links.
- 💡 Currency-normalized price + affiliate ticket links.

---

## Conventions

- One line per item, prefixed with a status emoji. Move items between sections as
  they progress; don't delete — a done item is the record that it shipped.
- When an item ships, note the touch-point file(s) so the history stays traceable.
