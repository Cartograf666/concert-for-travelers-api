# Live baseline и same-input replay — 16.10.2026

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

Скрипт проверяет hashes исходных bytes и index.stats.totalConcerts, сохраняет `live-measurement.json`. Этот режим offline. Live GET был отдельным read-only capture; повторение анализа не получает меняющийся live повторно.

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
      "capturedAt": "actual-capture-time",
      "headers": {"content-type": "text/html"}
    }],
    "savedRaw": "optional-observed-raw.json"
  }]
}
```

Здесь только описание структуры, не новые события. Config берётся из каждого worktree; новая отсутствующая в base конфигурация явно `configAbsent`. Никаких invented raw rows или копирования public records в raw. Каждый HTTP URL custom parser должен иметь сохранённый ответ. Wire gzip поддержан по magic bytes, hash всегда по сохранённым bytes. Один response на URL в source; неоднозначные разные ответы одного URL требуют отдельного capture contract. `savedRaw` сравнивается без scrapedAt лишь как аудиторское доказательство; в publish идут только повторно извлечённые реальные строки.

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

Harness smoke: сохранённый repository native excerpt Admiral Fallow (5 raw -> 5 public) на обеих сторонах; **0 added / 0 removed / 0 changed**, 0 network attempts, 0 missing captures. `/Users/alex/agent-hub/concerts-ru-data/evidence/measurement/harness-smoke/inputs.json`, `original-proof.json` и `replay/comparison.json`. Это старый fixture exercise, не свежий RU/regional прирост. Фокусные metric tests 3/3 PASS, tsc и focused eslint PASS. Анталья/Аланья и Бангкок/Пхукет не смешиваются; проверены inclusive boundaries и lastRun freshness.

Presence-only local environment: `TICKETMASTER_API_KEY`, `TM_API_KEY`, `BANDSINTOWN_APP_ID` отсутствуют. TM/ BIT live rerun здесь не выполнен. Fallback BIT app id в проекте не означает разрешение broad reuse и не использован. Budgets/cadence не менялись.

## Остаётся root / следующему запуску

Native captures regional-sources и итоговый candidate code/DB ещё не интегрированы в этот smoke. Root может передать конечный manifest и candidate path для повторного запуска либо выполнить команду сам. Финальный combined raw-to-public replay и проверка новых корректных событий пока **PENDING**, production gain не заявляется.

Реестр решений: `/Users/alex/agent-hub/concerts-ru-data/questions.md`. Нет push/PR/main merge/deploy, регистрации ключей, outbound сообщений или правок sibling app/DB/config/shared modules.
