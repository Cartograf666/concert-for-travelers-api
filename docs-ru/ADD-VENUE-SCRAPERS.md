# Задача для агента: добавление скраперов площадок (большой объём, низкая сложность)

Твоя задача: **добавить конфигурации новых скраперов площадок** в `scrapers/*.json`. Движок уже
берёт на себя всю сложную часть (запросы с повторными попытками, троттлинг по доменам, JSON-LD
fallback, самовосстановление, обнаружение изменений, дедупликацию, публикацию). Каждая добавляемая
тобой площадка — это **один JSON-файл**, построенный по шаблону и проверенный одной командой. Это
работа на объём: повторяй рецепт для каждой площадки, сдавай каждую.

Сервис собирает расписания концертов с музыкальных площадок, фильтрует события по
курируемому списку артистов и публикует статический JSON API. Больше площадок = больше охват =
больше пользы. Объём здесь практически неограничен (каждая площадка в каждом городе).

---

## 0. Единоразовая настройка: сборка тестового хелпера

Если `src/scripts/test_config.ts` не существует, создай его (именно он делает
рутину быстрой — запускает один конфиг и печатает, что он извлекает):

```ts
// src/scripts/test_config.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { ScraperConfigSchema } from '../schemas/config.js';
import { runScraper } from '../engine/runner.js';

(async () => {
  const id = process.argv[2];
  if (!id) { console.error('usage: test-config <venue-id>'); process.exit(1); }
  const file = path.join(process.cwd(), 'scrapers', `${id}.json`);
  const config = ScraperConfigSchema.parse(JSON.parse(await fs.readFile(file, 'utf-8')));
  const res = await runScraper(config);
  console.log(res.success ? `OK — ${res.concerts.length} events extracted` : `FAIL (${res.reason}): ${res.error}`);
  console.log(JSON.stringify(res.concerts.slice(0, 6), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
```

Добавь в `package.json` scripts: `"test-config": "tsx src/scripts/test_config.ts"`.

Запускай его так: `npm run test-config -- <venue-id>`

---

## 1. Рецепт для одной площадки (~5 мин на каждую)

1. **Найди URL расписания** — страницу площадки agenda / events / «what's on», на которой
   перечислены предстоящие шоу (не главную страницу).
2. **Загрузи и изучи** (`curl -sL -A "Mozilla/5.0 ..." <url> | less`, либо через
   devtools браузера). Определи тип извлечения в следующем порядке предпочтения:
   - **JSON-LD** (лучший вариант): ищи в HTML `application/ld+json`, содержащий
     `"@type":"MusicEvent"` / `"Event"`. Если найден → `type: "jsonld"`, CSS-селекторы
     не нужны. Самый долговечный вариант (переживает редизайны).
   - **Hydration JSON**: ищи `id="__NEXT_DATA__"` (Next.js) или `__NUXT_DATA__`.
     Если события находятся в этом блобе → `type: "next_data"` с путями через точку/скобки.
   - **Raw JSON API**: если страница на самом деле является XHR/JSON-эндпоинтом → `type: "json_api"`.
   - **CSS-селекторы** (последний вариант): `type: "static_selectors"`. Выбирай стабильные
     селекторы (семантические теги, `id`, `data-*`, `itemprop`). **Избегай хешированных CSS-in-JS
     классов**, таких как `css-8tb23n` / `sc-1x2y3z` — они меняются при каждом деплое.
3. **Напиши конфиг** (см. §2), сохрани как `scrapers/<venue-id>.json`.
4. **Протестируй**: `npm run test-config -- <venue-id>` → должно быть извлечено ≥1 событие с реальным
   именем артиста и строкой даты.
5. **Закоммить** (см. §5).

Для конфига `static_selectors` движок автоматически пробует JSON-LD, если по
селекторам найдено 0 совпадений — так что комбинация селекторов + JSON-LD безопасна, но лучше
сразу отдавать предпочтение `jsonld`, если он есть на сайте.

---

## 2. Справочник по конфигурации

Схема: `src/schemas/config.ts`. Структура:

```jsonc
{
  "id": "paradiso-amsterdam",          // unique, kebab-case: <venue>-<city>
  "domain": "paradiso.nl",             // bare domain
  "url": "https://www.paradiso.nl/en/agenda",  // http(s) only; NEVER localhost/private IPs
  "type": "static_selectors",          // static_selectors | jsonld | next_data | json_api | custom_js
  "maxRetries": 2,                     // optional (default 2)
  "requestDelayMs": 0,                 // optional; set >0 to be gentle on shared hosts
  "allowEmpty": false,                 // optional; true for seasonal venues that are legitimately empty sometimes
  "selectors": {
    "eventBlock": "li.event-card",     // REQUIRED: selector/path for one event
    "artist": "h3.title",              // artist text (omit for single-artist tour pages)
    "artistNameFallback": "",          // fixed artist name when the whole page is one act's tour
    "date": ".date",                   // REQUIRED: date text
    "datePattern": "",                 // optional hint, unused by parser today
    "ticketUrl": "a.tickets",          // optional: link
    "venue": "", "city": "", "country": "",  // optional per-row (for multi-venue/tour pages)
    "venueNameFallback": "Paradiso",   // REQUIRED
    "cityNameFallback": "Amsterdam",   // REQUIRED
    "countryNameFallback": "NL"        // REQUIRED: ISO 3166-1 alpha-2 (exactly 2 chars)
  }
}
```

**Особенности по типам:**
- `jsonld`: селекторы используются только для значений `*Fallback`; извлечение читает
  события schema.org напрямую. Всё равно нужно указать все три `*NameFallback`.
- `next_data` / `json_api`: `eventBlock` — это путь внутри JSON (`props.pageProps.events`
  или `data.pages[0].events` — поддерживаются индексы в квадратных скобках). `artist`/`date`/`ticketUrl` —
  это пути к полям внутри каждого объекта события.
- `custom_js`: только когда ничего другого не работает — напиши `src/engine/custom/<id>.ts`,
  экспортирующий `async function scrape(config, html, scrapedAt)`. Требует больших усилий; избегай.

---

## 3. Тестирование и критерии приёмки

- **Успех:** `npm run test-config -- <id>` печатает `OK — N events`, где N ≥ 1, и в
  примерах строк видно правдоподобное имя артиста + строку даты.
- Напечатанная `date` может быть сырым текстом (например, `"12 Okt 2026"`, `"2026-10-15"`,
  `"woensdag 08 juli 2026"`) — пайплайн нормализует её. Поддерживаются: ISO, `DD.MM[.YYYY]`,
  `D Month [YYYY]`, `Month D [YYYY]`, диапазоны и названия месяцев на EN/DE/NL/сербской латинице,
  плюс запасной вариант через chrono-node. Если даты получаются нечитаемым мусором, поправь
  селектор `date` (ты цепляешь не тот узел).
- **Важно — не суди по опубликованному результату.** Пайплайн оставляет только события,
  чей артист есть в базе допустимых артистов (`data/artists/shard-0.json`..`shard-7.json`).
  Корректный конфиг может извлечь 50
  событий, но опубликовать 0, потому что ни одно из них не одобрено. Суди о конфиге по **сырому
  количеству извлечённых событий** из `test-config`, а не по `dist/`.
- Не запускай `npm run scrape` для тестирования одной площадки (он запускает все сразу).

---

## 4. Подводные камни (проверено — сэкономь себе время)

- **Хешированные классы — это ловушка.** `li.css-8tb23n` работает сегодня, ломается при
  следующем деплое площадки. Предпочитай JSON-LD/next_data или стабильные селекторы
  (`article[id^=...]`, `[itemprop=...]`, семантические теги). Самовосстановление залатает
  поломки, но не полагайся на него.
- **Кастомные элементы — это реальность.** Некоторые сайты используют нестандартные теги
  (`<datetime>`, `<label>`); селекторы вроде `a datetime` / `a label` валидны и работают в cheerio.
- **Никогда не указывай в `url` localhost, приватные IP или тестовую/mock-страницу.** Схема
  отклоняет приватные/link-local/metadata хосты (защита от SSRF), а фикстуры засоряют
  боевой прогон. Только реальные публичные URL площадок.
- **`allowEmpty`** — устанавливай в `true` только когда у площадки действительно бывают
  перерывы (сезонный клуб); иначе 0 событий считается сломанным скрапером и ставится в
  очередь на самовосстановление.
- **Устаревшие страницы.** Некоторые площадки показывают прошлые/прошлосезонные события.
  Это данные сайта, а не баг — конфиг всё равно корректен, если он их извлекает.

---

## 5. Соглашения по коммитам / PR

- Одна площадка на коммит (или небольшая пачка по городу), сообщение: `feat(scrapers): add <venue> (<city>)`.
- Заканчивай сообщения коммитов строкой:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Открытие PR, затрагивающего `scrapers/**`, запускает `pr-test.yml` (сборка + тесты) — следи, чтобы он оставался зелёным.
- **Не** коммить `data/artists/shard-*.json` в рамках этой задачи (это принадлежит
  workflow'ам обогащения, шлюз — `src/pipeline/artistDb.ts`). Трогай только
  `scrapers/` (и, один раз, тестовый хелпер + package.json).

---

## 6. Поиск площадок (источник объёма)

Целевые города, которые уже охвачены — расширяйся внутри них и за их пределами: **Амстердам, Берлин,
Белград, Тбилиси, Лондон**. Для каждого города добывай страницы расписаний площадок из:
- **Resident Advisor** (`ra.co`) — клубы/электронная музыка.
- **Songkick / Bandsintown** — страницы площадок перечисляют предстоящие шоу и ссылаются на официальные сайты.
- Городские сайты **"what's on" / listings** и туристические офисы.
- **Ticketing**-агрегаторы (локальные Ticketmaster/See Tickets и т.п.) — но предпочитай
  собственный сайт площадки (он стабильнее, с более богатым JSON-LD).

Выбирай площадки с официальной страницей расписания. Стремись к стабильному потоку: 10–20 площадок на
город, прежде чем переходить дальше.

---

## 7. Масштабирование рутины

Это чисто параллелизуется: одна единица работы = один URL площадки → один протестированный конфиг.
Пачка из 20–50 площадок может обрабатываться параллельно (один суб-агент на площадку,
каждому дан URL, в ответ — протестированный `scrapers/<id>.json`). Держи область ответственности
каждого суб-агента в рамках одной площадки и критерия приёмки из §3.

---

## Критерий готовности (на площадку)

- `scrapers/<id>.json` существует и проходит валидацию по схеме.
- `npm run test-config -- <id>` → `OK — N events` (N ≥ 1) с адекватными примерами артиста/даты.
- Закоммичено; PR (если используется) зелёный.
