# Второй срез: подготовка воспроизводимого измерения, 19.10.2026

**Свежий полный live snapshot проверен: 48 283 опубликованные строки. У всех девяти целевых approved identities — 0 строк. Final candidate ещё не запускался: нужен GO хаба с точным SHA и mappings оригинальных HTTP captures.** Это локальная подготовка измерения; production не изменялась.

Общий контракт: `/Users/alex/agent-hub/concerts-ru-data-2/common-brief.md`; реестр решений: `/Users/alex/agent-hub/concerts-ru-data-2/questions.md`. Evidence root далее — `/Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/`.

## Свежий полный live-before

Хаб выполнил GET 19.10.2026 07:19:12–07:19:18 UTC. Проверка была полностью offline. Все три оригинальных файла `evidence/live-before/{index,concerts,status}.json` имеют HTTP 200, bytes и SHA256 совпадают с `manifest.json`; `index.stats.totalConcerts`, `status.publishedConcerts` и длина полного массива равны 48 283. Оригиналы не изменялись.

- `index.lastRun`: `2026-10-18T09:04:35.710Z`.
- `status.generatedAt`: `2026-10-18T09:04:35.713Z`.
- `concerts.json`: 35 176 627 bytes; SHA256 `2fd8d7d81fa3e35a9c9c02931dbe440ed5c7c21c433b47c897d0a125cdd368d5`.
- Anchor: 19.10.2026; окно 14–90 включительно: 02.11.2026–17.01.2027.
- Freshness использует `index.lastRun - scrapedAt <= 72h`, как в первом срезе. Это возраст extraction, не новая проверка события.

| Целевая identity | Все даты | Дата >= 19.10 | Окно 14–90 |
|---|---:|---:|---:|
| ДДТ | 0 | 0 | 0 |
| Oxxxymiron | 0 | 0 | 0 |
| Баста | 0 | 0 | 0 |
| Макс Корж | 0 | 0 | 0 |
| Zivert | 0 | 0 | 0 |
| Кино | 0 | 0 | 0 |
| Монеточка | 0 | 0 | 0 |
| Дора | 0 | 0 | 0 |
| Lumen | 0 | 0 | 0 |

Проверены и canonical name, и MBID из настоящего `loadApprovedArtists(data/artists)` на exact base. Прочитано 63 409 identities, запись DB не выполнялась. Латинский `Kino` имеет одну опубликованную строку Calgary / 20.11.2026, MBID `39568c43-87a3-4711-92dd-7a33bd4e92ef`, website kinomusic.com. Она не включена в российское «Кино» (`064db6e8-fdfb-4acb-a327-fc2de75b37de`, kino.band).

Входные location-примеры сохранены целыми rows с исходным rowIndex и hash. Это описательные совпадения, не прогноз числа исправлений; категории пересекаются:

| Точное условие во входном snapshot | Строк |
|---|---:|
| Нервы: NERVY IN YEREVAN/TBILISI/BATUMI/BELGRADE | 4 |
| MORGENSHTERN: MORGENSHTERN \| Limassol | 1 |
| Andru Donalds: venue=city Bangkok/Krasnoyarsk/Novosibirsk | 3 |
| AM: city=Երևան | 1 |
| GE: city=T'bilisi | 3 |
| RS: city=Beograd | 11 |
| CY: city=Άγιος Τύχων | 1 |

Всего 21 distinct input row. Например, Нервы 10.11.2026 имеют `venue=NERVY IN TBILISI`, `city=T'bilisi`; MORGENSHTERN 25.10.2026 — `venue=MORGENSHTERN | Limassol`, `city=Άγιος Τύχων`. Географическое превращение этого поселения в Limassol не предполагается. Проверку итогов normalization worker выполню по его row-level evidence; его replay/code не дублирую.

Машиночитаемые результаты: `live-validation/{summary,targets,location-before-rows}.json`. В `summary.json` также сохранены 16 country counts, исходные URL, hashes и timestamps. Скрипт `validate-live.py` отказывает при непустом output; для повтора нужен новый output path.

## Exact baseline и harness

До изменений harness на моей чистой рабочей копии exact `bc5e20db913ab5cbcff26870bda072c82fb8b768` выполнен native `__worker`: девять config paths `scrapers/artists/{ddt,oxxxymiron,basta,max-korzh,zivert,kino,monetochka,dora,lumen}-tour.json` фактически отсутствуют. Результат — девять `configAbsent`, 0 raw / 0 public / 0 HTTP reads / 0 network attempts / 0 missing captures; actual DB 63 409. Это корректный empty baseline, не успешная интеграция и не синтетические строки. Inputs: `preparation/absent-configs-inputs.json`; outputs: `preparation/pristine-base/`; log: `preparation/pristine-base.log`. SHA256 нетронутого harness: `ec086f039815b2b1a381798561fd193861908e3bfd6f80c01288c7c442741b74`. Identity content hash до/после: `11c106080e25fb4440e523747683a13da68673228a3bef261604c6e5cfe8ad8f`.

Сохранён отдельный принадлежащий measurement base worktree без изменения code/config/DB: `evidence/measurement/base-bc5e20d`, detached exact `bc5e20d`. node_modules — локальная ignored ссылка на существующие зависимости проекта. Hub и прочие worktrees не менялись.

Ближайшая пригодная основа — `src/scripts/ru_data_expansion_replay.ts` и оригинальный первый manifest `/Users/alex/agent-hub/concerts-ru-data/evidence/measurement/final-integrated-inputs/inputs.json`. Они проверены чтением. Используется реальная цепочка `runScraper -> processConcerts -> geocodeConcerts(cache-only) -> publishConcerts`, actual approved DB и whole-record lineage; raw не вставляются вручную. Для второго среза harness дополнен:

- optional exact `baseRevision` / `candidateRevision` в manifest; legacy manifest сохраняет старый exact base;
- clock не может предшествовать capture; short/moving revisions отвергаются;
- реальный cache-only geocode stage, как в `src/run.ts`; actual отсутствующие caches остаются отсутствующими, network enrichment не выполняется;
- fingerprint включает весь tracked src/scrapers/artist DB, package manifests и primary/backup geocode cache; HEAD и dirty-state должны совпадать до/после;
- обе стороны обязаны иметь одинаковый geocode-cache input и чистые code/config/DB paths.

Старый `--live` режим harness остаётся инструментом первого среза с его clock/capture-format. Новый snapshot проверяется отдельным сохранённым offline `validate-live.py`; его данные не передаются в source delta replay.

## Проверки и остановка перед GO

Выполнены: original live byte/hash/count validation; actual artistDb read; native pristine-base absence replay; 6/6 focused replay tests; focused eslint двух owned TS files (0 errors, 0 lint warnings; остаётся предупреждение Node о module type существующего eslint.config.js); `git diff --check`.

Дополнительно выполнен **только harness regression**, exact base против того же exact base, с оригинальным HTTP capture Би-2 первого среза, не с готовым raw. Это не final candidate и не новый source success. Внешний harness загрузил реальный code/config/DB обеих сторон: 7 raw -> 5 public на каждой, added/removed/changed = 0/0/0; public bytes полностью совпали (SHA256 `8f2d6ec70c0cf8c268a0db9564eb8f28adf9263d8630491e332ae932e338f8b3`). На каждой стороне 1 captured HTTP read, 0 missing captures и 0 network attempts; реальный cache-only geocode вызван, 0 attempted / 5 deferred, так как primary/backup caches фактически отсутствуют. Identity-before/after JSON полностью совпали на обеих сторонах, fingerprint `2d2882f04c5c9f4334367f97759b6c6455230fa7df5425658b471e58625709ee`. Inputs/outputs: `preparation/legacy-harness-regression-inputs.json`, `preparation/base-self-regression/`. Названия подкаталогов `base`/`candidate` здесь обозначают две одинаковые стороны self-check, а не интеграционный candidate.

Не выполнены: финальный same-input base/candidate replay, source-event spot-check/counts по новым captures, сверка финальных normalization rows, full combined gates. Первые три зависят от GO/mappings и отчёта normalization worker; combined gates принадлежат хабу. Никакие captures первого среза не используются как доказательство нового source gain. Для источника без eligible config итоговый прирост будет 0 с фактической причиной.

После GO manifest связывает exact candidate SHA, clock и оригинальные HTTP bytes mappings. На обеих сторонах сохраняются raw, public before/after, diagnostics, per-source states, whole-record provenance, identity-before/after и no-network proof. Source delta, BIT provider recovery, live normalization и downstream dedupe остаются отдельными измерениями. До GO результат не заявляет прирост концертов и не заявляет изменение production.
