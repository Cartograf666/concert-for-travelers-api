# Расширение RU concert data — 16.10.2026

Статус: локальная реализация и проверки завершены; готово к ревью Claude.
Production не менялся; решения о push/deploy и отправке запросов принадлежат Alex.

Цель Alex: больше корректных событий после нормализации, whitelist и дедупликации
для РФ и направлений TR RU TH RS ID AE AM CN KZ VN GE EG CY BY UZ ME. Основа:
`6af49b13628cd0eeb728f16d62bdaaa17a94e069`; интеграционная ветка
`agent/concerts-ru-data-20261016`. Свежий upstream в срез не интегрируется.

Координация: Delamain `concerts-ru-data`, shared home `/Users/alex/agent-hub`.
Поручение и ownership: `/Users/alex/agent-hub/concerts-ru-data/owner-brief.md`.
Решения: [реестр стадии](/Users/alex/agent-hub/concerts-ru-data/questions.md).
Существующие artistDb, runner, processConcerts и publishConcerts переиспользуются;
новые custom adapters допустимы только при доказанном ограничении конфигов.

Работу выполняют отдельные Codex GPT-6.1 Sol worktree:

- `ru-identities` (high): approved identities через artistDb API, aliases, targets,
  адресные регрессии и источники идентичности.
- `regional-sources` (high): фактический выход TH/RU/GE/VN/ID, Ticketmaster TR/AE,
  причина отсутствия Би-2, исправления разрешённых источников и сохранённые входы.
- `source-access` (medium): первичные условия/robots, каналы связи, неотправленные
  запросы доступа и справочная заметка для редакционного решения Alex.
- `published-measurement` (high): свежий live baseline, SHA-256, неизменяемые входы
  и воспроизводимое сравнение публикации с базой на одном времени.

Защищены BACKLOG, основной checkout, старые worktree и оба sibling-приложения.
Запрещены push/PR/main merge/dispatch/deploy/Pages и отправка запросов/форм,
регистрация/новые ключи, изменение лимитов/интервалов и обход доступа.

Исходно проверено: main `6af49b1`, ahead/behind `35/40`; единственное изменение
основного checkout — `M BACKLOG.md`, SHA-256
`6c0148ca2539452463d6809aefe557ad4b69f58cd1cd06e03636462759155c5d`.
Повторная проверка перед передачей подтвердила побайтное совпадение BACKLOG и main;
evidence/main-preservation.json фиксирует фактический результат.

Итог: approved DB 63 390→63 397 (11 новых/7 исправленных/4 объединённых дубля),
63 379 остальных записей сохранены. Explicit targets 2431→2441; бюджеты/cadence
не менялись. Исправлены Браво, ложный год Винтажа, проверка empty Cafe del Mar;
удалён source, ошибочно приписывавший 24 концерта группы сольному Жене Трофимову.
Все 24 native строки группы сохранены целиком и реальный active-cache consumer
исключает retired source. Добавлены частичный Би-2 и ограниченный Tomsarkgh AM.

Финальный same-input runner→process→dedup→publisher: 108 raw/52 public →
89 raw/35 public; 0 network/missing captures. Восемь новых native occurrences,
из них семь с датой после 16 октября. В корзине 16 стран новое событие одно:
Andru Donalds, Yerevan, 21.11.2026. Семь дат Би-2 вне корзины; Varna 16.10
не названа будущим началом. Два исправления места Браво не считаются новыми
концертами; исключены 24 wrong-solo и одна phantom-year строка.
В корзине local cohort 52→28, окно 14–90 28→16; это не полный production API.
Live baseline отдельно: 49 651 строка, lastRun 2026-10-16T09:12:22.120Z,
корзина 853/533/345. Прибавлять cohort delta к live запрещено методикой.

Проверенная code/config/DB/fixture ревизия `45e9dd69a1622891ff7a33909046dfc9332403b0`:
npm test 888 total /887 pass /0 fail /1 expected skip; отдельный SSRF 1/1 pass;
tsc --noEmit, build, lint pass (0 errors/103 прежних warnings), selector 125≤131,
artist-integrity 156≤156; full delta whitespace check pass. Единственный исходный
Antoha red-test исправлен фиксацией исторического clock без ослабления guard.
Исходные HTML captures неизменны; четыре тестовые копии форматированы с отдельным
original→normalized SHA-мостом в tests/fixtures/ru-data-20261016-formatting.json.
Последующие коммиты только отчётные, эти проверки не инвалидируют.

Факты, первичные источники и ограничения:
[identities](ru-artist-identities-20261016.md),
[каждый источник и Би-2](ru-source-diagnosis-20261016.md),
[условия и редакционная проверка](ru-source-terms-20261016.md),
[Tomsarkgh](ru-tomsarkgh-pilot-20261016.md),
[финальные таблицы/события/replay](ru-data-measurement-20261016.md).
Внешний итоговый отчёт:
`/Users/alex/agent-hub/claude-delegation-20261016/concerts-ru-data-report.md`;
25 неотправленных запросов: concerts-ru-access-requests.md там же.
Evidence: `/Users/alex/agent-hub/concerts-ru-data/evidence/`, включая final-checks,
root-correctness-check.json, main-preservation.json и measurement/final-integrated-replay.

Открыты: native UOB timeout, Ticketmaster key/TR/AE и BIT per-target production
проверка; b2 main reset и package-only Белград/Лимасол (не выданы за концерты);
неподтверждённые годы/performers архивных источников; downstream JSON/Instagram
права; актуальный реестр Минюста недоступен, шесть исторических записей не названы
текущим статусом. Массового роста RU/TR/AE/TH и полного покрытия не заявлено.
BACKLOG/main повторно проверены byte-exact к началу; sibling/старые worktree
не менялись. Все worker packages закончены, серверов/ожиданий не оставлено.

Следующий шаг — Claude review этой ветки и evidence. Alex отдельно решает
production и отправку подготовленных запросов; текущий срез на этой границе завершён.
