# Диагностика regional sources — 16.10.2026

Base: `6af49b13628cd0eeb728f16d62bdaaa17a94e069`. Локальная диагностика; публикацию и сравнение publisher выполняет measurement lane. DB/targets/shared runner/process/schema не изменены. [Реестр решений](/Users/alex/agent-hub/concerts-ru-data/questions.md). Полный отчёт: `/Users/alex/agent-hub/concerts-ru-data/coordinator/work/regional-sources-REPORT.md`.

## Метод и доказательства

Точечный native `runScraper` для 12 конфигов, затем `processConcerts` с текущей DB через artistDb и фиксированным clock из baseline-native.json. Без общего sweep, новых credentials, изменения UA/бюджетов/cadence, обхода защит или ручных дат в production.

Evidence: `/Users/alex/agent-hub/concerts-ru-data/evidence/sources/regional-sources/`. HTTP original bodies и metadata URL/status/requestedAt/SHA-256 плюс decoded bodies: http-manifest.json. Native config/id/URL/raw: baseline-native.json; normalization/whitelist/rejection: baseline-processed.json. Wire gzip/brotli и decoded SHA раздельны; оригиналы не изменены. Komnata/Zhenya выполнялись как два native конфига с одним URL; оба ответа сохранены.

Live index/status получены заново; lastRun `2026-10-16T09:12:22.120Z`. sourceHealth: venue degraded (129/157 success), artist degraded (381/415), Ticketmaster degraded (26/27, one invalid_response). Это aggregate, не per-country diagnosis; локальная DB и production не предполагаются равными.

## Существующие источники

| Config id | Точный URL | Native raw | Установленная граница / изменение |
|---|---|---:|---|
| uob-live-bangkok | https://www.uoblive.asia/whats-on | 0 | 301 на https://uoblive.asia/whats-on, затем native timeout после штатных retries; это доступ, не доказательство stale selectors. Canonical native GET тоже завершился timeout; URL не менялся. |
| thunder-dome-bangkok | https://www.thunderdome.biz/en/events | 10 | Читаемый архив: newest 06.10.2026; все даты прошли. Первая запись содержит диапазон 6–7 октября, selector читает начало. Нет доказанного будущего запаса. |
| fabrika-tbilisi | https://fabrikatbilisi.com/events/ | 12 | Последние карточки июнь 2025; market/design/wine, не исполнители. 0 accepted; не исправляется переносом года. |
| tatuza-jazz-club-tbilisi | https://telegraphhotel.com/restaurants-bars/tatuza-jazz-club/ | 15 | Upcoming October, даты без года, часть прошла; 0 accepted текущей whitelist. Не добавлены guessed years/aliases. |
| saga-danang | https://sagadanang.com/saga-events | 4 | Native got-scraping unchanged; recurring ECHO/CHOICE/RoMinimal/SHIFT night titles, не подтверждённые артисты. Даты без года; 0 accepted. |
| cafe-del-mar-bali | https://www.cafedelmarbali.co.id/whats-on/ | 0 | Source прямо пишет No upcoming events at the moment — check back soon. Добавлен emptyScheduleText: empty success теперь требует именно видимое сообщение; архив не объявляется upcoming. |
| colosseum-jakarta | https://colosseum.id/events/ | 10 | Архив август–октябрь 2024; 0 accepted. Не переносить в 2026/2027. |
| antoha-mc-tour | https://antoha-mc.ru/concerts | 0 | Fail-closed parse_error: upcoming section всё ещё содержит 15.10.2026 (кинопоказ). Live концерт не подтверждён. Production guard сохранён; fixture integration test теперь замораживает clock 07.10.2026, matching capture. Stale negative control сохранён. |
| bravo-tour | http://www.bravogroup.ru/show_all.htm | 2 | Оба поля city/venue брали один div.name: Atmosphere, Москва / Aurora Concert Hall, Санкт-Петербург. Source-only splitter разделяет поля, требует полный год и подтверждённый город. Standard selector не умеет substring одного text node. |
| vintazh-tour | https://annapletneva.ru | 7 → 2 | DD.MM без года: прошедший Roof Place 30.08.2026 из ticket URL становился 30.08.2027. Теперь год только из primary ticket URL с проверкой DD.MM; пять карточек без такого свидетельства удержаны. Accepted 2 → 1: удалена ложная будущая дата, Moscow 23.10.2026 сохранена. |
| komnata-kultury-tour | https://komnatakultury.ru | 24 | Native Tilda даёт 24 выступления группы. Follow-up: 11 полных дат из собственных ticket URLs совпадают с текущей нормализацией; ещё 13 без embedded year остаются по общему date contract, без source-wide inference. |
| zhenya-trofimov-tour | https://komnatakultury.ru | 24 | Удалён в отдельном follow-up: тот же календарь группы ошибочно приписывался сольному артисту. Source-only retirement исключает 24 ложные строки из active cache; approved artist и targets сохранены. |

## Ticketmaster TR/AE

Отдельных scraper JSON нет: src/engine/ticketmaster.ts, native fetchTicketmasterConcerts, endpoint https://app.ticketmaster.com/discovery/v2/events.json, countryCode=TR / AE, classificationName=music, size=200, sort=date,asc. Обе страны уже включены; новый config не нужен.

TICKETMASTER_API_KEY локально отсутствует (сохранён только boolean); local/main .env отсутствуют. Анонимный запрос не выполнялся; аккаунты/ключи не создавались. Live publication содержит 357 TR и 14 AE строк originalSource=ticketmaster.com, scrapedAt 2026-10-16T09:03:10.107Z; это не raw-country response и не объясняет aggregate invalid_response. Точный native TR/AE результат остаётся production-key/cache gap. Бюджеты/cadence не менялись.

## Би-2: цепочка потери

Approved Би-2 уже professional, manual target строка 355 присутствует, но dedicated official scraper отсутствует в обоих cohorts. Ошибочный website=https://bdva.ru/, нет существенных aliases/MBID — evidence передан identity lane, которая владеет DB/targets.

Target не обещает успешный Bandsintown/Eventbrite feed: 800/run и шестидневная cadence ограничены; status aggregate, не per-target cache. Локальный main reports не содержит provider/artist caches: конкретный исход последнего Би-2 feed/cache retention не утверждается. run.ts принимает artist cache только для активных configs: отсутствие конфига означает отсутствие собственного official raw пути; смена website не создаёт source. Exact Cyrillic проходит whitelist; pipeline не является доказанной причиной отсутствия official raw.

b2band.com/robots.txt: HTTP404 с Next.js HTML, не robots policy. b2band.com/ru два обычных GET — ECONNRESET, без обхода; календарь и terms live не прочитаны. tix.bi2.band robots HTTP200 разрешает User-agent:*, запрещает SemrushBot. Один GET homepage вернул календарь с полными годами и отдельными Meet & Greet пакетами: они не равны концертам. Видимая Privacy Policy прочитана GET: не лицензия перепубликации, ссылка refund policy на b2band.com. Terms автоматизированного сбора/публичного reuse не установлены; robots не заменяет terms. В прочитанной privacy policy запрета автоматического сбора не найдено; отдельные terms reuse не обнаружены. Уточнение hub 21:59 сохраняет разрешение на источник при отсутствии найденного запрета, без универсального требования письменной лицензии; отсутствие terms явно остаётся неопределённостью. Новый `scrapers/artists/bi2-tour.json` использует official tix homepage. HTML/JSON-LD/next_data проверены: JSON-LD/next_data нет; standard selectors не умеют сопоставить bilingual title и country из package по точным date/city/location и отделить non-concert products. Поэтому минимальный source-only custom module возвращает только 7 ordinary concert tickets; 28 Meet & Greet и gift certificate не становятся концертами. Никаких вручную заданных дат/городов.

Это частичный ремонт: Belgrade/Limassol в tix только packages; их концерты новый конфиг не утверждает. Web reader смог прочитать b2band.com/ru и linked refund-policy (официальные страницы), но native GET /ru дважды ECONNRESET. Web representation подтверждает концерт/место без года, не заменяет оригинальный HTML для same-input native extraction. Отдельный b2 homepage source пока не добавлен. Refund policy регулирует возвраты, не даёт установленного разрешения reuse; доступный reader snapshot не назван свежим raw capture. Исходники tix сохранены; dates не вписаны вручную.

## Проверки

- Полный npm test: 867 total / 866 pass / 0 fail / 1 ожидаемый skip. Отдельный production SSRF без localhost override: 1/1 pass.
- Focused affected suite: 81/81 (включая existing custom-scrapers, native originals и negative controls). Первоначальный полный прогон выявил старый synthetic Vintazh fixture без полных дат; он обновлён, географические/layout assertions сохранены. Antoha frozen fixture clock исправлен без изменения production guard.
- npx tsc --noEmit и npm run lint: pass, 0 ошибок / 103 существующих lint warnings. Selector ratchet: 125 <= 131, pass. git diff --check pass. Artist-integrity gate N/A: DB не менялась; shared pipeline/SSRF guard не менялись, production SSRF отдельно проверен.
- Исходный native batch: 108 raw → 52 accepted. Candidate native replay оригинальных HTTP bodies: 110 → 58. Прибавились 7 exact-Cyrillic Би-2; удалён 1 phantom Винтажа; 2 Браво получили раздельные city/venue. Это normalization/whitelist/dedup, не publisher delta. Local identity data остаётся base; объединённая identity revision проверяется measurement lane.
- config-inputs.json хранит config-id → exact URL/original+decoded SHA/base config hash/capture clock; candidate-final-native.json и candidate-final-processed.json, capture scripts и offline replay.ts доступны рядом. Все новые custom paths работают только с переданным HTML, detail HTTP не нужен. Replay принудительно использует axios только как offline transport для сохранённого got ответа; live saga backend не менялся.
- UOB native timeout, отсутствующий TM key/raw cache, per-target provider Би-2 cache, native b2 homepage и package-only Belgrade/Limassol остаются явно открытыми границами. Публикация/production effect не утверждаются. Фоновых серверов не запускал; начатые collector/test processes завершены.


## Доступ Би-2: датированные первичные материалы

Проверено 16.10.2026 около 18:56–19:00 UTC, GET/read only:

| URL | Результат | Граница |
|---|---|---|
| https://b2band.com/robots.txt | native HTTP404, HTML | Нет действительной robots policy; не используется как calendar. |
| https://b2band.com/ru | native ECONNRESET дважды; official web reader читает | Reader не даёт оригинальный same-input HTML; года в видимых DD MMM нет. |
| https://tix.bi2.band/robots.txt | native HTTP200 | Wildcard Allow, SemrushBot Disallow. |
| https://tix.bi2.band/ | native HTTP200, original HTML SHA256 `0aa36abb009f97a6d2e66fe81425bc0e10b8175c7c4d6ec58daa3daeb73d073d` | 7 ordinary concerts / 28 Meet & Greet / 1 certificate. Passive page scripts не исполнялись. |
| https://tix.bi2.band/promoter/privacy-policy/link/bi2?widget=true&modal_widget=true | native HTTP200, SHA256 `ca0439bfa3c70737291e80cd46ea4479279d62fe40a638944667f62aaf32bdda` | Privacy data policy, automated-collection запрет не обнаружен; общая reuse licence не установлена. |
| https://b2band.com/refund-policy | official web reader, snapshot indexed last month | Условия возвратов; не свежий raw capture, не лицензия каталога. |


## Follow-up: устранение ложной solo attribution Комнаты культуры

Дополнительный пакет после `04d5892`; предыдущие коммиты не изменены. Первоначальная передача вопроса атрибуции identity/publisher lane была ошибочной: это ответственность source lane. Текущие выводы заменяют ту часть первого отчёта.

Сохранённый original `014-367a410b85.decoded.html` (URL https://komnatakultury.ru, native capture 16.10.2026; SHA в исходном http-manifest.json) содержит title «Комната культуры», h1/h2 «Официальный сайт Группа Комната Культуры», билеты `gruppa-komnata-kultury`. Сольный bill не найден. Два прежних конфига использовали один календарь и parser; единственная подмена artistNameFallback давала 24 ложные записи «Женя Трофимов», которые действительно проходили текущий whitelist.

Удалён только `scrapers/artists/zhenya-trofimov-tour.json`. Канонический `komnata-kultury-tour` и его 24 native rows сохранены побайтно по extraction output; parser остаётся общим legacy implementation, active solo-конфига больше нет. DB/targets, runner/matcher/schema не менялись. В тестах archived config воспроизводит исходный дефект; в production он не загружается.

Проверен реальный consumer path из run.ts: saveCache → loadCache → filterArtistCacheForActiveConfigs с настоящим каталогом scrapers/artists → processConcerts. Старые 24 ложных solo rows остаются в сохранённых cache bytes как orphan, но отсутствуют в active view и output; 24 canonical group rows и active peer Браво сохраняются. Это проверка на seeded cache из фактического native output, не утверждение об очистке недоступного production cache. Физическое удаление старого cache не требуется для исключения из публикации.

В native ticket URLs проверены 10 base64 session payloads widget.afisha.yandex.ru с epoch milliseconds и 1 campaign slug Ярославля DDMMYYYY. Все 11 дают тот же YYYY-MM-DD, что текущий parseDate на capture clock. Неверного года на этих строках нет; production date extraction не менялась. Для ещё 13 embedded year отсутствует: источник-wide год не переносился, seller checkout не запрашивался.

Focused/cache/custom suite 78/78, TypeScript и focused lint pass. Full combined suite оставлена root по follow-up brief. Новый source-only same-input replay: 110 → 86 raw, 58 → 34 pipeline accepted; ровно 24 удалённых строки «Женя Трофимов», 0 добавлений, все 24 group rows и остальные source rows неизменны. Это delta относительно первого пакета с исходной DB; итоговый publisher с объединённой identity DB проверяет measurement lane.

Точный row inventory, year witnesses/13 оставшихся rows, seeded persisted/active cache и replay outputs: `/Users/alex/agent-hub/concerts-ru-data/evidence/sources/regional-sources/komnata-followup/` (delta.json, cache-seeded-from-native.json, active-cache.json, candidate-native.json, before-processed.json, candidate-processed.json, replay.ts). New network requests: 0.
