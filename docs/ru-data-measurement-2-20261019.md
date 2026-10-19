# Второй срез: измерение после review, 19.10.2026

**Post-review candidate `3f314632c0276cabca9b4c726257b9f6eb92c445` подтверждает 2 новых source occurrences ДДТ в Германии: Essen 05.12.2026 и Ingolstadt 09.12.2026. Source public output 0 → 2, added/removed/changed = 2/0/0; whole public bytes совпадают с предыдущим candidate.** У остальных восьми targets нет допущенного config, прирост 0. На полном уже опубликованном snapshot нормализация изменила **80 строк: 68 venue placeholders, 16 city aliases, overlap 4**; actual publisher **48 255 → 48 255**, snapshot-induced loss/dedupe 0/0. Production не менялась.

Этот документ **заменяет** результаты и code claims candidate `319aa04` / normalization `d400a80`, включая counters **74/61/16/3**. Предыдущие immutable evidence directories сохранены как история. Текущие counters взяты из новых artifacts и независимо пересчитаны, не из предварительной оценки.

Контракт: `/Users/alex/agent-hub/concerts-ru-data-2/common-brief.md`; реестр решений: `/Users/alex/agent-hub/concerts-ru-data-2/questions.md`. Пути ниже относительны `/Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/`, если не указано иначе.

## Exact versions и неизменные inputs

| Поле | Проверенное значение |
|---|---|
| Exact base | `bc5e20db913ab5cbcff26870bda072c82fb8b768` |
| Post-review GO candidate | `3f314632c0276cabca9b4c726257b9f6eb92c445` |
| Встроенная normalization revision | `417dc9824407b2df02cea826e1da4a741426ac39` |
| Frozen source clock, сохранён по GO | `2026-10-19T07:34:57.000Z` |
| Latest mapped actual capture | `2026-10-19T07:21:33.815178+00:00` |
| Post-review manifest SHA256 | `00a65918fc23ac6ba956aef02cc9c0d0ce8ffdd86d97bd7e89b80cde31ca1f9d` |
| Внешний harness SHA256 | `b1bbf7da861417c9bdf4b3d5567028b874c1bdf8766a1170da6e7f6b8db11546` |
| Base code/config/DB fingerprint | `e78934f83bdb5da083b7fe57f38565bfc6f37aed801b3f9933ddece18a2a1d29` |
| Candidate code/config/DB fingerprint | `7154c13bed9e9943fa28dda6be252b10d2329ee3076520dde532079bca580a09` |
| Public candidate concerts.json SHA256 | `d406f04de67554a421f745e377fe5111ec6efdc5d8837f48a1a54630309288a1` |
| Actual approved DB | 63 409; shard hashes одинаковы на обеих сторонах |

Созданы **новые** `post-review-inputs/` и `post-review-integrated-replay/`; старые inputs/outputs не перезаписаны. В manifest изменено **только candidateRevision** относительно прежнего `final-inputs/inputs.json`: label, base, clock, все original response mappings, hashes, paths и savedRaw audit references побайтно/структурно проверены как неизменные. Новый manifest hash привязан к обеим summaries; original bytes проверены до и после. Нет stale candidate inputs. Source config diff 319aa04→3f31463 пустой; все новые approved runtime paths base→3f покрыты, единственный — `scrapers/artists/ddt-tour.json`.

Выполнен тот же реальный `runScraper → processConcerts → geocodeConcerts(cache-only) → publishConcerts` из exact base/candidate с их actual artistDb. Harness загружен из собственного measurement worktree вне обеих сторон. На каждой стороне identity-before/after JSON полностью совпали: HEAD, clean state, code/config/DB/package/cache hashes. Base preserved worktree `base-bc5e20d` не менялся; hub и чужие worktrees не менялись.

| Source cohort | Base | Post-review candidate |
|---|---:|---:|
| Raw / public | 0 / 0 | 2 / 2 |
| Captured HTTP reads | 0 | 1 |
| Network attempts / missing captures | 0 / 0 | 0 / 0 |
| Config absent | 9 | 8 |
| Admitted runtime source collected | 0 | 1 |
| Approved DB read | 63 409 | 63 409 |

Original DDT HTTP entity body: `../official-west/deac8dc26fd613f440.body`, GET200, SHA256 `2b7cc34a6429d0450f5a05ed7712e8a2c0915bc85b87fa0ffb5a94675c7486a3`. Ещё три east home captures проверены по SHA, но при отсутствующих configs не исполняются. West other4 имеют responses=[]: нет eligible config, а не synthetic HTTP/events. Готовые raw не передавались в pipeline; savedRaw ДДТ — только audit, equalExceptScrapedAt=true. Actual primary/backup geocode caches отсутствуют на обеих сторонах, provider attempts0; новые координаты не угадывались, enrichment pending2.

## Два новых source события

| Артист | Native дата/время | Страна / город | Venue | Native source-event URL |
|---|---|---|---|---|
| ДДТ | 05.12.2026 20:00 | DE / Essen | Essen Grugahalle | [Essen](https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii/essen-2026-12-05) |
| ДДТ | 09.12.2026 20:00 | DE / Ingolstadt | Saturn Arena | [Ingolstadt](https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii/ingolstadt-2026-12-09) |

**All-country new counts: DE2; Essen1, Ingolstadt1; прочие страны 0.** Обе даты строго будущие и в source окне 14–90 inclusive, 02.11.2026–17.01.2027. В старой корзине 16 стран первого среза gain **0**, потому что DE не входит. Legacy panel `comparison.addedByCountry` и measurement country tables ограничены этими16; полный country/city breakdown — `new-valid-occurrences.json`.

Повторно проверены original h1/MusicEvent, scheduled/offline, полный год/дата/время, explicit DE/city/venue, source URL=offers URL, saved-native authority chain `ddt.ru → ddt-tour.ru → Bilet.Kartina hall → calendar`. Public identity — ДДТ, MBID `f7456b5b-e5a5-454e-b5db-047308210c8e`; performer Yuri Shevchuk в group calendar не стал другой identity. В full live-before эта identity имеет0 rows; две новые occurrences уникальны в source cohort.

Каждая public row целиком совпала с реальной одиночной нормализацией extracted raw и geocode; metadata не сплайсилась. Candidate public bytes **полностью равны предыдущим public bytes** (SHA выше), не только выбранным полям. Существующий process предпочитает approved website: public ticketUrl `https://ddt.ru/`; operator event URLs сохранены отдельно с полными native/raw/public rows и hashes. Это source identity/date/place proof, не ticket availability или source completeness.

## Все девять targets

Fresh live-before canonical names и approved MBIDs: у каждого0. Ни один отсутствующий config не назван source-success, даже если технический worker summary state=replayed.

| Target | New valid occurrences | Фактическая причина / статус |
|---|---:|---|
| ДДТ | 2 | Один admitted runtime source Germany; Thai dates не подключены из-за конкретного Lotus Arena terms restriction |
| Oxxxymiron | 0 | На saved official TOUR2026 calendar April–July нет подтверждённых дат после19.10; вывод ограничен страницей |
| Баста | 0 | Explicit country отсутствует; Intickets JS challenge; linked BIG ART также без country |
| Макс Корж | 0 | Timeouts/partial native calendar; не утверждение «нет дат» |
| Zivert | 0 | Expired TLS official hosts, полного native calendar нет; TLS не обходился; не «нет дат» |
| Кино | 0 | Official country отсутствует, linked Zakazbiletov reuse restriction |
| Монеточка | 0 | Last announced05.09.2026; dated no-announced-future-dates-on-this-page, без year rollover |
| Дора | 0 | Official home/robots timeout; BandLink reuse restriction и incomplete venue/country; не «нет дат» |
| Lumen | 0 | Homepage без country, full-calendar timeout; не «нет дат» |

Подробные причины/native evidence — в source worker reports `coordinator/work/official-sources-west-REPORT.md` и `official-sources-east-REPORT.md`; source observations не стали publish inputs. `post-review-integrated-replay/all-nine-target-statuses.json` связывает каждую identity с фактическим config state и reason. Source configs/statuses не изменились после review.

## Полный saved-live snapshot и новая нормализация

Hub captured GET19.10.2026 07:19:12–07:19:18 UTC. Повторно проверены все original files bytes/SHA и counts: `index.stats.totalConcerts == status.publishedConcerts == concerts.length == 48283`. `index.lastRun=2026-10-18T09:04:35.710Z`, `status.generatedAt=2026-10-18T09:04:35.713Z`; concerts35 176 627 bytes, SHA256 `2fd8d7d81fa3e35a9c9c02931dbe440ed5c7c21c433b47c897d0a125cdd368d5`. Девять target counts0 подтверждены actual artistDb; латинский Kino Calgary с другой MBID не включён в RU Кино. Исходные21 descriptive location examples сохранены в `live-validation/`, категории пересекаются.

Новый worker replay: `../location-normalization-opus-fix-1/`, exact revision `417dc9824407b2df02cea826e1da4a741426ac39`. Process/geocode/location/BIT/replay bytes **совпали с integrated3f31463**, approved DB hashes также совпали. Full snapshot replay сохраняет index clock18.10, чтобы оценивать тот же опубликованный input; это отдельный эксперимент от source clock19.10.

`verify-post-review-normalization.mjs` не запускает pipeline повторно и не воспроизводит normalization algorithm. Независимо проверены все48 283 before rows, hashes, indexes, identity arrays, every changed field и row-level counters:

- **80 modified = 68 venue +16 city −4 overlap**; input/output audit rows48 283/48 283. Source coordinates и unrelated fields сохранены.
- Семь новых venue corrections против d400a80: `Ljubljana, SI`; `Den Haag, Netherlands`; `Madrid, Spain`; `Bogotá, Colombia`; `Santiago, Chile`; `Buenos Aires, Argentina`; `Belgrade, Serbia`. Они соответствуют structured BIT city/country. Одна строка уже имела city correction, поэтому union modified вырос74→80, а venue corrections61→68. Проверено сравнением полных старых/новых audit rows, не предположением.
- Actual native public before/after48 255/48 255; в обоих28 existing notApproved (Mozarteum provenance guard), все другие drops0, duplicatesMerged0/0.
- Все80 audit corrections найдены в published rows; после применения **только записанных field diffs** baseline public row multiset полностью равен candidate. Все прочие metadata и multiplicity сохранены **на этом snapshot**; snapshot-induced loss/dedupe0/0, downstream gained/lost после corrections0/0.
- Все8 required cases опубликованы как Unknown Venue с исходными lat/lng; CY стал **Agios Tychonas**, не Limassol.
- Worker native replay networkAttempts0, пустой cache; source lat/lng не угадывались и не переносились между записями.

Новые country modified counts (все независимо пересчитаны): AM2, AR3, AU1, BE2, BR1, CA10, CH1, CL1, CO1, CY1, CZ1, DE2, DK2, EE1, ES6, FI1, FR6, GB2, GE4, IE1, IN6, LT2, NL1, PT1, RS11, RU8, SI1, TH1. Type/country breakdown — `post-review-normalization-validation/verification.json`. Full worker audit SHA256 **`54be5d3db2330c030c37d7f15c30e20e65be5977ffc43c79437f912cc67a5fce`**, actual publisher before/after hashes также зафиксированы в verification. Полные80 changed pairs,8 required published examples и7 новых venue corrections сохранены отдельно.

## Исправленный code contract и границы доказательств

Старые venue-discriminator / validated-row identity эксперименты **удалены**. Process сохраняет legacy grouping artist/date/**raw city** до post-dedupe geocode canonicalization и прежние verified-source exceptions. В одной прежней группе целая named-venue row предпочтительнее Unknown Venue при одинаковом authority; прежний official-source приоритет сохраняется. Timestamp/query/прочая metadata не создают новую event identity; metadata не собирается из разных записей.

Limited country/city-scoped comparison forms распознают Izhevsk/RU ↔ Ижевск/Ижевске в title placeholders, не переименовывают города и не выводят geography. Structured `city, country` проверяется по совпадающему городу и существующему country code/English country name. Неизвестный Various/GB остаётся unknown source-quality limit; настоящий город не выдумывается.

**Snapshot loss/dedupe0 не доказывает raw multi-source coverage.** Эти сценарии, authority и whole named row preference проверены отдельными synthetic/native fixture regressions worker:18 location tests и103 focused tests, не live provider acceptance. Достоверность retained BIT provider rows и численность ранее отсечённых upstream events **не измерены** и не добавляются к source gain2 ДДТ.

Идемпотентность ограничена field normalizer и повтором **того же RAW input** в worker assertions/fixtures. Безусловное re-ingestion **published JSON** не заявляется: raw spelling Beograd/Belgrade теряется после публикации и может изменить legacy grouping при повторной подаче public output. Такой consumer path не служил причиной нового discriminator. Моя проверка читала завершённые assertions/artifacts, нормализатор не запускала повторно.

## Gates и воспроизведение

PASS мной: exact source replay на новом GO; manifest меняет только candidateRevision; original hashes before/after; code/config/DB identity; одинаковый actual artistDb/cache input; 0 network/missing; native event/date/place/URL/identity audit;2 whole-record lineages; identical public bytes versus prior candidate; all9 statuses; full saved-snapshot row/country/type/hash/coordinate/metadata/multiplicity validation. Подготовительные6/6 harness tests, focused lint и pristine base absence replay остаются в evidence; harness/tests с тех пор не менялись.

**Hub-owned final-checks-2 завершены на exact3f31463:** npm **921 total /920 pass /0 fail /1 expected skip**; SSRF, tsc --noEmit, lint, selector125<=131, artist integrity, diff-check — все exit0. Мною проверены каждый log SHA и exact before/after HEAD/clean status, gates не повторялись. npm log SHA `4c5d1fb1c355ee0bfc2b5c7485ed67f13112dcbfe9caa046c89db4d8ca91649f`. Current source replay/validation/gates failures нет; старый final-checks-1 loader failure и прежние counters остаются только historical evidence. Внешний review round2 и owner acceptance — scope хаба, этим измерением не заявляются.

Не выполнены и не заявляются: production deploy/live-after, реальные provider geocoding/caches, ticket availability/source completeness, quantitative BIT upstream recovery/provider truth, безусловная published-JSON идемпотентность. Восемь targets без eligible configs; новые DDT coordinates pending. Source0→2 нельзя прибавлять к full live total как подтверждённый production прирост. Нет push/PR/main merge/dispatch/deploy, external contacts/forms/auth repair/agreement acceptance/DB writes/budget-cadence changes.

Выполненная команда (out при повторе новый и пустой):

```sh
node --import tsx /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-published-measurement-20261019/src/scripts/ru_data_expansion_replay.ts --base /Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/base-bc5e20d --candidate /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-ru-data-2-20261019 --inputs /Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/post-review-inputs/inputs.json --out /ABS/NEW/EMPTY/REPLAY
```

Current artifacts: `post-review-inputs/{inputs,originals-before}.json`; `post-review-integrated-replay/{comparison,delta,new-valid-occurrences,all-nine-target-statuses,verified-invariants,previous-vs-post-review,originals-after,root-gates-verified}.json`; per-side raw/public/provenance/diagnostics/identity-before-after/logs. Validation: `post-review-normalization-validation/`, scripts `audit-post-review.mjs` и `verify-post-review-normalization.mjs`. Final byte index — `post-review-evidence-index.json`. Старые final-inputs/final-integrated-replay и предыдущий normalization audit сохранены без изменений.
