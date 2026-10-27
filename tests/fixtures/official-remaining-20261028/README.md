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
