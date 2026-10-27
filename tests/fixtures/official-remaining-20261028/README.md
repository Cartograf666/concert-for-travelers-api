# King Gizzard continuation — current package

This continuation supersedes the original five-source access gap for three dates:
Radiant9June, Sequoie11June and Apollo20June now have guarded live extraction.
Manchester22June and Bristol23June have a fresh normal Bandsintown response,
explicitly an aggregator rather than independent official evidence.

New configs/modules: `artist-king-gizzard-{radiant,sequoie,apollo}` in the normal
artist loader. Venue/organizer URLs and captured-input SHA-256 are in
`organizer-rescue-provenance.json`; Now Wave/Gigantic returned403, no repeat/bypass.
`king-primary-live.json`: separate normal live runner run, three raw→three accepted
by real artist DB. `king-bit-runtime.json`: exactly one normal collector call,
maxPerRun1, fresh isolated empty cache,11raw events, healthy1attempt/0fallbacks;
native response and endpoint recorded without app key. Its `isolatedCache` is
evidence only, never read by runtime or injected into shared caches.
`king-target-recovery.json` maps five target rows to three primary/two BIT raw rows.

Run offline regressions with:

```sh
SCRAPER_ALLOW_LOCAL_HOSTS=1 node --import tsx --test tests/king_gizzard_primary_20261028.test.ts tests/king_gizzard_bit_replay_20261028.test.ts tests/official_remaining_coverage_20261028.test.ts
```

The BIT test replays captured native input through the actual default collector,
real read-only artist DB, dedup and publisher into a temporary directory. It asserts
five exact aggregator targets and canonical artist identity. It makes no live call.
The optional `capture-king-bit.ts` makes one scoped fresh call; do not dispatch it as
a second artist sweep. `verify-king-live.ts` rechecks only three primary sources.

Root owns final40-replay and recurring priority/daily integration. A local probe
confirmed35primary+5BIT covers all40 after publisher. Adding three primary configs
provides38primary source observations; current shared dedup retains BIT as winner
for Sequoie/Apollo and keeps Caluire/Lyon variants separate, resulting in36primary/
4BIT *output provenance*,77total rows. This package makes no shared dedup change or
claim of38primary publisher rows. Full probe evidence is in the coordinator report.
The older files/notes below preserve the initial6/11 package, not current gaps.

---

# Official remaining coverage recovery — 28 October 2026 (MSK)

Scope: five assigned artists / eleven exact rows copied from the authoritative
`reports/coverage-20261028/confirmed-missing.csv`. Runtime parsers never read this
folder. Six target dates have live automatic extraction; five King Gizzard targets
remain source-blocked. No hardcoded date list, cache import or registry exemption.

## Source ownership and normal discovery

Each config lives in `scrapers/artists/<id>.json`, each implementation in
`src/engine/custom/<id>.ts`. `loadConfigs('scrapers/artists')` discovers all five,
so the existing artist scrape → artist cache → daily process route picks them up.

| Config ID | Owner / actual public URL | Target dates |
| --- | --- | --- |
| artist-iron-maiden | Artist: https://www.ironmaiden.com/tour/run-for-your-lives-north-american-tour-2027/ | 2027-05-14, 2027-05-16 |
| artist-the-bluetones | Artist: https://bluetones.band/live/ | 2027-05-08 |
| artist-matthew-good-cn-centre | Municipality / CN Centre: https://www.princegeorge.ca/community-culture/arts-events/events-calendar/matthew-good-and-his-band-i-mother-earth | 2026-12-15 |
| artist-muse-eurockeennes | Festival organizer: https://www.eurockeennes.fr/ | 2027-07-05 |
| artist-muse-vieilles-charrues | Festival organizer: https://www.vieillescharrues.asso.fr/ | 2027-07-15 |

Iron Maiden: dated native tour rows, region-separated city/country; supports never
become headliners. Bluetones: exact preceding gigpress artist heading scopes out
The Bluetones (Acoustic), even on the same page. Matthew: exact event bill and
native ISO date/time, with CN Centre identity and city-owned venue geography.
Charrues: Muse's own card gives day/month; the site title gives edition year.
Eurocks: organizer's current news title explicitly associates Muse with its exact
performance day, rather than the separate festival window/publication date.
Missing identity/date, impossible dates and relevant cancellation markers fail
closed. Source profile links never become invented event links.

`muse.html` is negative discovery evidence: the artist tour page contains a BIT
widget rather than a native schedule. Runtime uses organizer sources instead.
`provenance.json` contains captured-input hashes, URLs and request backend.
`live-output.json` is a separate fresh normal-runner extraction, with all 31 raw
rows accepted by unchanged process against the real read-only `data/artists` DB.
`target-recovery.csv` reconciles the 11-row expectation with this output: 6
recovered, 5 source-blocked. Venue labels/cities remain as printed in the sources;
expected CSV labels are preserved in separate columns. The six matches use exact
artist/calendar-day/country, with manually checked same festival/venue identity.

## Checks / reproduction

Offline real runner test (loopback server is fixture transport, never production):

```sh
SCRAPER_ALLOW_LOCAL_HOSTS=1 node --import tsx --test tests/official_remaining_coverage_20261028.test.ts
npm run build
npm run lint
```

Opt-in scoped live verification (only five configured public pages; no sweeps,
shared cache writes, artist DB mutation or publication):

```sh
node --import tsx tests/fixtures/official-remaining-20261028/verify-live.ts
```

Opt-in recapture of the five positive HTML fixtures (replaces fixtures/manifest):

```sh
node --import tsx tests/fixtures/official-remaining-20261028/capture.ts
```

## Remaining access gap

King Gizzard dates 9/11/20/22/23 June 2027 were seen in the public Ticketmaster UK
artist listing by the web reader; direct guarded HTTP was 403 (both installed
backends). The existing guarded Playwright renderer received an identity challenge.
No CAPTCHA/auth/network bypass was attempted, and challenge HTML is not retained.
The artist's `/shows` page timed out; the web reader saw an empty shell.

Following the five known source event links once did not provide usable HTML:
Universe London `2XB3KF` and Manchester `KD6LPH` returned 405; Ticketmaster UK Bristol
`1F00655950B240B6`, FR `676920/4445648`, IT `j73csjab34p6` returned 403. Full URLs,
request times and errors are in `direct-source-provenance.json`. No unknown parser
or unreliable config is shipped for these blocked pages. A working venue/organizer
schedule or approved public access remains required for independent-source
recovery of those five dates. Fresh BIT is a separate root-owned collection path;
this package neither repeats its sweep nor claims BIT as an independent primary.

Full shared cache/dedup/publisher replay and any release remain root-owned.
