# Tomsarkgh AM: ограниченный пилот — 16.10.2026

По follow-on brief хаба после отдельной поставки прав `e8cff80d7cab03b78397a7f0d0ae6c8bb541bf01`. Владелец `source-access`, worktree `agent/concerts-source-access-20261016`; [brief](/Users/alex/agent-hub/concerts-ru-data/brief-tomsarkgh-pilot.md), [реестр решений](/Users/alex/agent-hub/concerts-ru-data/questions.md). Изменены только новый source-specific config/module/tests/fixtures и этот документ. Общий engine/pipeline/schema, artistDB/targets, бюджеты, BACKLOG, другие конфиги и production не менялись. Дочерних агентов нет.

**Результат на сохранённых входах:** 3 native raw → 1 нормализованная строка → 1 строка локального public JSON с текущей approved DB. Это изолированный новый источник; прирост после общей дедупликации с остальными источниками считает measurement lane. Никакой публикации в production не было.

| Исполнитель из карточки | Полная native дата и время | Native venue / address | Real pipeline |
|---|---|---|---|
| Andru Donalds | 2026-11-21 19:00 | Aram Khachaturyan Concert Hall; 46 Mashtots street, Yerevan, Armenia | 1 valid / local public |
| Lyubov Uspenskaya | 2027-01-30 19:00 | Karen Demirchyan Sports and Concerts Complex; Tsitsernakaberd hill, Yerevan, Armenia | not-approved |
| Akmal | 2027-02-19 19:00 | Karen Demirchyan Sports and Concerts Complex; Tsitsernakaberd hill, Yerevan, Armenia | not-approved |

Первичные карточки: [Andru](https://www.tomsarkgh.am/en/event/51067/Andru-Donalds.html), [Успенская](https://www.tomsarkgh.am/en/event/46842/Lyubov-Uspenskaya-in-Yerevan.html), [Akmal](https://www.tomsarkgh.am/en/event/51626/Akmal.html). GET 200 16.10.2026; полные времена/хэши в manifest/metadata. Артисты не добавлялись в whitelist ради результата. В окне 14–90 дней от 16.10 находится только Andru; две остальные даты вне окна. Это не оценка полноты афиши Армении.

## Права и доступ

Повторно использованы сохранённые [User agreement](https://www.tomsarkgh.am/en/page/user-agreement) и [robots](https://www.tomsarkgh.am/robots.txt) из [проверки прав](ru-source-terms-20261016.md). В прочитанном соглашении запрет автоматического сбора не найден; это исходный принятый критерий, не выдуманное письменное разрешение. Downstream JSON/Instagram-права отдельно unknown, письмо не отправлено. Для общего робота закрыт feedback.php, delay 1; BLEXBot закрыт целиком. Пилот не использует feedback, checkout, авторизацию, внутренние API, captcha/WAF или обход ограничений. Между detail GET есть минимум 1000 ms, включая паузу после listing. Конфиг maxRetries 0. Дополнительный fresh GET terms/robots не дублировался.

## Почему source-specific custom_js

Проверена существующая основа `src/engine/runner.ts`, `structured.ts`, config schema и source-specific модули; новые зависимости/общий движок не нужны.

- `static_selectors`: сохранённый `/en/category/Concert` содержит `.event-box-item`, но заголовки сокращены; у многих карточек даты пусты, нет полного года и адреса. Полные даты и адреса находятся в других detail-страницах. Существующие селекторы работают внутри одной карточки/одного ответа, не делают listing→detail join, не разбирают адрес на город/страну и не устанавливают performer versus work title.
- `jsonld`: эти сохранённые страницы не содержат Event JSON-LD. Есть HTML microdata `meta[itemprop=startDate]`, `Place` и `meta[itemprop=address]`; текущий `extractJsonLd` читает именно JSON-LD scripts, не microdata/itemref.
- `next_data`: Next.js hydration payload на выбранных страницах не найден.
- `json_api`: разрешённый документированный публичный feed/API с полным набором полей не установлен; внутренние endpoints не исследовались как обход HTML.
- `playwright_render`: публичный HTML уже содержит нужные microdata в detail. Рендер не добавляет текущему selector-parser возможность связать ответы, отличить performer и разобрать geography; custom renderer всё равно потребовал бы тот же код и лишний браузер.

Поэтому один `scrapers/tomsarkgh-concerts.json` вызывает `src/engine/custom/tomsarkgh-concerts.ts`. Source-specific allowlist охватывает **только три осмотренных исполнительских заголовка**; это ограничение точности/объёма пилота, не новая общая fuzzy-модель и не готовый национальный каталог. Все даты/время/площадки/адреса читаются из live HTML; в production-коде нет ручного списка событий, дат, площадок или городов. Полное имя подтверждается detail, не обрезанным текстом листинга; ENIGMA не превращается в отдельного выступающего артиста.

## Защиты и пределы

- Только canonical listing на `www.tomsarkgh.am`, только HTTPS same-origin `/en/event/{id}/{slug}.html`, без userinfo/query/hash. Redirects detail не следуются. Не более шести уникальных detail URL; превышение — явная source failure, не молчаливое урезание.
- Detail должен иметь ровно один canonical URL, один заголовок/Concert category, один Event microdata-блок, полную валидную дату с годом и временем, одну площадку и адрес. Нет данных/множество конфликтующих полей — строка удерживается.
- Cancellation/postponement в заголовке/описании отбрасываются. Неизвестные заголовки, work/composer/tribute и не Concert не принимаются. Это не автоматический анализ всей сцены, поэтому остальные названия намеренно не интерпретируются.
- Город берётся из предпоследней части native адреса при явном последнем `Armenia`; требуется также непустая часть улицы. Нет глобального Yerevan fallback, координаты не выдумываются. Дата сверяется с календарём и текущим днём Asia/Yerevan, без recycling пропущенного года.
- Сбой любого detail GET делает весь source run неуспешным; успешная частичная выдача не маскирует недоступные карточки. Conditional listing reuse отключён: неизменный HTML-листинг не доказывает неизменность detail-даты/отмены.
- Пилот ограничен текущей первой публичной страницей и тремя осмотренными именами; пагинация/полный каталог/другие языки/неизвестные артисты не заявлены. Когда эти имена перестанут появляться, пустой результат не объявляется доказанной empty schedule; требуется переоценка scope. Ни allowEmpty, ни общий matcher не ослаблялись.

**Existing pipeline limitation:** `process.ts:1251` выбирает `matched.website` перед raw ticket URL. Поэтому Andru в полученном public JSON ведёт на `https://www.andrudonalds.org`; raw сохраняет точную карточку Tomsarkgh. Это существующее правило, общий pipeline этим пилотом не изменён. Поле `originalSource` остаётся `www.tomsarkgh.am`; точная карточка и captures доступны в evidence. Не выдавать public ticketUrl за ссылку на карточку оператора.

## Воспроизведение и проверки

[Manifest](/Users/alex/agent-hub/concerts-ru-data/evidence/sources/tomsarkgh/manifest.json): `clock`, `sourceId`, `sourceAbsentOnBase`, `baseRevision`, `configPath`, `responses[] {url,capturedAt,status,sha256,bodyPath}`, `rawPath`, `publicPath`, `loadedWhitelistSha256`, config/module/public hashes. Полный входной набор `listing.html`, `andru.html`, `uspenskaya.html`, `akmal.html` + соответствующие `.meta.json`; оригинальные bytes без перезаписи. Формат `listing.meta.json` сохраняет из research `checkedAt`, manifest приводит его к `capturedAt`. Representative native captures также в `tests/fixtures/tomsarkgh/`: только LF/концевые пробелы нормализованы для git whitespace-check; исходные неизменённые bytes и их SHA остаются во внешнем capture-directory.

Офлайн [replay.cjs](/Users/alex/agent-hub/concerts-ru-data/evidence/sources/tomsarkgh/replay.cjs) подставляет только сохранённые ответы в axios, запрещает незахваченные URL, фиксирует clock `2026-10-16T19:00:00.000Z`, выполняет настоящий runner, `processConcerts` с `data/artists` через artistDb и `publishConcerts` во внешний evidence-directory. Данные DB не записываются. Root/measurement уведомлены через journal о пути и схеме; source отсутствует на exact base `6af49b13628cd0eeb728f16d62bdaaa17a94e069`.

Проверено:

- `node --import tsx --test tests/tomsarkgh_concerts.test.ts` — 8/8 PASS: точные native поля, actual runner dispatch полного response set, negative title/category/status/date/geography/canonical/overflow и partial failure.
- `tsc --noEmit` — PASS.
- ESLint только нового модуля/теста — PASS; существующее MODULE_TYPELESS_PACKAGE_JSON warning, config не менялся.
- Selector ratchet — 125 offenders при baseline 131, новый source не offender; это не заявление, что пилот исправил 6 старых конфигов.
- Реальный локальный pipeline/publisher replay — 3 raw → 1 public, 2 not-approved, 0 invalid/past/incomplete/Zod failures. Полный integrated suite/global same-input delta остаются root-owned.

Исходные red-проверки: до модуля тест падал на missing module; первая версия двух negative-мутаций не меняла исходный HTML из-за порядка атрибутов/пробела. Исправлены сами мутации, добавлен контроль изменения native input; production-парсер ради тестов не ослаблялся. Итоговые результаты в [tests.tap](/Users/alex/agent-hub/concerts-ru-data/evidence/sources/tomsarkgh/tests.tap).

Push, PR, merge main, production, access-письма не выполнялись. Следующий шаг root: отдельная интеграция пилота, общий replay/dedup с теми же bytes и финальные branch gates. Этот пилот не заменяет редакционную проверку и не обновляет current foreign-agent statuses.
