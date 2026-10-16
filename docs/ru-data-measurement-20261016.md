# Финальный same-input replay — 16.10.2026

**Final candidate даёт 35 published строк вместо 52: добавлены 8 подтверждённых native-источниками выступлений, исправлены две локации Браво и удалены 25 ошибочных строк.** Из новых выступлений 7 имеют дату строго после 16 октября; Varna Би-2 — сегодня и не включена в этот показатель. В целевых 16 странах новое выступление одно: Andru Donalds, Ереван, 21.11.2026. Это локальный affected-cohort replay, не изменение live API и не owner acceptance.

Этот результат **заменяет intermediate 52→58 как актуальное состояние**. Исторические evidence paths ниже сохранены; их старые PENDING, bdva.ru и промежуточные счётчики относятся к предыдущим контрольным точкам.

## Ревизии и frozen inputs

| Поле | Фактическое значение |
|---|---|
| Base | `6af49b13628cd0eeb728f16d62bdaaa17a94e069`, actual DB 63 390 |
| Final candidate | `45e9dd69a1622891ff7a33909046dfc9332403b0`, actual DB 63 397 |
| Frozen clock | `2026-10-16T19:17:51.765Z`, позже latest capture `2026-10-16T19:06:52.587843Z` |
| Anchor / окно | 2026-10-16 / 2026-10-30..2027-01-14 inclusive |
| Inputs SHA256 | `d1e4dfce879aa496ba6b71266a1a17fd15fcbdc8b3b36e722c908a5006f20052` |
| Harness SHA256 | `ec086f039815b2b1a381798561fd193861908e3bfd6f80c01288c7c442741b74` |
| Base code/DB/config fingerprint | `1cb20da037a555cbc4c5c0ca1ff089300d366f9f0c6fef85469d4c25837f10c2` |
| Candidate code/DB/config fingerprint | `d9465cb13121751053cef4eb73f62ce2e11e7e59a554c55f4aca143dd1e9b313` |

На каждой стороне identity-before/after совпали по HEAD и code/DB/config hashes; dirty state пустой. GO сначала называл e8dc814, затем root сделал fixture-only amend; candidate реально стартовал уже на 45e9dd6, старый HEAD не участвовал в candidate replay. Actual approved DB читалась настоящим artistDb через process, без подмены или записей.

Evidence root `/Users/alex/agent-hub/concerts-ru-data/evidence/measurement/`: final manifest `final-integrated-inputs/inputs.json`, результат `final-integrated-replay/`, общий byte/SHA index `final-integrated-replay/evidence-index.json`. Тринадцать config paths: retired solo Zhenya существует на base, candidate configAbsent; Bi2/Tomsarkgh отсутствуют на base. Все original decoded/wire body hashes проверены; raw вручную не вставлялись.

Реально выполнены collection/standard runner/custom modules → normalization/approval/whitelist → whole-record dedup → publishConcerts JSON. Tomsarkgh использовал listing+3 detail responses. **0 network attempts / 0 missing captures** на обеих сторонах, 11 captured HTTP reads base и 15 candidate. Каждая public row совпадает целиком с реальной одиночной нормализацией raw; rejected rows/dedup losers и source URLs сохранены в row-provenance.json. Metadata не сплайсилась.

## Дельта строк и выступлений

| Метрика | Base | Candidate |
|---|---:|---:|
| Raw |108|89|
| Published всей когорты, date>=today |52|35|
| Published strictly after today |52|34|
| Окно 14–90 всей когорты |28|18|
| Корзина 16 стран, date>=today |52|28|
| Окно 14–90 корзины |28|16|
| Окно корзины и freshness<=72h |28|16|

Механическая дельта: **10 added / 27 removed / 0 changed whole-record metadata**. Все added/removed классифицированы; unclassified нет:

- **8 новых unique occurrences**: 7 обычных concert cards Би-2 + Andru Donalds; 7 strictly-after-today, 3 в окне 14–90. В target16 только Andru AM, он же в окне. Семь дат Би-2 вне target16.
- **2 location repairs Браво**: те же даты, Atmosphere/Москва и Aurora Concert Hall/Санкт-Петербург. Старые строки содержали venue+city в обоих полях; это две added с двумя paired removed, не новые концерты.
- **24 wrong-solo rows удалены**: retired fallback Женя Трофимов ошибочно дублировал календарь группы Комната культуры. Для каждой removed сохранена соответствующая целая group row; все 24 group rows остались. Source-worker дополнительно доказал active-cache exclusion реальным filterArtistCacheForActiveConfigs: `evidence/sources/regional-sources/komnata-followup/`. Fresh replay не фабрикует production caches.
- **1 phantom year удалён**: Винтаж 2027-08-30. Primary ticket href содержит 2026-08-30, уже прошедший на frozen clock; перенос в 2027 был необоснованным.

## Новые выступления и native evidence

Все восемь проверены по сохранённым первичным HTML, затем сопоставлены с whole-record publisher lineage. Это подтверждение source identity/date/place, не available tickets, не owner acceptance и не source completeness. Полные URL, capturedAt/body/wire/raw/public-record hashes, исходные тексты и lineage каждого события — `new-unique-occurrences.json`, `source-url-inventory.json`. Evidence-only scripts `native-audit.cjs` и `classify-final.cjs` не передают строки в collection/pipeline.

| Артист | Native дата/время | Страна / город | Venue | Native event URL | Класс |
|---|---|---|---|---|---|
| Би-2 | 2026-10-16 20:00 | BG / Varna | Palace of Culture and Sports | https://tix.bi2.band/events/bi2/2379649 | сегодня; без still-future claim / вне target16 |
| Би-2 | 2026-10-18 20:00 | BG / Sofia | Joy Station | https://tix.bi2.band/events/bi2/2379745 | strictly after today / вне target16 |
| Би-2 | 2026-10-22 20:00 | HU / Budapest | Barba Negra | https://tix.bi2.band/events/bi2/2380217 | strictly after today / вне target16 |
| Би-2 | 2026-10-26 20:00 | SI / Ljubljana | Cvetlicarna | https://tix.bi2.band/events/bi2/2379512 | strictly after today / вне target16 |
| Би-2 | 2026-10-28 20:00 | HR / Zagreb | Tvornica Kulture | https://tix.bi2.band/events/bi2/2380407 | strictly after today / вне target16 |
| Би-2 | 2026-11-15 20:00 | CH / Geneva | Alhambra | https://tix.bi2.band/events/bi2/2387477 | strictly after today / вне target16 |
| Би-2 | 2026-11-17 20:00 | DE / Ludwigsburg | MHP Arena | https://tix.bi2.band/events/bi2/2388544 | strictly after today / вне target16 |
| Andru Donalds | 2026-11-21 19:00 | AM / Yerevan | Aram Khachaturyan Concert Hall | https://www.tomsarkgh.am/en/event/51067/Andru-Donalds.html | strictly after today / target16 |

Bi2: identity календаря `Bi-2 / Би-2`, ordinary bilingual concert titles и полный printed год/дата/время/place. Country подтверждён **точной package card той же даты/city/location**, не угадан по городу. Package-only Belgrade/Hangar и Limassol/Etko удержаны без public concerts. В новых строках из integrated DB теперь `artistWebsite/ticketUrl=https://b2band.com/ru`, MBID `5ca35ace-4006-4d4a-af04-5cd91dafab14`; старый bdva.ru не сплайсился вручную.

Andru: native performer heading, Concert category, полная дата `2026-11-21 19:00`, Aram Khachaturyan Concert Hall и `46 Mashtots street, Yerevan, Armenia`; cancellation/postponement в проверенных title/description не обнаружены. ENIGMA в заголовке не стало дополнительным performer. Akmal и Lyubov Uspenskaya остаются raw not-approved; whitelist ради source gain не расширялась.

Существующий public ticketUrl предпочитает approved.website перед raw.ticketUrl: Andru ведёт на `https://www.andrudonalds.org`, Би-2 на b2band.com/ru. Это не native operator event links; отдельный URL inventory сохраняет правильные event URLs. Varna date=16.10 сохраняется по date>=today, но в строго будущий прирост не включена; native20:00 не доказывает текущий show-state.

## 16 стран и resorts: before/after

Все строки этой когорты date>=16.10, поэтому allDates=allFuture в каждой стране. Freshness — `frozen lastRun - replay scrapedAt<=72h`, не новые production verifiedAt. Это не заменяет и не пересчитывает live 853/533/345.

| Страна | All/future base | All/future candidate | Окно base | Окно candidate | Fresh base | Fresh candidate |
|---|---:|---:|---:|---:|---:|---:|
| TR | 0 | 0 | 0 | 0 | 0 | 0 |
| RU | 48 | 25 | 24 | 13 | 24 | 13 |
| TH | 0 | 0 | 0 | 0 | 0 | 0 |
| RS | 0 | 0 | 0 | 0 | 0 | 0 |
| ID | 0 | 0 | 0 | 0 | 0 | 0 |
| AE | 0 | 0 | 0 | 0 | 0 | 0 |
| AM | 0 | 1 | 0 | 1 | 0 | 1 |
| CN | 0 | 0 | 0 | 0 | 0 | 0 |
| KZ | 4 | 2 | 4 | 2 | 4 | 2 |
| VN | 0 | 0 | 0 | 0 | 0 | 0 |
| GE | 0 | 0 | 0 | 0 | 0 | 0 |
| EG | 0 | 0 | 0 | 0 | 0 | 0 |
| CY | 0 | 0 | 0 | 0 | 0 | 0 |
| BY | 0 | 0 | 0 | 0 | 0 | 0 |
| UZ | 0 | 0 | 0 | 0 | 0 | 0 |
| ME | 0 | 0 | 0 | 0 | 0 | 0 |

Требуемые отпускные города и все ненулевые группы ниже; полный перечисленный alias mapping/все zero rows — `classified-final.json`, `comparison.json`. Antalya/Alanya и Bangkok/Phuket раздельны, membership районов не угадывается.

| Город (exact aliases) | Future base | Future candidate | Окно base | Окно candidate | Fresh base | Fresh candidate |
|---|---:|---:|---:|---:|---:|---:|
| TR Antalya (Antalya, Анталья) | 0 | 0 | 0 | 0 | 0 | 0 |
| TR Alanya (Alanya, Аланья) | 0 | 0 | 0 | 0 | 0 | 0 |
| RU Sochi (Sochi, Сочи) | 2 | 1 | 2 | 1 | 2 | 1 |
| RU Moscow (Moscow, Москва) | 9 | 6 | 4 | 3 | 4 | 3 |
| RU Saint Petersburg (Saint Petersburg, St Petersburg, Санкт-Петербург) | 3 | 2 | 0 | 1 | 0 | 1 |
| TH Bangkok (Bangkok, Бангкок) | 0 | 0 | 0 | 0 | 0 | 0 |
| TH Phuket (Phuket, Пхукет) | 0 | 0 | 0 | 0 | 0 | 0 |
| TH Pattaya (Pattaya, Muang Pattaya, Паттайя) | 0 | 0 | 0 | 0 | 0 | 0 |
| AE Dubai (Dubai, Дубай) | 0 | 0 | 0 | 0 | 0 | 0 |
| AE Abu Dhabi (Abu Dhabi, Абу-Даби) | 0 | 0 | 0 | 0 | 0 | 0 |
| AM Yerevan (Yerevan, Երևան, Ереван) | 0 | 1 | 0 | 1 | 0 | 1 |
| KZ Almaty (Almaty, Алматы) | 2 | 1 | 2 | 1 | 2 | 1 |
| KZ Astana (Astana, Астана) | 2 | 1 | 2 | 1 | 2 | 1 |

## Проверки, ограничения и граница результата

Root выполнил final gates на **45e9dd6**: `npm test` **888 total / 887 pass / 0 fail / 1 expected skip**; отдельный production SSRF **1/1 PASS**; tsc/build/lint PASS (0 errors, 103 existing warnings); selector **125<=131**; artist integrity **156<=156**. Первичные logs+SHA — `/Users/alex/agent-hub/concerts-ru-data/evidence/final-checks/results.json`. Measurement сверил все exitCode и каждый log hash, не повторяя gates: `final-integrated-replay/root-gates-verified.json`. Логи Node используют Unicode ℹ summary; parsing поддерживает ℹ и TAP #. Старое baseline Antoha failure остаётся в baseline evidence; clock-only test correction не ослабила production stale-date guard.

Ограничения: affected cohort не содержит full production cache/provider/geocode composition. TM key и explicit BIT app id отсутствовали, provider HTTP не выполнялся. У UOB сохранён initial redirect, но нет terminal timeout response: source исключён, ответ не выдуман. Antoha captured page остаётся sourceFailed (прошлая дата в upcoming section). Zero-yield not-approved источники не названы repaired. У 24 оставшихся group Komnata rows только 11 embedded full-year witnesses; 13 сохраняют general parseDate behavior без отдельно подтверждённого native года, их owner-correctness не заявляется. Downstream JSON/Instagram rights не создаются replay. Production publication не выполнялась.

Candidate public SHA256 `c22f3d51ff8b8f2a0f8f890bc3d2c10cb2ceeaa57467bf441a9863b6140f484c`; base public SHA256 `e8686018e1ff91fc8b3f596c9812bb8adfcd6c068a4e8b34c4e0f1c5af864131`. Это локальные cohort outputs. **Live отдельно:** 49 651 строка, lastRun `2026-10-16T09:12:22.120Z`, concerts SHA256 `e1b6124c697a2ef7cd7106dd802036d0622a92944be810057da9cd127372f1ca`. Приращение production из cohort delta не вычислялось.

## Воспроизведение

Actual run использовал out `.../evidence/measurement/final-integrated-replay`. Для нового прогона out обязан быть новым/пустым; manifest clock и source bytes сохраняются:

```sh
node --import tsx /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-ru-data-20261016/src/scripts/ru_data_expansion_replay.ts --base /Users/alex/code/concert-for-travelers-api/.worktrees/verification/concert-ru-measurement-base-6af49b1 --candidate /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-ru-data-20261016 --inputs /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/final-integrated-inputs/inputs.json --out /ABS/NEW/EMPTY/REPLAY
node /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/final-integrated-inputs/native-audit.cjs /ABS/REPO/WITH/CHEERIO /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/final-integrated-inputs/inputs.json /ABS/NEW/NATIVE-AUDIT.json
node /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/final-integrated-inputs/classify-final.cjs /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/final-integrated-inputs /ABS/NEW/EMPTY/REPLAY
```

Зафиксированный независимый native audit уже лежит в `final-integrated-inputs/native-correctness-audit.json`; classifier проверяет его manifest hash. Root интегрирует этот doc-only commit и сообщит общий окончательный HEAD. Source/DB/integration files этим worker не изменялись. Реестр: `/Users/alex/agent-hub/concerts-ru-data/questions.md`.

---

**Архив предыдущего baseline/harness пакета.** Старые PENDING, source-only 52→58 и прежние metadata snapshots ниже заменены финальной секцией выше; исходные proof paths сохранены.

## Исторический baseline и промежуточные replay — 16.10.2026

Свежий live baseline воспроизвёл gaps §2/6: **853 строки → 533 в окне → 345 свежих** для 16 стран. Это записи существующего опубликованного каталога, не проверенные уникальные концерты и не результат локальных исправлений.

## Зафиксированный live-снимок

GET 2026-10-16 18:54:28–18:54:32 UTC, project UA `concert-for-travelers-api/measurement (+https://github.com/cartograf666/concert-for-travelers-api)`. Root URL: `https://cartograf666.github.io/concert-for-travelers-api/`.

- `index.json`: lastRun `2026-10-16T09:12:22.120Z`, 49 651 строк; SHA256 `4dfc689d3c776c60c76542420c1750ad1c5ce539565d8890f8e666d4df28039b`.
- `concerts.json`: 36 177 082 bytes; SHA256 `e1b6124c697a2ef7cd7106dd802036d0622a92944be810057da9cd127372f1ca`.
- `status.json`: SHA256 `64dff2d014ad31910f5a5c806f9a302f5001010d4216cb988369f106e6ad9bd1`, generatedAt `2026-10-16T09:12:22.124Z`.
- `manifest.json`, `run-manifest.json`, `venue-run-manifest.json`, `artist-run-manifest.json` вернули HTTP404. Code сохраняет cohort manifests в workflow reports; отсутствие публичных файлов не доказывает отсутствие workflow artifacts. Авторизованный artifact download здесь не выполнялся.

Actual bytes, URL, capturedAt, headers, hash: `/Users/alex/agent-hub/concerts-ru-data/evidence/measurement/live/capture.json`. Ответы gzip другого worker могут иметь иной wire hash; JSON нашего снимка сохранён как получен Python urllib без Accept-Encoding.

Метод: clock 2026-10-16 UTC; будущее означает дату >=2026-10-16; окно **2026-10-30..2027-01-14 включительно**; свежесть `lastRun - scrapedAt <=72h`, как в gaps. Это возраст извлечения, не verifiedAt события. Невалидные scrapedAt не свежие; scrapedAt после lastRun отдельно перечисляются в `futureScrapedAt`. Date-only сравнение, без догадки о часовых поясах концертной площадки.

| Страна | Все даты | Будущее | Окно 14–90 | Окно и <=72h |
|---|---:|---:|---:|---:|
| TR | 529 | 529 | 344 | 263 |
| RU | 89 | 89 | 47 | 26 |
| TH | 53 | 53 | 40 | 8 |
| RS | 42 | 42 | 16 | 10 |
| ID | 40 | 40 | 22 | 1 |
| AE | 38 | 38 | 31 | 14 |
| AM | 27 | 27 | 19 | 18 |
| CN | 19 | 19 | 6 | 1 |
| KZ | 5 | 5 | 4 | 4 |
| VN | 4 | 4 | 0 | 0 |
| GE | 3 | 3 | 1 | 0 |
| EG | 3 | 3 | 3 | 0 |
| CY | 1 | 1 | 0 | 0 |
| BY | 0 | 0 | 0 | 0 |
| UZ | 0 | 0 | 0 | 0 |
| ME | 0 | 0 | 0 | 0 |

## Города отдыха и явные aliases

Это точные строковые aliases, не геокодер: Antalya и Alanya, Bangkok и Phuket, Jakarta и Bali остаются разными строками. Районы не присоединяются автоматически. Полный перечисленный mapping всех 16 стран хранится в `CITY_ALIASES` скрипта и в `resorts[].aliases` результата, все несовпавшие строки — `unmatchedCityStrings`.

| Страна/город | Принятые aliases | Все даты | Будущее | Окно | Свежие в окне |
|---|---|---:|---:|---:|---:|
| TR / Antalya | Antalya, Анталья | 34 | 34 | 20 | 16 |
| TR / Alanya | Alanya, Аланья | 0 | 0 | 0 | 0 |
| TR / Istanbul | Istanbul, İstanbul, İstanbul, Стамбул | 178 | 178 | 111 | 93 |
| RU / Sochi | Sochi, Сочи | 2 | 2 | 2 | 2 |
| RU / Moscow | Moscow, Москва | 10 | 10 | 5 | 5 |
| RU / Saint Petersburg | Saint Petersburg, St Petersburg, Санкт-Петербург | 4 | 4 | 1 | 0 |
| TH / Bangkok | Bangkok, Бангкок | 18 | 18 | 16 | 2 |
| TH / Phuket | Phuket, Пхукет | 0 | 0 | 0 | 0 |
| TH / Pattaya | Pattaya, Muang Pattaya, Паттайя | 7 | 7 | 7 | 1 |
| RS / Belgrade | Belgrade, Beograd, Белград | 40 | 40 | 15 | 10 |
| ID / Bali | Bali, Бали | 0 | 0 | 0 | 0 |
| ID / Denpasar | Denpasar, Денпасар | 0 | 0 | 0 | 0 |
| ID / Canggu | Canggu, Чангу | 0 | 0 | 0 | 0 |
| ID / Jakarta | Jakarta, Джакарта | 8 | 8 | 8 | 0 |
| AE / Dubai | Dubai, Дубай | 20 | 20 | 15 | 9 |
| AE / Abu Dhabi | Abu Dhabi, Абу-Даби | 14 | 14 | 12 | 5 |
| AM / Yerevan | Yerevan, Երևան, Ереван | 27 | 27 | 19 | 18 |
| CN / Beijing | Beijing, Пекин | 1 | 1 | 0 | 0 |
| CN / Shanghai | Shanghai, Шанхай | 4 | 4 | 1 | 0 |
| CN / Sanya | Sanya, Санья | 0 | 0 | 0 | 0 |
| KZ / Almaty | Almaty, Алматы | 3 | 3 | 2 | 2 |
| KZ / Astana | Astana, Астана | 2 | 2 | 2 | 2 |
| VN / Da Nang | Da Nang, Đà Nẵng, Дананг | 0 | 0 | 0 | 0 |
| VN / Nha Trang | Nha Trang, Нячанг | 0 | 0 | 0 | 0 |
| VN / Phu Quoc | Phu Quoc, Phú Quốc, Фукуок | 0 | 0 | 0 | 0 |
| GE / Tbilisi | Tbilisi, T'bilisi, Тбилиси | 3 | 3 | 1 | 0 |
| GE / Batumi | Batumi, Батуми | 0 | 0 | 0 | 0 |
| EG / Sharm El Sheikh | Sharm El Sheikh, Sharm El-sheikh, Шарм-эль-Шейх | 2 | 2 | 2 | 0 |
| EG / Hurghada | Hurghada, Хургада | 0 | 0 | 0 | 0 |
| EG / Cairo | Cairo, Каир | 0 | 0 | 0 | 0 |
| CY / Limassol | Limassol, Лимасол | 1 | 1 | 0 | 0 |
| CY / Paphos | Paphos, Пафос | 0 | 0 | 0 | 0 |
| BY / Minsk | Minsk, Минск | 0 | 0 | 0 | 0 |
| UZ / Tashkent | Tashkent, Ташкент | 0 | 0 | 0 | 0 |
| ME / Budva | Budva, Будва | 0 | 0 | 0 | 0 |
| ME / Podgorica | Podgorica, Подгорица | 0 | 0 | 0 | 0 |

По точным исходным четырём городам Antalya/Dubai/Abu Dhabi/Bangkok: 32 свежие строки, 17 city/weeks, 4 механические тройки. По корзине 184 группы `(country, exact city, ISO-week)`, 39 троек `sum(floor(unique artist names /3))`, 3 вне TR. По неделям W44..W53 2026 и W01..W02 2027: **6,8,7,3,3,4,4,1,1,0,2,0**. Это воспроизводит capacity анализа; количество корректных постов или любимых артистов пользователя не установлено.

Три строки `city=Antalya` содержат Alanya в venue; они перечислены в `geographyWarnings`, сохранены как опубликованы и не переведены молча в Alanya. Аналогично `Tambon Choeng Thale` не назван Phuket, а `Kabupaten Badung` не назван Bali без отдельной проверки географии. Нулевой exact-alias счётчик не означает отсутствия концертов в регионе.

## Повторение измерения

Из worktree с существующим node_modules:

```sh
node --import tsx src/scripts/ru_data_expansion_replay.ts --live /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/live --out /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/live-analysis
```

Скрипт проверяет hashes исходных bytes и index.stats.totalConcerts, сохраняет `live-measurement.json`. Этот режим offline. Live GET был отдельным read-only capture; повторение анализа не получает меняющийся live повторно. Эквивалент исходного capture-script сохранён как `evidence/measurement/capture_live.py`; для нового снимка `python3 /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/capture_live.py --out /ABS/NEW/DIRECTORY`. Он никогда не перезаписывает baseline. После сохранения этот helper не запускался повторно.

## Replay: входы, путь и границы доказательства

Ближайшая существующая основа: `tests/normalization_integrity_replay.mjs`, который подменяет axios GET и запускает реальные runner/process с запретом сети. Новый script адаптирует эту схему для двух произвольных worktrees, их настоящих approved DB и реального `publishConcerts`. Общие модули не меняются.

Manifest JSON (body/savedRaw относительно manifest):

```json
{
  "clock": "2026-10-16T00:00:00.000Z",
  "label": "affected cohort and capture scope",
  "sources": [{
    "configPath": "scrapers/artists/artist-example.json",
    "responses": [{
      "url": "https://source.example/tour",
      "body": "captured.html",
      "sha256": "sha256-of-saved-bytes",
      "status": 200,
      "wireBody": "optional-original-compressed.body",
      "wireSha256": "optional-sha256-of-original-wire",
      "capturedAt": "actual-capture-time",
      "headers": {"content-type": "text/html"}
    }],
    "savedRaw": "optional-observed-raw.json"
  }]
}
```

Здесь только описание структуры, не новые события. Config берётся из каждого worktree; новая отсутствующая в base конфигурация явно `configAbsent`. Никаких invented raw rows или копирования public records в raw. Каждый HTTP URL custom parser должен иметь сохранённый ответ. Wire gzip поддержан по magic bytes. Для Brotli/другого сжатия используйте сохранённый decodedBody с его SHA и отдельно wireBody/wireSha256; оба проверяются. Hash всегда по указанным сохранённым bytes. URL нормализуется стандартным URL.href (в частности root slash), query не отбрасывается. axios responseType:text сохраняет JSON как строку, как настоящий runner; axios redirects требуют всех capture hops. fetch redirect без manual явно отвергается до симуляции результата. Один response на URL в source; неоднозначные разные ответы одного URL требуют отдельного capture contract. `savedRaw` сравнивается без scrapedAt лишь как аудиторское доказательство; в publish идут только повторно извлечённые реальные строки.

```sh
node --import tsx src/scripts/ru_data_expansion_replay.ts --base /Users/alex/code/concert-for-travelers-api/.worktrees/verification/concert-ru-measurement-base-6af49b1 --candidate /ABS/PATH/TO/FINAL-CANDIDATE --inputs /ABS/PATH/TO/inputs.json --out /ABS/PATH/TO/NEW-REPLAY-DIRECTORY
```

Base HEAD обязан быть `6af49b13628cd0eeb728f16d62bdaaa17a94e069`, src/scrapers/DB clean. Каждый worker child process импортирует runner/schema/process/publisher именно своего worktree; clocks и HTTP inputs одинаковы; TZ UTC. node_modules может быть symlink на уже установленный проектный каталог. Worker проверяет code/DB/config hashes до/после, manifest hash проверяется после обеих сторон. В `identity-before.json` — git HEAD, dirty status и hashes реальных файлов; approved DB читается только через существующий process/artistDb.

Collection -> matching/approval/normalization -> whole-record dedup -> publishConcerts -> actual `public/concerts.json`. Official context создаётся настоящим `buildOfficialArtistContext` только для активных подтверждённых в replay configs. Запись DB активности и network enrichment/geocoding не запускаются. Снимки production caches отсутствуют; не моделируются условные 304 и last-good retention. Playback `playwright_render` намеренно отвергается с явным gap: HTML не подменяет render state.

Mock boundary — axios.get и fetch; SCRAPER_HTTP_BACKEND=axios обозначает контракт сохранённого HTTP-ответа. Socket/DNS guard блокирует несохранённую сеть. В summary отдельно `capturedHttpReads`, `missingCaptures`, `networkAttempts`; offline должен иметь **0 network attempts и 0 missing captures**. Иные HTTP clients/custom browser требуют поддержанного adapter и не обходят guard. Source failure сохранён как `completed-with-source-failures`, не как успешный рост.

Артефакты: `raw.json`, per-source result, `processing.json`, `public/*`, `row-provenance.json` с каждым отклонённым raw и dedup loser, `measurement.json`; на верхнем уровне `delta.json` (added/removed/changed целые записи), `new-events-review.json` для проверки источника/идентичности и `comparison.json`. Каждая public запись должна совпасть целиком с результатом одиночной обработки реальной raw строки. Точки входа источника и hashes HTTP сохранены в provenance; это source-input-set lineage, не выдуманный DOM selector на каждое поле. Existing-record metadata не склеивается.

Same-input gain — только механический итог затронутого cohort; `new-events-review.json` требует source/owner spot-check, прежде чем назвать события корректными. Его нельзя вычитать из 49 651 live или прибавлять к production. Финальная композиция и её gates принадлежат root.

## Фактически выполнено

На точном immutable base в `evidence/measurement/base-checks/`:

| Команда | Результат |
|---|---|
| npm test | 859 total / 857 pass / 1 fail / 1 skip |
| npx tsc --noEmit | PASS |
| npm run lint | PASS, 0 errors, 103 existing warnings |
| npm run --silent audit-city-selectors -- --json | 125 <= baseline 131, PASS |
| npm run test:ssrf-policy | 1/1 PASS без localhost override |
| npm run audit-artist-integrity -- --strict | 156 <= unchanged baseline 156, PASS |

Full logs, commands, startedAt и hashes — `base-checks/results.json`. Эти результаты не заменяются последующим passing subset.

Единственное исходное падение: `tests/artist_antoha_mc_calendar_20261007.test.ts:26`, expected healthy empty. На 16 октября runner передаёт текущую дату; сохранённый upcoming film 15 октября уже past, parser отвергает страницу до классификации film. Прямой вызов в том же тесте получает фиксированное 7 октября. Точечный diagnostic с frozen Date **3/3 PASS**:

```sh
node --import tsx -e "require('node:test').mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-07T10:00:00.000Z')}); require('./tests/artist_antoha_mc_calendar_20261007.test.ts')"
```

Лог `base-checks/antoha-frozen-clock.log`. Это time-dependent baseline test, не browser/tool failure; полный исходный suite остаётся FAIL. Никаких ослаблений guards/ожиданий в этом пакете.

Harness smoke: сохранённый repository native excerpt Admiral Fallow (5 raw -> 5 public) на обеих сторонах; **0 added / 0 removed / 0 changed**, 0 network attempts, 0 missing captures. `/Users/alex/agent-hub/concerts-ru-data/evidence/measurement/harness-smoke/inputs.json`, `original-proof.json` и `replay/comparison.json`. Это старый fixture exercise, не свежий RU/regional прирост. Фокусные metric/HTTP tests 4/4 PASS, tsc и focused eslint PASS. Анталья/Аланья и Бангкок/Пхукет не смешиваются; проверены inclusive boundaries и lastRun freshness.

Presence-only local environment: `TICKETMASTER_API_KEY`, `TM_API_KEY`, `BANDSINTOWN_APP_ID` отсутствуют. TM/ BIT live rerun здесь не выполнен. Fallback BIT app id в проекте не означает разрешение broad reuse и не использован. Budgets/cadence не менялись.

## Остаётся root / следующему запуску

Архивный smoke не включает итоговый candidate code/DB. Региональные inputs уже доступны; самостоятельные региональные replay отмечаются ниже по фактическому завершению. Root может передать конечный manifest и candidate path для повторного запуска либо выполнить команду сам. Финальный combined raw-to-public replay и проверка новых корректных событий пока **PENDING**, production gain не заявляется.

Реестр решений: `/Users/alex/agent-hub/concerts-ru-data/questions.md`. Нет push/PR/main merge/deploy, регистрации ключей, outbound сообщений или правок sibling app/DB/config/shared modules.


## Реальный initial existing-cohort replay

`evidence/measurement/regional-decoded-replay/comparison.json`: 11 существующих конфигов; base и код до source-изменений **108 raw → 52 published**, **0 added / 0 removed / 0 changed**. Все сохранённые observed raw совпали с повторным извлечением, кроме намеренно frozen scrapedAt. Обе стороны имеют 0 network attempts и 0 missingCaptures, 11 captured HTTP reads. Отказы: 43 notApproved, 13 pastDate; отдельный Antoha source parse failure сохранён. Public: RU48, KZ4; в окне RU24/KZ4, все свежие по frozen clock. Это затронутая когорта, не полный каталог и не новый gain.

Manifest `evidence/measurement/regional-inputs/inputs-decoded.json` с отдельными wire/decoded SHA. UOB исключён в `excluded-sources.json`: initial301 есть, terminal redirect/timeout body отсутствует. TM/BIT HTTP inputs отсутствуют; ключи не создавались, fallback id не использовался.

Первый wire-only прогон `regional-initial-replay` дал 96 raw/52 public из-за попытки читать Brotli Fabrika как текст. Он сохранён для аудита и **заменён** decoded прогоном: decoded hash совпал с реальным Brotli decompression wire. Это defect harness capture boundary, не новый дефект сайта/selector. Никакие raw строки не редактировались ради parity.


## Реальный source-candidate replay (до final identity/AM composition)

`evidence/measurement/regional-source-candidate-replay/comparison.json`, exact base `6af49b13628cd0eeb728f16d62bdaaa17a94e069`, actual regional candidate **`04d58929fbc6d3d488b1d712d1e3046cb06050b0`**. На обеих сторонах реальная approved DB по 63 390 записей, shard/code/config hashes в identity-before/after; DB не подменялась. Input manifest `regional-inputs/inputs-regional-candidate.json`, clock `2026-10-16T00:00:00.000Z`, 12 configs (Bi2 отсутствует на base). На обеих сторонах 0 network attempts, 0 missing captures; Antoha sourceFailed явно сохранён.

**108 raw / 52 public → 110 raw / 58 public**. По настоящему ключу pipeline: 9 added / 3 removed / 0 changed. Из added семь новых дат Би-2, две — исправления города/площадки Браво с соответствующими двумя removed. Третья removed — ложная Винтаж 2027-08-30. Изменения представлены полными записями, без сплайсинга metadata.

**Семь новых дат Би-2 находятся ВНЕ корзины 16 стран.** Внутри 16 стран 52 → 51: RU48 → RU47 (удаление ложной строки), KZ4 → KZ4; окно28 →28, свежие28 →28. Это не рост целевого странового покрытия. Улучшена корректность двух городских строк RU; Belgrade/Hangar и Limassol/Etko в capture — package-only и не опубликованы parser, source worker удержал их без обычного concert ticket. Проверка этих двух потерь остаётся отдельным source/owner gap, не выдумываем даты.

| Added artist | Date | Country | City | Venue | Вид изменения |
|---|---|---|---|---|---|
| Би-2 | 2026-10-16 | BG | Varna | Palace of Culture and Sports | новая native дата, требуется source spot-check |
| Би-2 | 2026-10-18 | BG | Sofia | Joy Station | новая native дата, требуется source spot-check |
| Би-2 | 2026-10-22 | HU | Budapest | Barba Negra | новая native дата, требуется source spot-check |
| Би-2 | 2026-10-26 | SI | Ljubljana | Cvetlicarna | новая native дата, требуется source spot-check |
| Би-2 | 2026-10-28 | HR | Zagreb | Tvornica Kulture | новая native дата, требуется source spot-check |
| Би-2 | 2026-11-15 | CH | Geneva | Alhambra | новая native дата, требуется source spot-check |
| Би-2 | 2026-11-17 | DE | Ludwigsburg | MHP Arena | новая native дата, требуется source spot-check |
| Браво | 2026-11-21 | RU | Москва | Atmosphere | location repair, old key removed |
| Браво | 2026-11-28 | RU | Санкт-Петербург | Aurora Concert Hall | location repair, old key removed |

`new-events-review.json` содержит все added целые записи и raw/HTTP provenance с source URLs; `delta.json` сохраняет все removed. Называть механическую публикацию owner acceptance или confirmed ticket availability нельзя. Финальная artist DB и Tomsarkgh AM pilot здесь ещё не интегрированы.

Точная выполненная команда (из measurement worktree):

```sh
node --import tsx src/scripts/ru_data_expansion_replay.ts --base /Users/alex/code/concert-for-travelers-api/.worktrees/verification/concert-ru-measurement-base-6af49b1 --candidate /Users/alex/code/concert-for-travelers-api/.worktrees/agent/concerts-regional-sources-20261016 --inputs /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/regional-inputs/inputs-regional-candidate.json --out /Users/alex/agent-hub/concerts-ru-data/evidence/measurement/regional-source-candidate-replay
```

Для final replay root повторяет команду с новым пустым out, окончательным integration worktree и manifest, дополненным Tomsarkgh captures. Harness package завершён; финальные same-input интеграция/spot-check/gates остаются root-owned, production gain не заявлен.


Следующая авторитетная граница из inbox hub 22:09: identity `e1f4e0c` уже интегрирована в root; **final** candidate только integration worktree после regional+Tomsarkgh composition. Final clock должен быть не раньше последнего source capture; ранний `2026-10-16T00:00:00Z` выше — явно искусственный benchmark clock, не утверждение, что извлечение произошло до реального GET. Для day14–90 используйте anchor-date 2026-10-16; в текущем task final clock остаётся на этом UTC дне.

В source-only replay Би-2 ещё получил из старой реальной DB `artistWebsite/ticketUrl=https://bdva.ru/`, MBID отсутствует. Это дополнительная причина не объявлять эти строки финально корректными до integrated identity replay. Исходные source URLs сохранены в raw/provenance, official URL вручную не сплайсился.
