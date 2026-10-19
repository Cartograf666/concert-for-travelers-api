# Второй срез: финальное воспроизводимое измерение, 19.10.2026

**Exact candidate `319aa0412cac7fff271424099afdc240362034c5` даёт 2 новых валидных концерта ДДТ в Германии: Essen 05.12.2026 и Ingolstadt 09.12.2026. В affected source cohort public output 0 → 2, removed/metadata changed = 0/0. Остальные восемь targets не имеют допущенного config: их source gain 0 с причинами ниже.** Отдельная нормализация полного saved-live snapshot исправила 74 существующие строки, сохранив все 48 283 входные записи; native publisher дал 48 255 → 48 255, без потерь и дополнительного dedupe. Production не менялась.

Контракт: `/Users/alex/agent-hub/concerts-ru-data-2/common-brief.md`; реестр решений: `/Users/alex/agent-hub/concerts-ru-data-2/questions.md`. Все пути evidence ниже относительны `/Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/`.

## Exact ревизии и original inputs

| Поле | Проверенное значение |
|---|---|
| Base | `bc5e20db913ab5cbcff26870bda072c82fb8b768` |
| GO candidate | `319aa0412cac7fff271424099afdc240362034c5` |
| Встроенная normalization revision | `d400a809680af1b07da8df901dc460dbf0b7ac07` |
| Frozen source clock | `2026-10-19T07:34:57.000Z` |
| Latest mapped actual capture | `2026-10-19T07:21:33.815178+00:00` |
| Final manifest SHA256 | `cf1a5c78a74125fb0ef408421f5992cc37608f9f9fbd624402c9c8d3490a9c61` |
| Внешний harness SHA256 | `b1bbf7da861417c9bdf4b3d5567028b874c1bdf8766a1170da6e7f6b8db11546` |
| Base code/config/DB fingerprint | `e78934f83bdb5da083b7fe57f38565bfc6f37aed801b3f9933ddece18a2a1d29` |
| Candidate code/config/DB fingerprint | `64815783d967c6c1c7a12810759de8f229d722f12eed323e59d7962f0e9b594f` |
| Actual approved DB | 63 409, одинаковые shard hashes на обеих сторонах |

Реально выполнена цепочка `runScraper → processConcerts → geocodeConcerts(cache-only) → publishConcerts`, по настоящим code/config и approved artistDb каждой стороны. Harness загружен из собственного measurement worktree вне обеих проверяемых сторон. Base worktree `.../evidence/measurement/base-bc5e20d` нетронут; candidate code/config/DB не менялись. На каждой стороне identity-before/after JSON полностью совпали по revision, clean state и file hashes. Fingerprint покрывает tracked src, scrapers, artist DB, package manifests, primary/backup geocode cache. Actual geocode caches отсутствуют на обеих сторонах; provider calls = 0, две новые coordinate-less строки остаются pending enrichment. Координаты не выдуманы.

Manifest `final-inputs/inputs.json` содержит все девять target paths и все одобренные новые runtime configs; diff base→GO показывает только один новый config, `scrapers/artists/ddt-tour.json`. Его original HTTP entity bytes — `../official-west/deac8dc26fd613f440.body` относительно evidence root, SHA256 `2b7cc34a6429d0450f5a05ed7712e8a2c0915bc85b87fa0ffb5a94675c7486a3`, GET 200. Ещё три original home captures из east mapping проверены по SHA, но при отсутствующих configs не исполняются. West other four absence paths имеют responses=[]; это отсутствие допустимого config, не поддельные ответы или события. Original inputs проверены до и после; готовые raw не передавались в pipeline. `savedRaw` ДДТ использован только как audit: equalExceptScrapedAt=true.

Clock свежий и позже original captures; source окно 14–90 inclusive — 02.11.2026–17.01.2027. На base 0 HTTP reads, на candidate 1; на обеих сторонах **0 network attempts / 0 missing captures**. Отсутствующие configs не классифицируются как source-success, даже если технический итог worker `state=replayed`.

## Новые valid occurrences и все страны/города

| Артист | Native дата/время | Страна / город | Venue | Проверенный native event URL |
|---|---|---|---|---|
| ДДТ | 05.12.2026 20:00 | DE / Essen | Essen Grugahalle | [Essen](https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii/essen-2026-12-05) |
| ДДТ | 09.12.2026 20:00 | DE / Ingolstadt | Saturn Arena | [Ingolstadt](https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii/ingolstadt-2026-12-09) |

Полный all-country gain: **DE 2; Essen 1, Ingolstadt 1**; остальные страны 0. Обе даты строго будущие и в окне 14–90. В исходной корзине 16 стран первого среза прирост **0**: DE туда не входит. Поля `comparison.addedByCountry`, `baseMeasurement` и `candidateMeasurement` сохраняют ограниченную старую корзину; этот country panel не является полным all-country breakdown. Полные counts отдельно в `new-valid-occurrences.json`.

Проверены оригинальный h1 и MusicEvent JSON-LD: scheduled/offline, полный год/дата/время, explicit DE, city, venue, event URL = offers URL. Сверена авторитетная saved-native цепочка `ddt.ru → ddt-tour.ru → Bilet.Kartina hall → calendar`. Performer Yuri Shevchuk в group calendar не превратился в другую approved identity: обе public rows — ДДТ, MBID `f7456b5b-e5a5-454e-b5db-047308210c8e`. Каждая public row целиком совпадает с реальной одиночной нормализацией freshly extracted raw; metadata не сплайсилась. В полном live-before target identity ДДТ имеет 0 строк, внутри final cohort обе occurrences уникальны.

Настоящий process предпочитает approved website: public `ticketUrl=https://ddt.ru/`, не operator event URL. Правильные native event URLs, полные raw/public rows и их hashes сохранены отдельно в `final-integrated-replay/new-valid-occurrences.json`. Это доказательство source identity/date/place, не наличия билетов или полноты календаря.

## Все девять target statuses

Все девять approved identities имели 0 строк в полном live-before. Таблица показывает source delta локального same-input replay, не переписанный полный production catalog.

| Target | Base / candidate raw | Новых valid occurrences | Фактический результат |
|---|---:|---:|---|
| ДДТ | 0 / 2 | 2 | Один допущенный native runtime source; Germany. Thai dates не подключены из-за конкретного Lotus Arena terms restriction |
| Oxxxymiron | 0 / 0 | 0 | На saved official TOUR 2026 April–July calendar нет подтверждённых дат после 19.10; вывод ограничен страницей |
| Баста | 0 / 0 | 0 | Явная страна отсутствует; Intickets JS challenge; linked BIG ART также без country; config не создан |
| Макс Корж | 0 / 0 | 0 | Timeouts и неполный native calendar body; не утверждение «нет дат» |
| Zivert | 0 / 0 | 0 | Expired TLS official hosts; полный native calendar не получен; TLS не обходился; не «нет дат» |
| Кино | 0 / 0 | 0 | Official country отсутствует, linked Zakazbiletov reuse restriction; config отсутствует |
| Монеточка | 0 / 0 | 0 | Последний анонс на captured page 05.09.2026; dated no-announced-future-dates-on-this-page |
| Дора | 0 / 0 | 0 | Home/robots timeout; linked BandLink terms restriction и incomplete venue/country; не «нет дат» |
| Lumen | 0 / 0 | 0 | Homepage без country; full-calendar timeout; не «нет дат» |

Detailed source reasons/terms evidence принадлежат `coordinator/work/official-sources-west-REPORT.md` и `official-sources-east-REPORT.md`; их observations не превращались в publish inputs. Ни один blocked/no-dates/incomplete case не назван успешной интеграцией. Машиночитаемые статусы: `final-integrated-replay/all-nine-target-statuses.json`.

## Свежий полный live-before

Хаб выполнил GET 19.10.2026 07:19:12–07:19:18 UTC. Все три оригинальных файла `../live-before/{index,concerts,status}.json` проверены offline по manifest HTTP200, bytes и SHA; `index.stats.totalConcerts == status.publishedConcerts == concerts.length == 48283`. Оригиналы не менялись.

- `index.lastRun=2026-10-18T09:04:35.710Z`; `status.generatedAt=2026-10-18T09:04:35.713Z`.
- `concerts.json`: 35 176 627 bytes, SHA256 `2fd8d7d81fa3e35a9c9c02931dbe440ed5c7c21c433b47c897d0a125cdd368d5`.
- Все nine targets: 0 по canonical name и approved MBID; имя Kino отдельно не включено в «Кино». Live Kino Calgary 20.11.2026 имеет другую MBID `39568c43-87a3-4711-92dd-7a33bd4e92ef`, kinomusic.com; RU Кино — `064db6e8-fdfb-4acb-a327-fc2de75b37de`, kino.band.
- Входные descriptive location examples: 4 NERVY templates, 1 MORGENSHTERN Limassol title, 3 Andru venue=city; AM Երևան 1, GE T'bilisi 3, RS Beograd 11, CY Άγιος Τύχων 1. Категории пересекаются: 21 distinct input row, не прогноз количества исправлений.

`live-validation/{summary,targets,location-before-rows}.json` сохраняют полный учёт и before examples; `validate-live.py` читает только original snapshot. Строки каталога не заявляются независимо проверенными уникальными событиями. Freshness = `index.lastRun - scrapedAt <=72h`, extraction age, не event verification.

## Независимая сверка normalization worker

Источник — финальный replay `../location-normalization/`, revision `d400a809680af1b07da8df901dc460dbf0b7ac07`. Изменённые process/geocode/location/BIT/replay bytes **совпали** с integrated GO candidate; approved shard hashes также совпали. Это заменяет rejected d6b8777 и earlier 611aeed evidence. Full replay использует clock соседнего index (`18.10 09:04:35.710Z`), чтобы проверять сохранение исходного snapshot; это отдельный эксперимент от fresh source clock 19.10.

Валидатор `verify-normalization.mjs` не запускает нормализацию повторно и не дублирует её code. Он проверил все 48 283 исходных before rows, row indexes, identity arrays и input-row hashes по оригинальному live snapshot; сопоставил every before/after field и independently пересчитал types/countries:

- **74 modified**: venue placeholders **61**, city aliases **16**, пересечение **3**; input/output row audit **48 283/48 283**.
- Authoritative lat/lng и все поля вне venue/city сохранены; ни одно событие не добавлено row transformation.
- Production **48 255 → 48 255**; на каждой стороне 28 notApproved (existing Mozarteum provenance guard), остальные dropped reasons = 0, duplicatesMerged = 0.
- Все 74 corrections найдены в published rows. После применения **только записанных audit field diffs** к baseline public rows полные row multisets candidate совпали. Сохранены metadata и multiplicity, без field splicing.
- Normalization-induced loss/dedupe = **0/0**; downstream gained/lost после field corrections = **0/0**; source gain здесь **0**.
- Все восемь required live cases действительно опубликованы с `Unknown Venue`, исходные координаты сохранены. CY Άγιος Τύχων стал **Agios Tychonas**, не Limassol.
- Worker native replay имеет networkAttempts=0 и завершённое idempotence assertion до записи summary. Мною проверены завершённые artifacts/исходный assertion, повторный pipeline не исполнялся.

Country modified/type counts целиком повторно сверены в `final-normalization-validation/verification.json`: AM2, AR2, AU1, BE2, BR1, CA10, CH1, CY1, CZ1, DE2, DK2, EE1, ES5, FI1, FR6, GB2, GE4, IE1, IN6, LT2, PT1, RS11, RU8, TH1. Original full before/after audit сохранён worker: `../location-normalization/rows-before-after.jsonl`, SHA256 `b767168ac175f15c6ce0056924383237e7f1216fb8ad10238340dda4e49d2b4f`. Его hashes и full public before/after hashes зафиксированы в моей verification. Полные 74 modified rows и 8 required published examples скопированы как отдельные проверенные evidence artifacts.

BIT upstream provider recovery отделён: full saved-public snapshot не может восстановить события, отброшенные до публикации. Изменённый native BIT no-discard path покрыт worker fixtures, но количественный production gain от provider recovery **не измерен**. Он не прибавляется к двум новым ДДТ source events.

## Проверки, ограничения и воспроизведение

PASS: pristine exact-base native absence replay выполнен **до изменений harness** — 9 configAbsent, 0 raw/public/HTTP/network/missing; actual DB63 409; code/config/DB identity без изменений. Evidence `preparation/pristine-base/`. PASS внешний harness base-self regression на original first-slice HTTP: identical 7 raw→5 public с нулевой дельтой; это только harness regression, не новый source-success.

PASS в этом финальном запуске: real same-input pipeline на exact GO; original bytes before/after; code/config/DB before/after; одинаковый approved DB и geocode input; 0 missing captures/0 network attempts; independent native event/date/place/URL/identity spot-check; 2 whole-record lineage; все9 statuses; полная normalization row/production multiset сверка. Свои focused replay tests 6/6 и focused eslint/`git diff --check` прошли в подготовке, src/tests после неё не менялись.

Full gates выполнил **хаб**, я проверил completed logs/SHA на exact `319aa04`, не повторяя их: `npm test` **912 total / 911 pass / 0 fail / 1 expected skip**; SSRF, tsc --noEmit, lint, selector ratchet **125<=131**, artist integrity и diff-check — PASS. Первый npm run имел 3 infrastructure failures из-за отсутствующей worktree-local node_modules/tsx ссылки; хаб добавил ignored symlink на уже установленные зависимости, без install/code changes. Повторный npm log/hash/exit0 проверены; первый не скрыт. Итог: `final-integrated-replay/root-gates-verified.json`. External reviewer/owner acceptance относятся к хабу и этим измерением не заявляются.

Known gaps: восемь targets без eligible runtime configs; Thailand ДДТ исключён по source restriction; network geocoding и реальные production caches не участвовали, новые coordinates pending; источник не проверен на полноту или ticket availability; BIT provider recovery count не измерен; нет deploy/live-after publication. Affected-cohort 0→2 нельзя прибавлять к full snapshot как доказательство нового production total. Ни push, PR, dispatch, deploy, external contacts/forms, auth repair, agreements, DB writes или budget/cadence changes не выполнялись.

Команда выполненного replay (out при повторе должен быть новым и пустым):

```sh
node --import tsx /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-published-measurement-20261019/src/scripts/ru_data_expansion_replay.ts --base /Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/base-bc5e20d --candidate /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-ru-data-2-20261019 --inputs /Users/alex/agent-hub/concerts-ru-data-2/evidence/measurement/final-inputs/inputs.json --out /ABS/NEW/EMPTY/REPLAY
```

Final primary artifacts: `final-inputs/{inputs,originals-before}.json`, `final-integrated-replay/{comparison,delta,new-valid-occurrences,all-nine-target-statuses,verified-invariants,originals-after,root-gates-verified}.json`, per-side `identity-before/after`, `raw.json`, `row-provenance.json`, `processing.json`, `public/`, logs. Native audit script `audit-final.mjs` и normalization validator используют только saved evidence; новые scraping/pipeline реализации не созданы. Полный byte index — `final-evidence-index.json`.
