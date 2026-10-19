# Официальные календари: ДДТ, Oxxxymiron, Баста, Макс Корж, Zivert — 19.10.2026

Исполнитель `official-sources-west`, стадия `concerts-ru-data-2`. Локальный результат: один новый источник, **два будущих концерта ДДТ в Германии**. Остальные четыре случая исследованы без добавления пустых или предположительных конфигов. Публикация, объединённый publisher replay и финальное ревью принадлежат hub. [Реестр решений](/Users/alex/agent-hub/concerts-ru-data-2/questions.md).

## Основа и границы

Проверены common-brief.md, принятые identity из `src/scripts/repair_ru_artist_identities_20261016.ts`, `bi2-tour.json`/custom parser, стандартные selectors/JSON-LD и существующий publisher harness `src/scripts/ru_data_expansion_replay.ts`. Взяты существующие движки и artistDb; общий код, БД, бюджеты, лимиты и расписания не изменены. Исследовательский skill выполнен самим назначенным исполнителем; вложенная делегация запрещена брифом. Для PDF условий Lotus использован read-only путь pdf skill и `pdftotext`.

Все GET — с существующим UA runner, стандартной проверкой TLS, без форм, регистраций, оплаты и обхода защиты. DDT robots требует crawl-delay 10; между запросами выдержано минимум 11 секунд. Остальные последовательные запросы одного домена разнесены минимум на 2 секунды. Redirect переходы сохранены отдельными ответами; JS challenge Intickets не проходился. Поиск web-reader — только дополнительное наблюдение, не нативная fixture.

## Результаты пяти случаев

| Артист | Нативный результат и решение |
|---|---|
| **ДДТ** | `ddt.ru` прямо ссылается на `ddt-tour.ru`; календарь тура связывает Essen/Ingolstadt с Bilet.Kartina.TV, а hall → breadcrumb ведёт к календарю группы. Добавлен только `ddt-tour`: 05.12.2026 Essen / Essen Grugahalle и 09.12.2026 Ingolstadt / Saturn Arena, страна `DE` взята из каждого нативного JSON-LD. |
| **Oxxxymiron** | Полный GET 200 официального календаря: 26 карточек, апрель–июль. Meta description/og:title называют тур 2026; остаточный keywords содержит 2025. Будущих дат относительно 19.10.2026 в этом календаре не подтверждено; год в 2027 не переносился. Билетные подписи не дают действующих event href. Конфиг не создан. Это вывод о проверенном календаре, не глобальное доказательство отсутствия концертов. |
| **Баста** | `bastatickets.ru` GET 200, будущие даты и явные заголовки месяцев 2026/2027 есть. Явной страны в исходных карточках нет. Связанный Intickets возвращает self-redirect/cookie challenge для robots и JS meta-refresh challenge вместо event HTML; не обходился. Связанный BIG ART содержит BASTA LIVE 07.11.2026, однако адрес не содержит страны. Конфиг с угадыванием RU/AE не создан. Никакие даты Ноггано/N1NT3ND0 не приписаны Басте. |
| **Макс Корж** | robots 200 разрешает календарь; нативные GET главной, `/tour-dates/`, `/event/frankfurt/` прерываются чтением. Дополнительный обычный curl `/tour-dates/` получил HTTP 200, но только **16384 из 29157 байт**, exit 28: это неполный ответ. Web-reader показывает Frankfurt 10.10.2026 и переносы без дат, но не подменяет нативную проверку. Конфиг не создан; текущий полный календарь нативно не подтверждён, нулём событий это не объявлено. |
| **Zivert** | Оба официальных варианта `zivert.com` и найденный в индексе `www.zivert.com`, включая robots, не проходят TLS: certificate has expired. Поиск в официальном домене показывает 13.11.2026 и 11.07.2027, но получить действующие исходные ticket href/terms не удалось. Неофициальные sellers из поиска не приняты за официальный альтернативный календарь. Конфиг не создан; это access blocker, не отсутствие дат. TLS не отключался. |

## Условия и robots перед добавлением

Все URL, HTTP/error, UTC clock и SHA оригинальных bytes находятся в [индексе captures](../tests/fixtures/ru-data-2-west/captures.json). Оригиналы хранятся неизменными в `/Users/alex/agent-hub/concerts-ru-data-2/evidence/official-west/`; fixture `.body.gz` — gzip с mtime=0 от **тех же** bytes, а не пересобранный HTML. Manifest хранит SHA и оригинала, и gzip. Ответ curl Макса явно частичный; ошибки TLS не имеют выдуманного body.

- **ДДТ**: [robots тура](https://ddt-tour.ru/robots.txt), HTTP 200, `Crawl-delay: 10`, путь `/` не закрыт. `ddt.ru/robots.txt` — 404. Прочитана связанная [оферта DOCX](https://ddt-tour.ru/agree.docx): запрета ограниченного чтения концертного календаря не найдено; покупка/возврат билетов не совершались.
- **Bilet.Kartina.TV**: [robots](https://biletkartina.tv/robots.txt) 200, разрешает выбранный `/ru/event/Gruppa_DDT_v_Germanii`, закрывает `/api/`, calendars/служебные пути, они не запрашивались. Прочитаны связанные [AGB](https://biletkartina.tv/ru/info/agb) и [Rechtliche Hinweise](https://biletkartina.tv/ru/info/rechtliche), оба 200. AGB регулирует покупку, legal notice указывает владельцев copyright и запрещает неразрешённое использование бренда/логотипа как своего. Конкретного запрета выбранного ограниченного автоматического чтения не найдено. Это **no prohibition found**, не открытая лицензия и не подтверждённые downstream-права.
- **Lotus Arena**: redirect старого ticket-host ведёт на `lotusarena.com`; [robots](https://lotusarena.com/robots.txt) разрешает event pages. Через footer → user agreement page получен [оригинальный PDF](https://lotusarena.com/documents/user-agreement?lang=en), документ с датой 23.06.2026, §5.11, стр. 4: запрещены коммерческое использование без отдельного соглашения и автоматический сбор данных. **Никакой конфиг Lotus не добавлен**, несмотря на подтверждённые даты 13/16.01.2027. Pattaya также имеет конфликт детализации: root DDT называет Pattaya, JSON-LD detail — `addressLocality: Chon Buri`; не исправлялось догадкой. Ниже UNSENT запрос.
- **Oxxxymiron**: robots 200, `/` разрешён, `/page32544380.html` закрыт и не запрашивался. В прочитанном footer нет terms/privacy ссылки; это **unknown terms**, не установленный запрет и не лицензия. Нового источника нет из-за отсутствия подтверждённых будущих дат.
- **Баста**: robots 200, `/` разрешён, служебные Tilda-пути закрыты и не запрашивались. Прочитана встроенная политика обработки персональных данных; отдельной оферты сбора в footer не найдено. **Unknown downstream rights**. BIG ART robots 404 (www), terms 200 после сохранённых redirects: условия покупки, без найденного запрета выбранного чтения. Конфиг всё равно не создан из-за отсутствия явной страны. Intickets robots недоступен как обычный robots, challenge не считается разрешением.
- **Макс Корж**: robots 200, `/tour-dates/` не закрыт; footer в web-reader указывает informational resource, не продажу билетов. Полный нативный terms/footer не получен, **unknown**, конфиг не создан.
- **Zivert**: robots/terms невозможно проверить нативно из-за TLS; **unknown**, конфиг не создан.

## Почему custom_js для ДДТ

[Нативный календарь](https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii) содержит MusicEvent с названием «Группа ДДТ в Германии», но performer — `Yuri Shevchuk`. `extractJsonLd` предпочитает performer и выдаёт именно его, что проверено тестом. Static selectors не читает JSON array. Узкий parser проверяет URL/domain/h1/название каждого события/performer, MusicEvent + scheduled offline, полный валидный год/дату, явные city/country/venue, точный event URL. Каноническое имя — **ДДТ**. Отмены/переносы/merch не публикуются; fallback-страна конфига не используется для заполнения отсутствующего `addressCountry`.

## Нативное извлечение и повторение тех же входов

- [inputs.json](/Users/alex/agent-hub/concerts-ru-data-2/evidence/official-west/inputs.json): готовый формат **существующего** `ru_data_expansion_replay.ts`; один config → один captured response.
- Clock: `2026-10-19T07:21:33.815178+00:00`.
- Config: `scrapers/artists/ddt-tour.json` → `https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii` → `deac8dc26fd613f440.body`, SHA-256 `2b7cc34a6429d0450f5a05ed7712e8a2c0915bc85b87fa0ffb5a94675c7486a3`.
- [ddt-native-run.json](/Users/alex/agent-hub/concerts-ru-data-2/evidence/official-west/ddt-native-run.json): настоящий `runScraper`, 2 raw rows, event URLs и scrapedAt.
- [ddt-native-process.json](/Users/alex/agent-hub/concerts-ru-data-2/evidence/official-west/ddt-native-process.json): тот же ответ через `processConcerts` → `artistDb.loadApprovedArtists('data/artists')`, прочитано 63409 записей, 2 raw → 2 valid, нет drops. Это датированное наблюдение, тест не фиксирует состояние живой БД.
- Повторение: `node --import tsx tests/fixtures/ru-data-2-west/replay.mjs /Users/alex/agent-hub/concerts-ru-data-2/evidence/official-west/inputs.json`. Replay фиксирует Date, перехватывает CJS axios, блокирует socket/DNS и требует точный URL. Сам publisher запускает hub до/после на этом же inputs.json; этим исполнителем публикация не выполнялась.
- Первый отдельный контроль запуска использовал ESM axios stub, который не перехватил CJS transport runner; произошёл обычный разрешённый live GET. Его результаты сохранены отдельно как `ddt-live-uncaptured-control-*`, **не являются same-input доказательством**. Исправленный replay проверен с блокировкой сети и единственным зарегистрированным чтением native bytes.

Проверки: `node --import tsx --test tests/ru_official_sources_west.test.ts` — 5/5 PASS; `tsc --noEmit` — PASS; ESLint только новых TS — PASS; `git diff --check` — PASS. Тесты проверяют hash всех native fixtures, config→response→runScraper, чтение snapshot whitelist через настоящий artistDb loader, дедупликацию, подмену page/event/performer, merch/type, отмены/переносы, отсутствие года/страны/места, невозможную дату/время и URL. Live-state snapshot assertions отсутствуют.

## UNSENT — запрос Lotus Arena

**НЕ ОТПРАВЛЕНО.** Адресат: Phuket Music Industry Co., Ltd., `lotusarenapmi@gmail.com` — контакт из §11 оригинального user agreement PDF. Тема: Permission/feed for limited DDT concert metadata reuse.

Hello Lotus Arena team,

I am an independent developer based in Russia building a concert discovery resource for travellers. Your official DDT listings include Phuket on 13 January 2027 and Pattaya on 16 January 2027. Section 5.11 of your User Agreement restricts automated data collection and commercial use without a separate agreement, so no automated source has been enabled.

Could you provide an approved API/feed or written permission for low-frequency GET access to these public event records? We need artist, full date/time, venue, city, country, event/ticket URL and cancellation/rescheduling updates. Please clarify permitted caching/history, publishing factual records in downloadable public JSON for downstream consumers, and editorial reuse in a Russian-language travel/concert Instagram account that may be monetised. Please specify attribution, rate limits, removal/update procedure and whether affiliate participation is required. We are not requesting customer data, checkout access or seat inventory.

Please also clarify the Pattaya event's city: its title/description says Pattaya but JSON-LD addressLocality says Chon Buri.

## UNSENT — запрос Intickets

**НЕ ОТПРАВЛЕНО.** Адресат: команда Intickets; канал поддержки на `https://intickets.ru/` требует проверки hub перед любой отправкой, email не придуман. Тема: Approved metadata/feed for official Basta tour links.

Здравствуйте! Я независимый разработчик из России, собираю справочник концертов для путешественников. Официальный сайт Басты `https://bastatickets.ru/` ссылается, в частности, на `https://iframeab-pre11562.intickets.ru/seance/70394135/` (23.10.2026, Смоленск). Обычный GET страницы возвращает JS challenge, robots — защитный redirect; защиту мы не обходим и источник не подключили.

Подскажите разрешённый API/feed или согласованный способ редкого GET для полей артист, полная дата/время, площадка, город, страна, ticket URL, отмена/перенос. Нужны явные страны, чтобы не угадывать их по городу. Просим уточнить права на кэш/историю, открытый JSON для downstream-потребителей и фактические редакционные упоминания в русскоязычном Instagram о путешествиях с возможной монетизацией; требования к attribution, частоте, удалению/корректировкам и связь доступа с affiliate. Клиентские данные, checkout и остатки мест не нужны. Ноггано/N1NT3ND0 должны оставаться отдельными от Басты артистами.
