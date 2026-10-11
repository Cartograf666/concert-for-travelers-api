# Official source extraction and attribution — 2026-10-11

These are local repairs on base `9624768a1b0871afec341ac20514fb6b98cb14c5`,
not a production deployment or a claim of complete market coverage. Existing
custom-module dispatch, strict schema, approved catalogue and cache fingerprints
are reused. No provider limits, cron, public schema or artist DB changed.

## Native extraction

Blue October's nested rich-text selectors repeated each date and location.
The custom parser reads each container once and requires an explicitly printed
full year/date. All 70 captured current events independently reach the real
public pipeline: 67 US and three Canadian dates. The state/province mapping is
source-local to this verified North American format; unknown regions are not
countries. California `CA` is US, whereas Canadian `ON/QC/BC` are CA. The linked
Paramount/Vancouver addresses and native whole-calendar capture supply context.
Four city corrections are bound to the exact native event URL, date, venue,
printed city and region, with primary street-address evidence; changed venues
cannot inherit these corrections or old coordinates.

Teenage Fanclub's old selectors copied the whole ticket anchor into every field.
The parser now reads full dated paragraphs under the explicit tour heading,
including sold-out rows without anchors and the split `Nov` text. It removes
only repeated venue/ticket labels and never projects yearless archives into the
future. The 2026 capture contains 41 full dates, 34 current at the fixed October10
clock. Primary venue geography supports 30 current rows; four remain without
country proof. Belfast is GB and Dublin is IE despite both using `.ie` ticket
links. The country bindings use exact native city/venue keys, never arbitrary
city-only or provider-derived guesses.

The November1 Amsterdam row has a placement conflict: artist calendar Paradiso
versus linked operator Tolhuistuin/Club. The operator's indexed route text points
to IJpromenade2 while its JSON-LD retains the organisation's Weteringschans
address; the native direct GET is unavailable. The parser retains that dated
raw row with country NL but without asserting a venue, so **29 current complete
Teenage events** publish independently and the conflicting row does not become
a new official publication. Existing provider data is not silently overwritten.
The complete source captures preserve the printed labels for follow-up.

Mozarteum's listing omitted years and assigned all museum activities and mixed
programmes to Mozart. Its own public Gatsby feed now supplies exact dates,
times, categories, locations and programme HTML. Attribution requires an explicit
Mozart composer/work credit (including mixed-composer paragraphs), not a title,
brand, image, unrelated performer or guessed year. Tours, exhibitions and recorded
film-collection/lecture categories do not become concerts. This remains the
existing Mozart-specific composer/programme feed, not a new all-performer venue
discovery or a claim that Mozart is a living performer.

Primary venue/room geography is recorded in
[venue-country-proof-20261011.json](venue-country-proof-20261011.json).
Root additionally accepts the Großer Saal's country through the live official
room-to-physical-building relationship: `mozarteum.at/saal-vermietung` explicitly
places Großer Saal and Wiener Saal in the same foundation building, and
`mozarteum.at/en/contact` explicitly locates that building in Salzburg, Austria.
The different entrance number does not move one room into another country.
This supersedes the research report's overly strict same-street-number unknown
for that room; it grants no authority to Villa Vicina or Heckentheater, which
remain unknown. Other rooms have their own primary address chains.

The fixed-clock actual source replay gives **53 credited date/time slots → 24
public artist/date/city records**, with five raw slots missing verified geography.
The existing public identity collapses multiple composer performances in the
same city/day; this repair preserves distinct raw slots and does not redesign the
public deduplication/schema or claim all 53 are separately exported. Requiem on
December5,2026 at19:00/GroßerSaal remains a positive native reference. Uncredited
Weinberg/Karg programmes, museum tours and old yearless fallback are quarantined,
while other sources' Mozart rows retain their existing behavior.

## Evidence and checks

Original HTML, full native Gatsby JSON, HTTP metadata and input hashes are under
`/Users/alex/agent-hub/concert-data-quality/coordinator/work/` in
`normalization-losses-evidence` and `root-official-evidence`. Test fixtures retain
the actual required DOM/fields, with presentation/navigation cropped mechanically
and the transformation documented in `provenance.json`. No missing original
inputs were fabricated or relabelled as live.

`tests/official_source_resilience.test.ts` passes all seven source checks through
the real catalogue and stock custom runner: complete Blue extraction, country
and move negatives, exact dated/sold-out/archival Teenage cases, native Requiem,
mixed composer credits, metadata-only negatives, invalid year/source/feed and
zero provider-request transport replay. Integrated whole-record/event-pair
checks are performed separately; an earlier replay that appended still-rejected
source rows is not evidence for these corrected inputs.

The legacy schema still requires `countryNameFallback`; original required values
are retained for compatibility. None of these custom parsers reads that fallback.
Unknown source countries remain missing and fail the public schema; validation
was not weakened to make extraction counts look better.

Still outside local proof: fresh Cartagena access, four Teenage native country
bindings and Amsterdam placement, VillaVicina/Heckentheater geography, full live
provider coverage, hosted CI and production publication. These are named gaps,
not green source-recovery claims.
