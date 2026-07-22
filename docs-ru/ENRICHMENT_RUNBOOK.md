# Обогащение сайтов артистов — руководство для агента

Передайте этот файл любому кодирующему агенту (Claude Code / Agent SDK), чтобы продолжить
обогащение шардированной базы данных одобренных артистов в `data/artists/` официальным
**website**, **tourUrl** (страницей со списком актуальных дат + городов), **socials**
каждого артиста, а также для генерации конфигураций скрапера для каждого артиста
в `scrapers/artist-<slug>.json`.

Основную работу выполняет **рой исследовательских агентов**, запускаемых через
инструмент `Workflow`. Детерминированный Node-харнесс (`src/scripts/enrich_sites.ts`)
выбирает работу и объединяет результаты. **Агенты никогда не пишут в БД** — это
делает только харнесс (единственный writer, без гонок).

---

## 0. Предварительные условия

- Node v20+, весь запуск выполняется из корневой директории проекта: `/Users/alex/code/сoncert-for-travelers-api`
- `npm install` уже выполнен.
- Инструмент `Workflow` должен быть доступен (оркестрация нескольких агентов). Если его
  нет, вы не сможете запустить рой — остановитесь и сообщите об этом пользователю.

Проверить прогресс можно в любой момент:

```bash
npm run enrich-sites stats
```

Вывод показывает `total`, `enriched`, `with website`, `with tourUrl`, `remaining`.
Обогащение можно **возобновлять**: артист считается «выполненным», как только у него
появляется поле `enrichedAt`, поэтому `select` всегда выдаёт следующие необработанные
имена. Можно безопасно останавливать/перезапускать процесс в любой момент.

---

## 1. Цикл (повторять, пока `remaining` не станет == 0)

### Шаг 1 — выбрать следующий чанк

```bash
npm run enrich-sites select 100 /tmp/chunk.json
```

Записывает следующие 100 не обогащённых имён артистов в `/tmp/chunk.json` (JSON-массив
строк). Выбирайте от 60 до 150 на чанк. Чем больше чанк, тем меньше запусков, но тем
дольше он выполняется по времени (см. §4).

### Шаг 2 — собрать скрипт роя со встроенными в него именами

⚠️ **Известная особенность:** в данном рантайме параметр `args` инструмента `Workflow`
приходит пустым. Поэтому необходимо **встроить имена прямо в скрипт** в виде
`const NAMES = [...]`. Прочитайте `/tmp/chunk.json` и вставьте его массив в шаблон ниже.

Запишите это в файл, например `/tmp/enrich-chunk.js`:

```javascript
export const meta = {
  name: 'artist-site-enrichment',
  description: 'Swarm: find official website, tour/dates page, socials + scraper config per artist',
  phases: [
    { title: 'Research', detail: 'web-research each artist batch for site/tour/socials' },
    { title: 'Verify', detail: 'adversarially confirm domains truly belong to the artist' }
  ]
}

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: { results: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['name', 'website', 'tourUrl', 'socials', 'scraper', 'confidence'],
    properties: {
      name: { type: 'string' },
      website: { type: ['string', 'null'] },
      tourUrl: { type: ['string', 'null'] },
      socials: { type: 'object', additionalProperties: false,
        required: ['spotify','instagram','facebook','youtube','telegram','vk'],
        properties: {
          spotify: { type: ['string','null'] }, instagram: { type: ['string','null'] },
          facebook: { type: ['string','null'] }, youtube: { type: ['string','null'] },
          telegram: { type: ['string','null'] }, vk: { type: ['string','null'] } } },
      scraper: { type: ['object','null'], additionalProperties: false,
        required: ['domain','url','type','selectors'],
        properties: {
          domain: { type: 'string' }, url: { type: 'string' },
          type: { type: 'string', enum: ['static_selectors','json_api'] },
          selectors: { type: 'object', additionalProperties: false,
            required: ['eventBlock','artistNameFallback','date','venueNameFallback','cityNameFallback','countryNameFallback'],
            properties: {
              eventBlock: { type: 'string' }, artistNameFallback: { type: 'string' },
              date: { type: 'string' }, city: { type: ['string','null'] },
              venue: { type: ['string','null'] }, country: { type: ['string','null'] },
              ticketUrl: { type: ['string','null'] }, venueNameFallback: { type: 'string' },
              cityNameFallback: { type: 'string' }, countryNameFallback: { type: 'string' } } } } },
      confidence: { type: 'string', enum: ['high','medium','low'] }
    }
  } } }
}

// >>> PASTE the array from /tmp/chunk.json here <<<
const NAMES = ["Example Artist A", "Example Artist B"]

const BATCH = 6
const batches = []
for (let i = 0; i < NAMES.length; i += BATCH) batches.push(NAMES.slice(i, i + BATCH))
log(`Enriching ${NAMES.length} artists in ${batches.length} batches of up to ${BATCH}`)

const researchPrompt = (batch) => `You are a meticulous music-industry data researcher. For EACH artist/band below, find their real, current concert information sources. Use WebSearch and WebFetch (if not directly available, load them first via ToolSearch with query "select:WebSearch,WebFetch").

Artists:
${JSON.stringify(batch, null, 2)}

For each artist return:
- website: the artist's OWN official website (a domain they control, or official label/management site). NOT ticketmaster, songkick, bandsintown, setlist.fm, wikipedia, spotify, youtube, a fan site, or a store. null if none.
- tourUrl: the exact page listing UPCOMING concert dates with cities (commonly /tour, /shows, /live, /concerts, /dates, /events). Open it, confirm it currently shows dated shows with city names. Prefer a page on the official site; if dates are only in an embedded Bandsintown/Songkick widget, still return the tour page URL but set scraper=null. null if none.
- socials: official profile URLs for spotify, instagram, facebook, youtube, telegram, vk. null for any you can't confirm official.
- scraper: ONLY set (non-null) if you actually FETCHED the tourUrl and it is static, server-rendered HTML with repeating event rows you can target with CSS selectors. Then provide: domain (host of tourUrl), url (=tourUrl), type ("static_selectors"), selectors.eventBlock (one repeating show row), selectors.artistNameFallback (the artist's exact name), selectors.date, selectors.city/venue/country (per-row selectors or null), selectors.ticketUrl (or null), selectors.venueNameFallback/cityNameFallback ("" when per-row selector exists), countryNameFallback (2-letter ISO best guess). If JS-rendered, a widget, or unsure of selectors, set scraper=null. A null scraper beats guessed selectors.
- confidence: "high" only if you opened the site and tour page and are certain; else "medium"/"low".

Be truthful. Never invent a URL. Return null rather than guess. Output every artist exactly once, using the exact input name.`

const verifyPrompt = (found) => `You are an adversarial fact-checker for a music concert database. REFUTE anything wrong.

Records:
${JSON.stringify(found, null, 2)}

For each, use WebSearch/WebFetch (load via ToolSearch "select:WebSearch,WebFetch" if needed):
- Does the website resolve and belong to THIS artist (not a namesake/fan page/reseller/parked domain)? If not clearly official, set null.
- Does the tourUrl show this artist's upcoming dates with cities right now? If it 404s, is unrelated, or has no dates, set null (and scraper null).
- Are socials the official accounts for THIS artist? Null any wrong/unverifiable.
- Is scraper safe? If you can't confirm the tour page is static HTML with the claimed rows, set scraper null.
Keep every artist, exact same name. Return corrected records.`

const out = await pipeline(
  batches,
  (batch, _o, i) => agent(researchPrompt(batch), { label: `research:b${i+1}`, phase: 'Research', agentType: 'general-purpose', schema: RESULT_SCHEMA }),
  (research, _b, i) => (research && research.results)
    ? agent(verifyPrompt(research.results), { label: `verify:b${i+1}`, phase: 'Verify', agentType: 'general-purpose', schema: RESULT_SCHEMA })
    : { results: [] }
)

const merged = out.filter(Boolean).flatMap(r => (r && r.results) ? r.results : [])
log(`Done: ${merged.length} records | website:${merged.filter(r=>r.website).length} tourUrl:${merged.filter(r=>r.tourUrl).length} scraper:${merged.filter(r=>r.scraper).length}`)
return { count: merged.length, results: merged }
```

### Шаг 3 — запустить рой

Вызовите инструмент `Workflow` с `{ scriptPath: "/tmp/enrich-chunk.js" }`.
Он выполняется в фоне; вы получите уведомление о завершении задачи с `Task ID`
и путём к `output-file`. **Не делайте busy-poll** — дождитесь уведомления.

Примерное время: ~6 мин на батч из 6 (research + verify). 100 артистов ≈ 17 батчей;
конкурентность ограничена ~16 агентами, так что стоит ожидать долгий запуск. См. §4.

### Шаг 4 — применить результаты к БД

Файл вывода задачи сам по себе НЕ является валидным `.json` — это обёртка. Извлеките
`.result.results` и передайте этот массив в `apply`:

```bash
OUT="<output-file path from the notification>"
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.env.OUT,'utf8'));fs.writeFileSync('/tmp/results.json',JSON.stringify(d.result.results,null,2));console.log('extracted',d.result.results.length)"
npm run enrich-sites apply /tmp/results.json
```

`apply` объединяет `website`/`tourUrl`/`socials` в БД, устанавливает `enrichedAt` и
записывает `scrapers/artist-<slug>.json` для каждой записи, чей блок `scraper` проходит
валидацию Zod (невалидные/угаданные конфигурации пропускаются с логированием причины —
обогащение БД при этом всё равно применяется).

### Шаг 5 — проверить и повторить

```bash
npm run enrich-sites stats      # remaining should have dropped by the chunk size
npm test                        # runner tests still green
```

Вернитесь к Шагу 1 для следующего чанка.

---

## 2. Опционально: делать бэкап перед каждым apply

```bash
cp -r data/artists/ /tmp/db.backup.$(date +%s)/
```

`apply` изменяет только записи, указанные в файле результатов, и идемпотентен для
каждого имени, но бэкап — это дешёвая страховка.

---

## 3. Как выглядят «хорошие данные»

- `website` = домен, контролируемый артистом (например, `https://www.thecure.com/`).
  Отклоняет ресейлеров/агрегаторов/wikipedia.
- `tourUrl` = страница, на которой *в настоящий момент* перечислены концерты с датами
  и городами.
- `scraper` присутствует только для страниц туров со **статическим HTML** (многие
  крупные артисты используют JS-виджеты → `scraper: null`, но `tourUrl` при этом
  всё равно записывается). Пример, для которого была сгенерирована конфигурация:
  The Cure, Sabaton. Корректность селекторов во время выполнения впоследствии
  проверяется через `npm run scrape`; сломанные селекторы автоматически исправляются
  существующим механизмом самовосстановления (`npm run heal`).

---

## 4. Пропускная способность и тюнинг

- `total` = 62,778. Запуск 1 обработал 23 за ~26 мин с 8 агентами (~600k токенов).
- Рычаги в скрипте: `BATCH` (число артистов на одного агента — увеличьте до 10–15 для
  меньшего числа более медленных агентов), либо отказ от этапа verify (≈в 2 раза
  быстрее, но больше галлюцинированных доменов проскакивает).
- Ограничения `Workflow`: ~16 одновременных агентов, 1000 агентов на один запуск. Таким
  образом, один запуск может покрыть максимум ~`1000 * BATCH / 2` артистов (÷2 из-за
  этапа verify). Держите размер чанков значительно ниже этого предела.
- Реалистично это займёт много часов агентского времени в течение множества сессий.
  Рассмотрите использование скилла `/loop` для автоматического запуска чанков без
  присмотра.

---

## 5. Задействованные файлы

- `src/scripts/enrich_sites.ts` — харнесс (`npm run enrich-sites <select|apply|stats>`).
- `src/pipeline/artistDb.ts` — управляет загрузкой, сохранением базы данных одобренных
  артистов и прозрачной схемой шардирования.
- `src/schemas/config.ts`, `src/engine/runner.ts` — движок, расширенный для страниц туров
  артистов (опциональные `artist`, `artistNameFallback`, поэлементные `venue`/`city`/`country`;
  значение per-row имеет приоритет, иначе используется фиксированный fallback). Обратно
  совместим с конфигурациями venue.
- `data/artists/` — шардированная база данных одобренных артистов (shard-0..7.json).
- `scrapers/artist-*.json` — сгенерированные конфигурации скрапера для каждого артиста.
- `tests/runner.test.ts` — включает тест artist-tour-page.

---

## 6. Ротация секретов

Этот runbook описывает список секретов, используемых в данном репозитории, и процедуру
их ротации в случае компрометации или истечения срока действия.

### Список настроенных секретов
1. **API-ключи Gemini**:
   - `GEMINI_API_KEY`: основной API-ключ, используемый в `self-heal.yml`, `enrich-database.yml`, `data-hygiene.yml` и `daily-scrape.yml`.
   - `GEMINI_API_KEY_2` .. `GEMINI_API_KEY_5`: резервные ключи, используемые `enrich-database.yml` и `data-hygiene.yml`.
   - `GEMINI_API_KEY_RESERV1`, `GEMINI_API_KEY_RESERV2`: резервные ключи, используемые `self-heal.yml`, `enrich-database.yml`, `data-hygiene.yml` и `daily-scrape.yml`.
   - `GEMINI_API_KEY_RESERV3`: резервный ключ, используемый `enrich-database.yml` и `data-hygiene.yml`.
   - `GEMINI_API_KEYS`: список запасных API-ключей Gemini, разделённых пробелами/запятыми, считываемый `enrich-database.yml` и `data-hygiene.yml`.
2. **API-ключ Last.fm**:
   - `LASTFM_API_KEY`: считывается `rank-scraper-candidates.yml`, `discover-artists.yml`, `enrich-similar.yml` и `enrich-metadata.yml`.
3. **API-ключ Ticketmaster**:
   - `TICKETMASTER_API_KEY`: считывается `daily-scrape.yml`.
4. **Учётные данные Spotify API (устарели, но остаются в конфигурациях)**:
   - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: упоминаются в `discover-artists.yml`.
5. **App ID Bandsintown**:
   - `BANDSINTOWN_APP_ID`: упоминается в `artist-scrape.yml`.

### Процедура ротации
Когда срок действия секрета истекает или он скомпрометирован:
1. Перегенерируйте ключ/учётные данные в консоли соответствующего провайдера (Google AI Studio, Last.fm, Ticketmaster и т. д.).
2. Установите новое значение в GitHub Secrets с помощью GitHub CLI:
   ```bash
   gh secret set SECRET_NAME --body "new-secret-value"
   ```
   *(Либо перейдите в настройки репозитория GitHub -> Secrets and variables -> Actions -> Update)*.
3. Убедитесь, что новый секрет работает, вручную запустив `workflow_dispatch` для воркфлоу, который его использует.
4. После подтверждения работоспособности нового ключа отзовите/деактивируйте старый ключ в консоли провайдера.

*Примечание: эта процедура ротации предназначена для целей безопасности/истечения срока действия. Она отделена от автоматизированной логики failover-ротации в `src/engine/gemini_keys.ts`, которая перебирает несколько ключей, чтобы обходить лимиты частоты запросов free-tier.*
