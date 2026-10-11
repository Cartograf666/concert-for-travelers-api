# Coverage and freshness audit — 2026-10-10

Local audit recorded at 2026-10-10T20:22:14Z against base
`9624768a1b0871afec341ac20514fb6b98cb14c5`. This is a dated observation and
capacity calculation, not a scheduler change or deployment receipt.

## Inputs and identity

Published artifacts supplied by the coordinator, read locally without a new
provider request:

| Input | Snapshot time | SHA-256 of exact bytes |
|---|---|---|
| `verified-status.json` | `generatedAt=2026-10-10T10:54:07.538Z` | `d8119d2e5f6e5641b5b90b504eac03dd8b27cd2f6273fd35192c65591a2f93f1` |
| `verified-index.json` | `lastRun=2026-10-10T10:54:07.535Z` | `c5e72e6e52d03780749b55d5b9bcec0fa0e42586038732e538537dced60956cf` |

Local location: `/Users/alex/agent-hub/concert-data-quality/coordinator/work/`.
Public surfaces: [status.json](https://cartograf666.github.io/concert-for-travelers-api/status.json)
and [index.json](https://cartograf666.github.io/concert-for-travelers-api/index.json).
These URLs can change; the supplied hashed bytes are this audit's evidence.
Public URLs were not fetched again in this lane.

For the following tree digests, sort relative POSIX paths and append
`path UTF-8 + NUL + file bytes + NUL` for each matching file to SHA-256.

| Base input | Files | SHA-256 |
|---|---:|---|
| `scrapers/*.json` (non-recursive) | 153 | `a675fd7a4e26020b8f1da7a67f4a504753841a16b41a518ae67d8d11c1e7b6a4` |
| `scrapers/artists/*.json` | 415 | `90d4af507fa1ed2dedadbf0aaf1ae5406d162c94962cec583879f4568a9c2552` |
| `data/artists/*.json` | 8 | `db4b313d677f3dd09c1a7041d070811184edd087ba9106a142a81d33d62682db` |
| `data/artist_scrape_targets.txt` (file bytes) | 1 | `156d965f283071b81707ea9e7e6c8fa2bdbffa2152d5f53271346429eb056258` |
| `.github/workflows/artist-scrape.yml` (base file bytes, before comments corrected) | 1 | `b89e49238d3eba3ed16c9d633c7cccd9e99a1fe55479fe5d8a693cbe27d0a5b0` |

Scheduler input `src/engine/bandsintown.ts` SHA-256:
`69df75b59e9a1bd95311870e6becf829a051a9f94f908e41dba3a78dcb57727d`.
Freshness implementation `src/observability/source_health.ts` SHA-256:
`2e2a9fcd355cd907a4f6957116ede8e015c05a5333f07321999a4358ad51f6ee`.
All other inspected source is pinned by the base revision.

## Fleet and schedule

Both directories pass the current [config loader](../src/engine/runner.ts)'s
schema validation: 153 root configs and 415 artist configs. It loads immediate
JSON children, not nested directories. No config has a `disabled` key; there is
no disabled-config switch in the inspected schema/loader. These are configured
cohorts, not counts of unique physical venues or distinct artists.
In particular, 64 root filenames start with `artist-`; naming is a warning against
calling this cohort entirely venues, not a validated physical-venue classification.

| Config type | Root cohort | Artist directory |
|---|---:|---:|
| `static_selectors` | 87 | 378 |
| `custom_js` | 50 | 35 |
| `jsonld` | 4 | 0 |
| `json_api` | 3 | 1 |
| `playwright_render` | 7 | 1 |
| `next_data` | 2 | 0 |
| Total | 153 | 415 |

`allowEmpty=true`: 14 root configs and 15 artist configs; respectively 5 and 13
also require `emptyScheduleText`. These remain targets. Permission to accept a
valid zero-event schedule does not disable a source or establish market coverage.
The observed empty-success counts (9 root, 12 artist) are not a count of all
`allowEmpty` configurations.

[artist-scrape.yml](../.github/workflows/artist-scrape.yml) schedules daily at
04:00 UTC, with BIT 800 and Eventbrite 300 maximum attempts per run; the job timeout
is 90 minutes and concurrent runs can cancel an earlier run. Six days is the
provider's configured minimum revisit interval, not a six-day stale-data SLA.
[daily-scrape.yml](../.github/workflows/daily-scrape.yml) runs on completion of
that artist workflow or manual dispatch, rather than its own daily cron.
[discover-artists.yml](../.github/workflows/discover-artists.yml) is weekly,
Saturday at 02:00 UTC. Trigger frequency does not prove successful completion.

[loadArtistTargets](../src/run-artists.ts) combines 2,431 explicit targets with
20,741 eligible database rows (professional tier or untiered), normalizing
whitespace/case and deduplicating to **20,781 targets**. The text file alone is
not the complete provider roster. This local count agrees with the supplied
published source-health roster; it does not identify the deployed code SHA.

## Observed checks and age

Source report times differ: root 10:43:56.583Z, artist 10:17:34.373Z,
BIT 10:17:35.257Z, Eventbrite 10:37:19.247Z, all on 2026-10-10.

| Source cohort | Targets | Attempted | Succeeded | Failed | Unavailable outcomes | Fresh / old / unknown |
|---|---:|---:|---:|---:|---:|---|
| Root (`venue` health key) | 153 | 153 | 131 | 22 | 0 | 131 / 6 / 16 |
| Artist pages | 415 | 415 | 390 | 25 | 0 | 390 / 11 / 14 |
| BIT | 20,781 | 800 | 756 | 0 | 44 | 10,888 / 6,686 / 3,207 |
| Eventbrite | 20,781 | 5 | 0 | 5 | 0 | 0 / 0 / 20,781 |
| Ticketmaster countries | 27 | 27 | 27 | 0 | 0 | 27 / 0 / 0 |

BIT selected=attempted=800, with 581 empty successes (a subset of 756).
44 unavailable feed outcomes do not verify an empty schedule. Its `skippedFresh`
count is 12,580: queue eligibility uses `fetchedAt`, including classified
unavailable outcomes, while source health uses successful `verifiedAt`.
That count must not be substituted for 10,888 freshly verified targets.

BIT freshness reconciles: `10,888 + 6,686 + 3,207 = 20,781`. Quantiles exclude
unknown verification times: **17,574** targets form the observed p95 denominator.
The implementation sorts known ages and uses zero-based
`floor((17,574 - 1) * 0.95) = 16,694`, rounded to two decimals.
The supplied p95 is **12.42 days**, p50 3.86 days, maximum 14.05 days.
This is not a p95 over the entire roster and says nothing about how old the 3,207
unknown targets are. Fresh is age <= 6 days; old is age > 6 days here.
Root/artist freshness instead uses `current_run`: old means previously verified
but not verified in that pass, not necessarily older than six days.
The raw per-target cache is not supplied, so the numerical 12.42-day p95 cannot
be recomputed independently from these aggregate artifacts.

Eventbrite is **unavailable**: five `access_challenge` failures trigger the
consecutive-failure halt, not exhaustion of the configured 300-attempt capacity.
There are no successful verifications; all targets have unknown verification age.
The report supports an access blocker, not an inference that there are no events.
No auth, bypass or live access recovery was attempted.

A source-success count measures checked endpoints/configs; even successful empty
responses do not prove all eligible shows were extracted. The index contains
51,321 concerts, 7,044 artists and 2,829 cities after filtering/deduplication.
Those are exported catalogue counts, not a complete-market denominator.

## Capacity, fairness and provenance

The optimistic initial full-roster lower bound is
`ceil(20,781 / 800) = ceil(25.97625) = 26` full daily runs, absent failures,
repeated selections/reprioritization, skipped/cancelled runs or roster growth.
This is an attempt-capacity lower bound, not an observed 26-day success SLA.
Repeated active selections, unavailable feeds and early stops can lengthen it;
successful verification for every unavailable target may never be possible.

The existing [BIT queue](../src/engine/bandsintown.ts) already reserves 20%
(up to 160 of 800) for active future-event artists and uses the remainder for
**global** oldest-attempt order, including every cohort. Unused active capacity
returns to the global lane. Interleaving prevents a cluster of active failures
from taking every first request ahead of healthy cold targets. Failed attempts
advance `attemptedAt`, retaining last-good data without advancing verification;
this prevents repeated failed targets from monopolizing the head. Ordering falls
back to `fetchedAt` for legacy cache entries.

Existing [BIT tests](../tests/bandsintown.test.ts) cover cap consumption on failure,
active/cold interleaving, carry-over and 20,711-target simulations. A separate
zero-network calculation against the actual 20,781 roster size also reached first
full coverage on run 26 for both all-empty and all-active successful rosters.
After 60 synthetic daily runs, p95=24 days and max=25 days in both scenarios.
These deterministic idealized results are not measurements of production age or
proof for every mixture of errors, roster churn and cancellation. No concrete
queue defect was reproduced; a performance rewrite is unsupported by this audit.

[Official source ranking](../src/engine/official_artist_sources.ts) is narrower
than the artist-config fleet: five registered config/artist/URL/domain pairs.
Only active cached rows with valid successful verification, current config/parser
fingerprint and exact row source/artist identity get official duplicate priority.
[Processing](../src/pipeline/process.ts) chooses that row as a whole over a
non-official duplicate; equal-rank rows use the existing policy (with the bounded
The HU Dublin exception). Config count is not blanket official authority.
Conditional 304 and successful checks verify sources; retained legacy cache with
no `verifiedAt` remains unknown. Cached content and API generation time do not
establish current source freshness.

`ticketUrl` compatibility remains unchanged: processing uses the artist's own
website when known, otherwise the raw source ticket URL. No schema or consumer
migration is proposed. No sibling consumer runtime was inspected or inferred.

`publication.state=eligible` and its eligible health gate describe whether the
payload passed the publishing gate. A dashboard displaying these fields is not
a Pages deployment receipt. The coordinator supplied published JSON evidence;
this lane did not verify Actions checkout SHA, deployment completion/receipt or
mapping of those bytes to the pinned local revision.

## Reproduction and checks

Run from this worktree/base with the project's existing dependencies (no provider
network). The manifest calculation uses Python's standard library:

```sh
python3 - <<'PY'
import collections, hashlib, json, math
from pathlib import Path
for pattern in ['scrapers/*.json', 'scrapers/artists/*.json', 'data/artists/*.json']:
    files = sorted(Path('.').glob(pattern))
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path).encode() + b'\0' + path.read_bytes() + b'\0')
    print(pattern, len(files), digest.hexdigest())
    if pattern.startswith('scrapers/'):
        rows = [json.loads(p.read_text()) for p in files]
        print(dict(collections.Counter(r['type'] for r in rows)))
        print('disabled keys', sum('disabled' in r for r in rows),
              'allowEmpty', sum(r.get('allowEmpty') is True for r in rows))
evidence = Path('/Users/alex/agent-hub/concert-data-quality/coordinator/work')
for name in ['verified-status.json', 'verified-index.json']:
    print(name, hashlib.sha256((evidence / name).read_bytes()).hexdigest())
bit = json.loads((evidence / 'verified-status.json').read_text())['sourceHealth']['bandsintown']
f = bit['freshness']
assert f['fresh'] + f['old'] + f['unknown'] == bit['counts']['targets']
known = f['fresh'] + f['old']
print('capacity runs', math.ceil(bit['counts']['targets'] / 800),
      'known ages', known, 'p95 index', math.floor((known - 1) * .95))
PY
node --import tsx --test tests/bandsintown.test.ts tests/source_health.test.ts tests/official_artist_priority.test.ts
```

The actual-roster model and schema/target checks:

```sh
node --import tsx --input-type=module <<'JS'
import { loadConfigs } from './src/engine/runner.ts';
import { loadArtistTargets } from './src/run-artists.ts';
import { selectBandsintownArtists } from './src/engine/bandsintown.ts';
for (const dir of ['scrapers', 'scrapers/artists']) console.log(dir, (await loadConfigs(dir)).length);
console.log('expanded targets', (await loadArtistTargets('data/artist_scrape_targets.txt')).length);
for (const active of [false, true]) {
  const artists = Array.from({length:20781}, (_,i) => `Artist ${String(i).padStart(5,'0')}`);
  const cache = active ? Object.fromEntries(artists.map(a => [a, {
    fetchedAt:'2020-01-01T00:00:00.000Z', concerts:[{date:'2030-01-01'}]
  }])) : {};
  const seen = new Set(); let fullRun;
  for (let day=0; day<60; day++) {
    const now = new Date(Date.UTC(2026,0,1+day));
    for (const a of selectBandsintownArtists(artists,cache,800,6,now).artists) {
      seen.add(a);
      cache[a] = {fetchedAt:now.toISOString(), attemptedAt:now.toISOString(),
        verifiedAt:now.toISOString(), concerts:active ? [{date:'2030-01-01'}] : []};
    }
    if (!fullRun && seen.size===artists.length) fullRun=day+1;
  }
  const now = Date.UTC(2026,0,60);
  const ages = artists.map(a => (now-Date.parse(cache[a].verifiedAt))/86400000).sort((a,b)=>a-b);
  console.log({active, firstFullCoverageRun:fullRun, p95:ages[Math.floor((ages.length-1)*.95)], max:ages.at(-1)});
}
JS
```

Verified locally: 31/31 existing tests pass (BIT, source-health and official
priority); both directories schema-load; expanded targets=20,781; both capacity
models give the results above. Documentation whitespace and workflow non-comment
identity checks pass; both reproduction blocks above were executed successfully. Full suite/build were not
rerun for this documentation-only change. No new tests, dependency installs,
provider sweeps, heal runs, limits/interval/cron changes or consumer edits.

## Proposed follow-up order (not implemented)

1. Source identity and extraction lanes: inspect bounded failures and raw-to-public
   loss before increasing acquisition. Root has 22 failed configs (15 selector,
   6 fetch, 1 CSR); artist has 25 (12 selector, 10 fetch, 3 parse). A fix needs
   row-level output evidence, not just a higher success counter.
2. Eventbrite authorized-access decision: keep unavailable/unknown visible; decide
   supported access or source retirement separately. Do not bypass the challenge.
3. BIT observational queue audit: use successive retained per-target caches and run
   manifests to measure unique attempts, successful verification, active/cold/new
   progress and unknown transitions. Inspect unavailable identities without
   enlarging request budgets. Rewrite only after a specific starvation/selection
   defect is reproduced. Existing fairness mechanisms address the obvious risk.
4. Before claiming deployment or changing a consumer, correlate Actions checkout
   SHA and deployment receipt with hosted artifact bytes. Inspect the actual
   sibling consumer separately if a concrete runtime recommendation requires it.

Unknowns: full market/event denominator, per-target unknown ages and raw p95
inputs, long-term queue progress under real errors/churn, Eventbrite access
recovery, deployed revision linkage and sibling runtime behavior. None blocks
these narrow documentation corrections. Integration/BACKLOG remain hub-owned.

### Coordinator follow-up — 2026-10-11

The completed artist-run artifact subsequently supplied the actual 20,781-entry
Bandsintown cache. Using the existing expanded target loader, its successful
`verifiedAt` values and the original source-health timestamp independently
reproduces **10,888 fresh / 6,686 old / 3,207 unknown**, with **17,574 known ages**
and p95 **12.42 days**. This supersedes the earlier limitation that the numerical
p95 could not be independently recomputed from aggregates. Unknown-age targets
remain unknown. The exact cache hash and zero-network next-queue simulation are
in stage evidence `freshness-cache-verification.json`, produced by
`verify-freshness-cache.mjs`; no provider requests or budgets changed.

One retained cache does not establish long-term fairness under churn/errors.
The [consumer contract audit](consumer-contract-audit-20261011.md) adds an actual
read-only adapter projection and source-level compatibility inspection; it is not
a complete static-versus-live provider coverage comparison or server migration.
