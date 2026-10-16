# Адресные RU identities и targets — 16.10.2026

Локально исправлены имена/идентичности из owner brief стадии `concerts-ru-data`.
База — `6af49b13628cd0eeb728f16d62bdaaa17a94e069`, ветка
`agent/concerts-ru-identities-20261016`.
[Реестр решений](/Users/alex/agent-hub/concerts-ru-data/questions.md) (P-DATA-001).
Источник задания — `owner-brief.md`, gaps §2–5 и конечный brief исполнителя.

Переиспользованы `artistDb.loadApprovedArtists/saveApprovedArtists`, реальный
`buildApprovedMatcher/processConcerts` и `loadArtistTargets`. Все изменения БД
выполнены через API; прямого редактирования shards нет. Сохранены source configs,
runner/matcher/schemas, workflows, бюджеты, cadence, BACKLOG и чужие worktrees.
Новых зависимостей нет; node_modules — локальная игнорируемая ссылка на уже
установленный каталог основного checkout. Никакой публикации или отправки запросов
на доступ нет. Внешние обращения — только GET публичных identity/official страниц,
без передачи содержимого репозитория, с project UA для прямых GET.

## Новые записи: старое → новое

У всех следующих строк ранее отсутствовали каноническое имя и соответствующий
MBID. Старые name/MBID/QID/site: **нет записи**. QID в таблице — проверенное
основание идентичности, а не новое поле схемы: QID в DB не сохранялся.
Ссылки MB и WD открывались через web/GET; если MB был недоступен, P434 проверялся
непосредственно в JSON Wikidata. Наличие target не означает получения концертов.

| Новое имя / проверенный MBID | QID / первичное основание | Новый website / aliases |
|---|---|---|
| ДДТ — [f7456b5b-e5a5-454e-b5db-047308210c8e](https://musicbrainz.org/artist/f7456b5b-e5a5-454e-b5db-047308210c8e) | [Q949424](https://www.wikidata.org/wiki/Q949424), Russian rock band | [ddt.ru](https://ddt.ru/), GET 200 «Группа ДДТ. Официальный сайт»; `DDT` |
| Нервы — [d620cf32-e240-46a4-a078-db87acb5ffa0](https://musicbrainz.org/artist/d620cf32-e240-46a4-a078-db87acb5ffa0) | [Q4317443 JSON](https://www.wikidata.org/wiki/Special:EntityData/Q4317443.json), Ukrainian musical group, RU/EN labels и P434 | `null`; `Nervy`, `Нерви`. Официальный website не установлен; похожие домены не присвоены |
| Oxxxymiron — [fb2a8279-79cf-4849-b692-1ce674709159](https://musicbrainz.org/artist/fb2a8279-79cf-4849-b692-1ce674709159) | [Q4046107](https://www.wikidata.org/wiki/Q4046107), Мирон Фёдоров | [oxxxymiron.com](https://oxxxymiron.com/), официальный tour/merch, WD P856; `Оксимирон` |
| Монеточка — [30fcffbe-1083-4e3e-b85a-9b184b97d09f](https://musicbrainz.org/artist/30fcffbe-1083-4e3e-b85a-9b184b97d09f) | [Q32361743](https://www.wikidata.org/wiki/Q32361743), Елизавета Гырдымова | [monetochka.world](https://monetochka.world/), Fairy Tale Tour, P856; `Monetochka` |
| Little Big — [cbe51088-e4d8-463e-9f4e-e83fa64d3f5e](https://musicbrainz.org/artist/cbe51088-e4d8-463e-9f4e-e83fa64d3f5e) | [Q24261863](https://www.wikidata.org/wiki/Q24261863); MB disambiguation Russian rave band | [littlebig.band](https://littlebig.band/), описание LA-based band from Saint Petersburg и ссылка Tour. Little Big Town не alias |
| Макс Корж — [38cfabf6-080c-499d-b8e8-b48aa60b7237](https://musicbrainz.org/artist/38cfabf6-080c-499d-b8e8-b48aa60b7237) | [Q15640304](https://www.wikidata.org/wiki/Q15640304), белорусский исполнитель | [maxkorzh.com](https://maxkorzh.com/), WD P856 и прочитанная official страница; `Max Korzh`, `Maks Korzh` |
| Zivert — [225712aa-699f-4e77-8547-93dfcdfa5666](https://musicbrainz.org/artist/225712aa-699f-4e77-8547-93dfcdfa5666) | [Q62079006](https://www.wikidata.org/wiki/Q62079006), Юлия Зиверт; MB Person/RU | [zivert.com](https://zivert.com), official URL из WD P856. Прямой GET не прошёл TLS-проверку: сертификат истёк; доступность не подтверждена, TLS не отключался. `Зиверт` |
| Баста — [dc453ee9-f2d4-4582-840b-b3be6c79654d](https://musicbrainz.org/artist/dc453ee9-f2d4-4582-840b-b3be6c79654d) | [Q3986754](https://www.wikidata.org/wiki/Q3986754), Василий Вакуленко; P434 с именем Баста | [bastatickets.ru](https://bastatickets.ru/), GET 200 «Официальный сайт концертов Басты», WD P856; `Basta`. Ноггано/N1NT3ND0 имеют другие MBIDs, их не присваивали |
| Кино — [064db6e8-fdfb-4acb-a327-fc2de75b37de](https://musicbrainz.org/artist/064db6e8-fdfb-4acb-a327-fc2de75b37de) | [Q650555](https://www.wikidata.org/wiki/Q650555); MB Soviet rock band и релизы 2022/2025 | [kino.band](https://kino.band/); `Группа Кино`, `Gruppa Kino`. Латинский `Kino` не присвоен |
| Дора — [d87c14ef-f570-470d-be76-3e2023fa4f61](https://musicbrainz.org/artist/d87c14ef-f570-470d-be76-3e2023fa4f61) | [Q99640642](https://www.wikidata.org/wiki/Q99640642); MB Dora, Russian singer, Дарья Шиханова, 1999-11-30 | `null`: realdora.com из WD не удалось прочитать. Кириллическое имя case-insensitive; латинский `Dora` не присвоен |
| MORGENSHTERN — [ae97ba5f-e7ed-4ed5-9a53-eba415fc49d4](https://musicbrainz.org/artist/ae97ba5f-e7ed-4ed5-9a53-eba415fc49d4) | [Q59194713](https://www.wikidata.org/wiki/Q59194713); MB Person, Ufa, 1998-02-17 | [morgenshtern.love](https://morgenshtern.love/), официальный merch/WD P856; `Моргенштерн`. Проверены WD Spotify/Instagram/YouTube/Telegram/VK; непрозрачная старая Facebook-ссылка не перенесена |

Новые строки не получают выдуманные popularity, image, tier, lastConcertSeenAt или
verifiedAt. У нетиерированных строк обычная eligibility `loadArtistTargets` уже
работает; explicit targets сохраняют их при последующем скоринге без изменения
лимитов запросов.

## Исправленные и объединённые записи

| Старая запись / MBID / site | Новая запись / MBID / site | Первичное основание и сохранённое |
|---|---|---|
| Би-2 / MBID отсутствовал / `https://bdva.ru/` | Би-2 / [5ca35ace-4006-4d4a-af04-5cd91dafab14](https://musicbrainz.org/artist/5ca35ace-4006-4d4a-af04-5cd91dafab14) / [b2band.com/ru](https://b2band.com/ru) | [Q684599](https://www.wikidata.org/wiki/Q684599), MB Bi-2 Russian alt-rock band. Актуальный официальный сайт прочитан: концерты, b2band.store, go.bi2.band/tix.bi2.band. WD всё ещё хранит старый bdva.ru — он не принят вместо живого первичного сайта. Alias `Bi-2`; все прочие metadata сохранены |
| Сплин / MBID отсутствовал / `http://splean.ru` | Сплин / [0783b768-6719-450b-a7e1-7e891da17af3](https://musicbrainz.org/artist/0783b768-6719-450b-a7e1-7e891da17af3) / site прежний | [Q48339](https://www.wikidata.org/wiki/Q48339), MB Splean; aliases `Splean`, `Splin`. Остальная запись без изменений |
| Мумий Тролль и Мумий троль / MBID отсутствовал / `https://mumiytroll.com` и `null` | Мумий Тролль / [f91b9b28-25b7-4064-81d1-f43163085770](https://musicbrainz.org/artist/f91b9b28-25b7-4064-81d1-f43163085770) / основной site прежний | [Q948934](https://www.wikidata.org/wiki/Q948934), MB Мумий Тролль/Mumiy Troll. У typo-строки совпадают полные genres/popularity/similarArtists с основной строкой, собственного site/MBID нет; это подтверждённая опечатка. Сохранены aliases `Мумий троль`, `Mumiy Troll` и полная основная metadata |
| Ляпис Трубецкой, Lyapis Trubetskoy, ♫Ляпис Трубецкой / **у всех** `452b56d2-c904-4030-ad12-6d4fbd498e1f` / `http(s)://lyapis.com[/]` | Ляпис Трубецкой / [тот же MBID](https://musicbrainz.org/artist/452b56d2-c904-4030-ad12-6d4fbd498e1f) / [lyapis.eu](https://lyapis.eu/) | [Q32826](https://www.wikidata.org/wiki/Q32826), точное совпадение MBID, MB каталог и текущий официальный сайт Михалока. lyapis.com теперь показывает азартный контент и не сохраняется. Сохранены Latin/♫ и все прежние полезные белорусские aliases; canonical image/popularity/genres/similar/tier и последний известный lastConcertSeenAt. Старые противоречащие social URLs не смешивались |
| Земфира / `cec59910-2d12-46ec-8e39-85ca06acb0ed` / `http://www.zemfira.ru/`; Zemfira / `7f5c2724-07d4-4bb8-856c-5e2928f77d9e` / `https://zemfira.world` | Земфира / [cec59910-2d12-46ec-8e39-85ca06acb0ed](https://musicbrainz.org/artist/cec59910-2d12-46ec-8e39-85ca06acb0ed) / [zemfira.world](https://zemfira.world/) | [Q242454](https://www.wikidata.org/wiki/Q242454) явно связывает оба P434: сценический псевдоним и Рамазанова. Каноническая русская запись сохранена; Latin name и все полезные aliases перенесены. Подробное обоснование ниже |
| Doro Pesch / `8f72ef7e-bc18-4c5d-a4ac-20a5a3a4ab33` / `https://www.doromusic.de/`; alias **Дора** | Та же Doro Pesch, тот же MBID/site, без alias **Дора** | Российская [Дора в MB](https://musicbrainz.org/artist/d87c14ef-f570-470d-be76-3e2023fa4f61) — отдельная персона. Удалён только ложный alias, прочие aliases/metadata иностранной записи сохранены |
| Morgenstern / `2f9c67a0-19d8-4bb8-b1bf-40157eb4142f` / `https://morgenshtern.com/`, RU соцсети, смешанные жанры | Morgenstern / [тот же немецкий MBID](https://musicbrainz.org/artist/2f9c67a0-19d8-4bb8-b1bf-40157eb4142f) / `null` | MB прямо называет **Andrea Börner**, DE, Person/Female; [Q6912027](https://www.wikidata.org/wiki/Q6912027), [выпускающий лейбл ant-zen](https://ant-zen.bandcamp.com/album/cold) подтверждает noise/industrial solo project. RU socials убраны, `folk metal` убран как примесь третьего одноимённого артиста. Смешанные image/popularity/similarArtists и относящиеся к ним timestamps, неподтверждённый lastConcertSeenAt удалены, а не перенесены на рэпера. Остальные industrial/noise genres и иностранный MBID сохранены |

У существующих строк QID не хранился и не добавлялся. Удалены ровно четыре строки
дублей из таблицы, их имена сохранены aliases. Не выполнялась общая консолидация
по MBID, fuzzy name, домену или Spotify по всему каталогу.

### Земфира: два настоящих MBID, одно концертное имя

[MB 7f5c…](https://musicbrainz.org/artist/7f5c2724-07d4-4bb8-856c-5e2928f77d9e)
прочитан через ссылку на credits: «Земфира Рамазанова», Person, legal name
Земфира Талгатовна Рамазанова, 1976-08-26. Это действительный person/author ID,
а не выдуманный или ошибочный MBID. Сценический `cec59910…` подтверждён отдельно
в [релизе P.M.M.L](https://musicbrainz.org/release/31f36acb-6bb0-4b8e-ab9b-de591e615814):
ссылки «Zемфира»/«Земфира» ведут на cec59910…, credits вокала/авторства — на
Рамазанову 7f5c…. [WD JSON Q242454](https://www.wikidata.org/wiki/Special:EntityData/Q242454.json)
даёт обе P434 с qualifiers «subject named as Земфира Рамазанова» и «pseudonym
Земфира», один DOB и Spotify `6oO3QiWdVj5FZQwbdRtsRh`. Прямые отдельные MB
artist/details/relationships GET для cec59910… отвечали 429/недоступностью;
семантика установлена по доступным собственным MB credits и WD, без обхода.

Для концертного approved-каталога оставлен существующий performer MBID cec59910…
и кириллический primary name. Старый author ID документирован выше, не объявлен
недействительным и не заменён в иных артистах/works. Сохранены canonical image,
genres, popularity, similarArtists, tier=professional, timestamps; из Latin
строки взяты ненулевые current official handles (Spotify тот же, Instagram
zemfiraworld, YouTube UCaYQXoII8_plzI_nDrmlZJQ, Telegram zemfiraworld), остальные
непустые legacy canonical поля сохранены. От Latin строки также сохранён
`wikidataSitelinks=63`, прежде отсутствовавший в canonical. У Ляписа аналогично
сохранён `wikidataSitelinks=20`. Это прежние измерения metadata, не заявление
о свежем пересчёте fame. Прежние author-name aliases остаются
доступными одному концертному имени. Внешние клиенты, хранившие старый Latin
slug/author MBID, могут потребовать отдельной миграции: consumer-код здесь защищён.

### Кино: действующий состав и граница name-only targets

[Официальный kino.band](https://kino.band/) говорит о возобновлённой группе:
живые музыканты Юрий Каспарян, Александр Титов, Игорь Тихомиров и оцифрованные
оригинальные записи голоса Виктора Цоя. В афише есть концерты 2026–2027.
Это текущая концертная группа, а не новый alias британского prog `Kino` и не
автоматически любой трибьют или отдельный проект
[«Симфоническое Кино»](https://symphokino.band/).
MB 064db6e8… также включает современные «12-22»/«Молнии Индры».

Существующий manual target — строка, а не имя+MBID или source binding.
Он **может представить запрос `Кино`**, и реальный loader это подтвердил.
Поэтому добавлена ровно эта кириллическая цель и approved-запись; английские
`Kino`/`KINO` оставлены британскому каноническому имени. Получение provider-строк
`Kino` о российской группе этим изменением не исправляется: без provenance это
неразрешимая неоднозначность для нынешнего name-only matcher. Латинский alias
и массовая замена не реализованы; для таких строк нужен отдельный разрешённый
source-specific identity contract. Концертных дат вручную не добавляли.

## Targets

`data/artist_scrape_targets.txt`: **2431 → 2441** непустых explicit строк.
Добавлены 12: `ДДТ`, `Нервы`, `Oxxxymiron`, `Монеточка`, `Little Big`, `Макс Корж`,
`Zivert`, `Баста`, `Кино`, `Дора`, `MORGENSHTERN`, `Lumen`.
Убраны ровно `♫Ляпис Трубецкой`, `Мумий троль`: их canonical targets уже есть.
Все остальные строки и их порядок сохранены. Би-2, Сплин, Земфира, Ляпис,
Мумий Тролль и Noize MC остаются прежними explicit targets.

`Lumen` — existing longtail, MB
[fc582f4a-0fe5-4cdc-96c5-527fdbbb30e6](https://musicbrainz.org/artist/fc582f4a-0fe5-4cdc-96c5-527fdbbb30e6),
Russian band; [официальная афиша](https://lumen.ws/contacts/) подтверждает группу.
Его DB-строка целиком сохранена, добавлен только target. `Noize MC` уже имеет
проверяемые имя, aliases, MBID a0c5737e-da6d-468f-a78e-19146494f1db, website
noizemc.com и target; его DB-строка целиком сохранена.

Реальный `loadArtistTargets`: **20781 → 20791** distinct активных имён на этой
базе (explicit + обычные eligible записи). Нет изменения 800/run, 6-day revisit
или других budgets/cadence. Появление approved/target — prerequisite сбора,
а не доказательство доступности BIT/Eventbrite, свежести или новых published events.

## Ограниченные не-реализованные случаи

- Латинский `Dora` в старой БД имеет испанские/Eurovision metadata, без MBID/site.
  Их происхождение не установлено; **запись побайтно по полям сохранена**, alias
  `Dora` российской Доре не добавлен. Без provenance латинские объявления не
  разрешаются в пользу RU по умолчанию.
- Латинский `Morgenstern` обозначает немецкий проект Andrea Börner. Не добавлен
  RU alias с этим написанием; для рэпера используются MORGENSHTERN/Моргенштерн.
  Смешанные Last.fm/Deezer image/listeners не атрибутированы ни одной стороне.
- `Kino` UK (39568c43-87a3-4711-92dd-7a33bd4e92ef) целиком сохранён; латинские
  строковые совпадения не доказывают российского исполнителя.
- Нервы: Q4317443 подтверждает MBID/варианты имени, но website не установлен.
  nervyofficial.com оказался магазином без подтверждённой связи с этой группой;
  nervyofficial.ru недоступен. realdora.com — timeout, Zivert — TLS/timeout.
  Эти границы не скрыты исправлением site/SSL или выдуманными ссылками.
- Права на новые автоматические источники, импорт дат Би-2, same-input
  raw→published прирост, юридические/редакционные решения и релиз принадлежат
  хабу/другим пакетам. Здесь проверена идентичность, а не разрешение scraping.

## Повторение и доказательство границ diff

Скрипт `src/scripts/repair_ru_artist_identities_20261016.ts` по умолчанию делает
dry-run; `--apply` использует только artistDb API, проверяет ожидаемые identities,
отказывается менять конфликтующий MBID и сверяет полную перечитанную DB с
кандидатом. Действует только на точные 22 разрешённых имени; глобальных replace
и запросов нет. Повторный dry-run после применения: added/removed/changed = [].

Снимок before получен API **до** первой записи, after — API после atomic save.
Сравниваются полные записи со всеми неизвестными полями, а не только число/MBID:
**63 390 → 63 397**, добавлено 11, изменено 7, удалено 4 подтверждённых дубля;
все **63 379** остальных записей сохранены. Исходные `Little Big Town`, `Doro`,
`Dora`, `Kino`, `Noize MC`, `Lumen` целиком неизменны. У `Doro Pesch` изменён
только aliases. После сохранения полный round-trip совпал с candidate.

Регрессии используют реальную `data/artists` через API и реальный matcher в
default/exact modes для всей named list и aliases; отдельные foreign controls
Little Big Town, Doro/Doro Pesch, Morgenstern DE, Kino UK и Dora. Проверены
`processConcerts` (10 синтетических полных строк → 10 разных правильных MBID),
реальный target loader, повторяемость и отказ при drift/unrelated mutation.
Синтетические строки — тест attribution, не новые собранные события.

SHA-256 JSON-массива 63 379 неизменных записей (порядок API before, полные поля):
`ef84bef5441bc75d688c0961ccc2946caa3b086a2db4334f7f4c8ced16a7fe8d`.
Локальная полная сводка API diff: `/tmp/ru-identities-api-audit.json`.

| Проверка | Результат |
|---|---|
| `node --import tsx --test tests/ru_artist_identity.test.ts` | PASS 6/6, 0 skips; реальная DB, matcher, normalization и targets |
| `node --import tsx --test tests/artistDb.test.ts tests/artist_integrity.test.ts tests/concurrency_group_coverage.test.ts` | PASS 20/20: artistDb 8, integrity rules 10, concurrency coverage 2 |
| `node --import tsx src/scripts/audit_artist_integrity.ts --strict` | PASS, 156 errors без роста относительно baseline и before; warnings 1021 → 1019. baseline не изменялся |
| `npx tsc --noEmit` | PASS |
| `npx eslint src/scripts/repair_ru_artist_identities_20261016.ts tests/ru_artist_identity.test.ts` | PASS, без lint errors/warnings; только прежнее Node MODULE_TYPELESS_PACKAGE_JSON notice |
| повторный migration dry-run, полный API diff и `git diff --check` | PASS; zero unowned differences, added/removed/changed=[] при повторе |

Watchdog `check-concurrency-drops` не запускался: это не локальный gate, а скрипт
с `gh issue` mutations. Применимая offline concurrency group coverage проверена.
Новых workflows/writers нет. Общие npm test/build/lint и same-input source replay
выполняет хаб на объединённой ветке; здесь широкой suite не запускали.

### Датированные первичные GET

Проверка 16.10.2026. Wikidata JSON получены с TLS-проверкой через
`Special:EntityData`; для воспроизведения содержимого зафиксированы revision ID
(например `https://www.wikidata.org/w/index.php?title=Q242454&oldid=2549538044`).

| QID | Проверенная revision |
|---|---|
| Q949424 (ДДТ) | 2530572307 |
| Q4317443 (Нервы) | 2434932283 |
| Q4046107 (Oxxxymiron) | 2546544853 |
| Q32361743 (Монеточка) | 2538815206 |
| Q24261863 (Little Big) | 2555844971 |
| Q15640304 (Макс Корж) | 2554297877 |
| Q62079006 (Zivert) | 2553065867 |
| Q3986754 (Баста) | 2546994511 |
| Q650555 (Кино) | 2535815682 |
| Q99640642 (Дора) | 2539551905 |
| Q59194713 (MORGENSHTERN RU) | 2544918171 |
| Q684599 (Би-2) | 2530097309 |
| Q48339 (Сплин) | 2530036382 |
| Q948934 (Мумий Тролль) | 2499675684 |
| Q32826 (Ляпис Трубецкой) | 2526973308 |
| Q242454 (Земфира) | 2549538044 |

Прямой GET official ДДТ 200: body SHA-256
`d21abd03ab9183a9e0cd2e436ff32e7ce4cd7cd9a752c6c5ef7d3ff8f8e98d9b`;
Баста 200: `c26e5ed49bb33be5f5d31af51711bb23cfdc1b0d6419ee6aca143a3cb995325d`;
Ляпис 200: `d2892a7fbec9a00002e7e40457c1c9522bea2339f9f6f1a15e12639d4029ac89`.
Другие успешные official страницы из таблиц прочитаны web-инструментом;
тайм-аут прямого GET не выдаётся за полный raw capture. Процессы сбора концертов,
внешние LLM, публикация и любые обходы ограничений доступа не запускались.
