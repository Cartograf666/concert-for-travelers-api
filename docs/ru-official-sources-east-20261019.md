# Официальные источники east — 19.10.2026

Результат: **новые runtime-конфиги не допущены**. Все четыре случая исследованы;
это не четыре успешно подключённых источника. Общий код, БД, лимиты и расписание
не менялись. Для Кино/Lumen не подставлена страна по названию города; для Доры не
обойдены недоступность сайта и ограничения связанного сервиса.

| Артист | Наблюдение native GET | Итог |
|---|---|---|
| Кино | `https://kino.band/`, 200, 23 будущих строки, явные полные даты, город и площадка; страны в строках нет | Неполные записи; связанный Zakazbiletov требует согласия на использование информации. Конфига нет |
| Монеточка | `https://monetochka.world/`, 200, календарь с 58 датами и явными заголовками годов | На сохранённой странице на 19.10.2026 нет анонсированных будущих дат; последняя — **05.09.2026**, Белград/New Tekstil. Пустого конфига нет |
| Дора | `https://realdora.com/` и robots: transport timeout, не HTTP 404 и не пустая афиша | Найден официальный альтернативный путь Telegram → BandLink; там 20 будущих строк, но §2.10 запрещает внешний reuse материалов/БД. Конфига нет |
| Lumen | `https://lumen.ws/`, 200, пять ближайших концертов; полный календарь и контакты заканчиваются timeout | Будущие концерты есть; полнота календаря и страна по собственным данным не подтверждены. Конфига нет |

## Основа и границы реализации

Прочитаны `common-brief.md`, stage/home hub rules, предыдущий source terms report,
`bi2-tour.json`/`bi2-tour.ts`, `runner.ts`, `structured.ts`, `process.ts`,
`artistDb.ts`, `official_artist_sources.ts`, `ru_data_expansion_replay.ts`.
Использованы существующие `runScraper`, JSON-LD extraction, `processConcerts`,
approved identity reader и настоящий publisher replay. Внешняя библиотека/новый
движок не решает отсутствие допустимых country/venue/terms; отдельный поиск
экосистемного решения и bridge не запускались по этой конкретной причине.

Custom-код не написан: он не может восполнить эти факты без запрещённых догадок
или источника с ограничениями. Negative identity/type/date controls проверены для
повторно используемого пути; source-specific custom controls — **N/A**, такого
кода нет. Нет запроса на расширение whitelist или изменение общего matcher.

## Идентичность и события

**Кино.** Главная прямо описывает нынешний концертный состав с оцифрованным
голосом Виктора Цоя и музыкантами Титовым, Тихомировым, Каспаряном. Это источник
российского «Кино», не британского `Kino`. Native identity read сохраняет MBID
`064db6e8-fdfb-4acb-a327-fc2de75b37de` отдельно от
`39568c43-87a3-4711-92dd-7a33bd4e92ef`.

Основная афиша: 25/27.10.2026 Алматы/Астана; далее Москва, Минеральные Воды,
Торонто, Нью-Йорк, Майами, Сан-Франциско, Лос-Анджелес, Сиэтл, Калгари,
Красноярск, Томск, Новосибирск, Омск, Санкт-Петербург, Мурманск; также явные
даты 2027 для Екатеринбурга, Дубая, Краснодара, Ростова-на-Дону, Воронежа.
Полная пособытийная расшифровка **без страны** и точные ticket URLs — в
`observations.json` / `incomplete-observations-pipeline.json` (evidence ниже).
Страна не выведена из города, TLD, языка или страны артиста.

`/kontserty/` возвращает 302 на `/kontserty/2026/`; сохранены оба ответа.
В последнем есть также архив; он не перенесён в будущие события.
Проверенная собственная карточка
`https://kino.band/kontserty/2026/kino-tur_33.html` содержит дату и Queen Elizabeth
Theatre, но не достраивает недостающую страну.

**Монеточка.** Title: Fairy Tale Tour; социальные ссылки совпадают с approved
identity. Старые ноябрьские/декабрьские строки находятся под **2025**, а не под
2026. Календарь включает 2025 и 2026, с повторным явным заголовком 2026;
58 строк разобраны как наблюдение с сохранением этих границ. Вывод об отсутствии
будущих дат ограничен этой страницей на дату захвата, не всеми каналами артиста.
Ссылки магазина/старые фестивали не превращены в новые концерты. MBID
`30fcffbe-1083-4e3e-b85a-9b184b97d09f`.

**Дора.** Верифицированный публичный `https://t.me/s/cutedorik` содержит контакты
на домене realdora.com и прямую ссылку `band.link/dora_2026`. На связанной странице
сохранённые RSC-данные содержат имя `Дора`, `is_artist_verified: true`,
`verified: 1` и обратную ссылку на тот же Telegram. Это авторитетная цепочка,
не совпадение названия продавца. 31 строка, из них 20 будущих на frozen clock:
04.11.2026–15.01.2027. Это **наблюдение ограниченного источника**, не native raw
для publisher. В этих строках также отсутствуют venue и country; `00:00` не
принято за достоверное время начала.

Не путать с `Doro`, `Doro Pesch` или неидентифицированным латинским `Dora`.
Approved Russian MBID `d87c14ef-f570-470d-be76-3e2023fa4f61` остаётся отдельным.
Через официальную tour-ссылку проверена карточка
`https://without-events.ru/dora_perm`: Дора/20 декабря/Свобода/Пермь, но собственного
полного года и страны нет; недостающие поля не заимствованы из закрытого для
reuse BandLink. Билетные виджеты/внутренние API не вызывались.

**Lumen.** Title Lumen и подпись официального сайта группы. Главная с явным
`2026 Октябрь` показывает Челябинск 20.10, Тулу 23.10, Воронеж 24.10,
Краснодар 26.10, Ставрополь 27.10; площадки и адреса в сохранённом HTML.
Страны нет; адреса не превращены в geocoder queries. Полный календарь
`/category/concerts/` дважды не ответил по HTTPS; исходный HTTP из меню также
не ответил. `/contacts/` и `/news/15523/` тоже timeout. Robots запрет не обойдён;
таймауты не названы запретом и не доказывают отсутствие дат.

## Robots и условия

Все ответы/ошибки имеют UTC timestamp; HTTP status, headers и SHA-256 тела
сохранены в отдельных `*.meta.json`, сводка — `capture-index.json`.
Читались доступные footer/nav links; отсутствие terms не объявлено лицензией.

| Домен / документы | Результат |
|---|---|
| `kino.band/robots.txt`, 200 | Закрыты `/magazin/*`, `/kontent/`; афиша/главная не закрыты. Магазин не читался |
| `kino.band/agreement-cookie/`, 200 | Найдена в cookie-конфигурации, описывает персональные данные и cookie. Условий автоматического чтения афиши не найдено в осмотренных home/calendar/detail/cookie. Это bounded no-prohibition-found, downstream rights unknown |
| `monetochka.world/robots.txt`, 200 | Закрыты служебные Tilda маршруты, главная разрешена. В осмотренных home/footer нет отдельных reuse terms; запрет не найден, права downstream unknown |
| `realdora.com/robots.txt` | Timeout: robots/условия не прочитаны, никаких выводов о допустимости или отсутствии концертов |
| `lumen.ws/robots.txt`, 200 | Закрыты `/wp-admin/`, `/wp-includes/`; эти пути не читались. В доступном home/footer нет terms; footer контакты ведут на timeout. Нет установленного запрета, но полнота inspection ограничена |
| `zakazbiletov.kz/robots.txt`, 200 | Event path не закрыт для user/default reading; GPTBot/ClaudeBot и отдельные training agents закрыты полностью. Никаких обходов/agent-policy выводов для training не делалось |
| Zakazbiletov event + `/ru/pages/8-dogovor-oferty`, 200 | Footer: «Любое использование информации возможно только с согласия правообладателя ZAKAZBILETOV.KZ». Текст оферты прочитан; это не разрешение на каталог. Использование данных прекращено, UNSENT draft ниже |
| `t.me/robots.txt`, 404; публичный `/s/cutedorik`, 200 | Использован только как доказательство official link; feed из Telegram не создаётся |
| `band.link/robots.txt`, 200; `/terms`, 200 | Robots закрывает `/confirm-email`, не выбранную страницу. **Terms §2.10** ограничивает личным некоммерческим использованием и запрещает копирование/внешнее использование материалов или БД. Данные не включены в publisher |
| `without-events.ru/robots.txt`, 200; `/rules`, `/privacy`, 200 | Выбранный slug разрешён. Privacy регулирует персональные данные, rules не дают пригодного машиночитаемого разрешения на reuse. В прочитанном запрета на календарь не найдено; это не устраняет отсутствие полного года/страны |

Ни одна форма не отправлена, регистрация/акцепт не выполнялись. Для Platinumlist,
Kassir, Яндекс Афиши и прочих ticket links не заявлено нового разрешения на сбор;
сами ticket links из афиши не являются таким разрешением. BIT 404/0 нигде не
использован как доказательство отсутствия официальных концертов.

## Native проверки и точное воспроизведение

Evidence root: `/Users/alex/agent-hub/concerts-ru-data-2/evidence/official-east`.
Frozen clock: **2026-10-19T07:26:36.597Z**.

- `capture.py`: GET существующим UA runner, Accept-Encoding identity; оригинальные
  response body bytes без нормализации/перекодирования, HTTP transfer framing
  снимается библиотекой. Ошибки сохраняются без фиктивного тела/status. Локальный fixture `.gitattributes`
  сохраняет HTML как binary: исходные смешанные CRLF/LF и пробелы не исправлялись;
  payload сравнивается по SHA-256.
- `capture-index.json`: точные URL → UTC/status/headers/body/SHA-256.
- `observations.json`: вручную/DOM расшифрованные наблюдения, **не scraper raw**.
- `probe-inputs.json`: точные диагностические JSON-LD config → capture mappings.
  Это offline probes, не принятые runtime configs и не обещание пустой афиши.
- `native-audit.mjs`, `native-audit.log`, `native-probes.json`: `runScraper` на
  сохранённых ответах Кино/Монеточки/Lumen, без сети, frozen Date; 3 failure,
  0 raw. Отсутствие JSON-LD не доказывает отсутствие HTML афиши.
- `native-raw.json` → `native-normalized.json`: 0 → 0 через текущий approved
  DB reader (63 409 строк). У Доры нет сохранённого ответа realdora.com:
  native run на нём **невозможен**, ответа не фабриковали.
- `incomplete-observations-pipeline.json`: отдельные 28 точных HTML наблюдений
  Кино/Lumen без страны → 0, все 28 dropped incomplete. Они не называются
  результатом `runScraper` и не идут в publisher.
- `current-approved-identity-read.json`: 8 **синтетических** identity controls
  через текущий approved read path → 8, RU/foreign identities разделены.
  `db-read-integrity.json` подтверждает неизменность всех shard hashes.
- `inputs.json` — четыре ожидаемых config paths и разрешённые captures, без
  искусственных source responses. `publisher-absence-replay/summary.json`:
  настоящий `ru_data_expansion_replay.ts __worker`, 4 `configAbsent`, 0 raw,
  0 public rows, 0 network attempts/missing captures. Статус `replayed` означает
  только воспроизведение **отсутствия конфигов**, не успешный сбор источников.
  Hub может включить этот manifest в интегральный same-input replay; извлечение
  новых событий и положительный publisher gain этим результатом не доказаны.

Команды из этого worktree:

```sh
SCRAPER_ALLOW_LOCAL_HOSTS=1 node --import tsx --test tests/ru_official_sources_east.test.ts
npx eslint tests/ru_official_sources_east.test.ts
npm run build
node --import tsx /Users/alex/agent-hub/concerts-ru-data-2/evidence/official-east/native-audit.mjs
node --import tsx src/scripts/ru_data_expansion_replay.ts __worker "$PWD" /Users/alex/agent-hub/concerts-ru-data-2/evidence/official-east/inputs.json /Users/alex/agent-hub/concerts-ru-data-2/evidence/official-east/publisher-absence-replay
```

Фактически: **8/8 tests**, focused ESLint и TypeScript build PASS; native audit
и publisher absence replay PASS в указанном ограниченном смысле. Полный suite и
combined stage review выполняет hub. Никаких source-success/production-gain/
push/deploy утверждений нет.

## UNSENT — для hub

**Zakazbiletov**, маршрут — публичные контакты продавца; отправки нет.
Просим согласовать ограниченный GET официально связанных карточек группы Кино
или предоставить feed: артист, полная дата, площадка, город, страна, ссылка.
Сценарий — хранение и обновление этих фактов, публичный JSON каталога концертов
для путешественников, возможное редакционное/коммерческое использование; без
изображений, описаний и покупок. Уточните допустимую частоту, атрибуцию,
допустимые retention/deletion и условия reuse. Причина: footer требует согласия
правообладателя; технический доступ/robots не заменяет согласие.

**BandLink**, официальный маршрут — support/contact сервиса; отправки нет.
Просим согласовать feed или ограниченное чтение официальной страницы тура Доры
`https://band.link/dora_2026` с полными date/venue/city/country/source-event URL,
хранением и публичным JSON, включая потенциальное коммерческое использование.
Уточните исключение/отдельное соглашение к §2.10, частоту, атрибуцию и удаление.
Нужны права на этот сценарий, а не создание аккаунта/ссылки. До согласования
не подключать эту страницу как runtime source.

Для Кино и Lumen следующий содержательный шаг — получить от официального
источника явные country данные/полный календарь. Для Доры — доступный собственный
полный календарь или разрешённый feed. У Монеточки — повторная проверка при новом
официальном анонсе, без пустого конфига сейчас. Общего engine gap, требующего
правки shared runner/process/DB, не обнаружено.
