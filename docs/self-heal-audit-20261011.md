# Self-heal: семантика и надёжность CI — 2026-10-11

## Результат и границы

Локально исправлены четыре воспроизведённые проблемы: отсутствие native raw→public
проверки ремонта, чтение venue baseline для artist cohort, несовместимость
предварительного selector-теста с `artistNameFallback`, fail-open PR integrity gate
при ошибке GitHub API или SIGPIPE. Исторический CI failure оказался внешним
approval expiry; он не подтверждает поломку кода или тестов.

Работа выполнена в `agent/concert-heal-ci-20261011`, база
`9624768a1b0871afec341ac20514fb6b98cb14c5`. Коммиты реализации:

- `2fd6269115ef878b444b9d0490531b3328ec4a50`: healing, baselines, fallback, связанные тесты.
- `9fe36168dbe4c7b2b8917176af9a21a45a4f3c1a`: PR file-list gate и regression-тесты реального shell step.

Переиспользованы `runScraper`, `processConcerts`, processing diagnostics, существующие
manifest/hash/cohort/replay gates. Новых зависимостей, моделей, paid/LLM-запусков,
provider collections, изменений configs/custom modules/DB/global pipeline нет.
Только локальные коммиты; push, PR changes, merge, deploy, dispatch и account/auth
changes не выполнялись. Все тестовые HTTP-серверы закрываются в `finally`/`t.after`.

## Точная причина исторического CI failure

[PR Verification run 38046780356](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/38046780356),
SHA `73d5d0105dc169f2c4b48e49a52fc388bbea6874`, branch
`auto/self-heal-38045557896`, attempt 1: created `2026-10-10T10:58:52Z`,
updated `2026-10-10T10:58:53Z`. API вернул `jobs=[]`, `check_runs=[]`, artifacts 0;
`gh run view --log` — `log not found`.

Открытая GitHub run page содержит **1 error**, с точной annotation:

> This workflow run required approval but was not approved before it expired.

Следовательно, этот run не исполнял build/lint/tests. Причина — не полученное
вовремя требуемое одобрение, а не ошибка unit suite, scraper или actionlint.
API отсутствие jobs само по себе этого не доказывало; основание — annotation
на самой run page, прочитанная обычным HTTPS GET. Workflow на историческом SHA
прочитан через contents API; локального commit object нет, fetch не выполнялся.
Причина, **почему именно** GitHub потребовал approval, в доступных данных не
раскрыта; account policy не менялась, одобрение/повторный CI не запускались.

Поддерживающий `concurrency.queue` action уже закреплён в `lint-workflows.yml`:
`reviewdog/action-actionlint@1758727be30241166609dad4c97588b6ad411f32` (`v1.79.1`,
maintained kjanat fork). Локальный Homebrew actionlint `1.7.12` всё ещё выдаёт
`unexpected key "queue"` на неизменённом self-heal workflow. Это ограничение
локального старого checker, не повторное доказательство repo/CI defect.
`pr-test.yml` проходит этот actionlint; оба workflow проходят YAML parse.

[PR 236](https://github.com/Cartograf666/concert-for-travelers-api/pull/236)
при однократной read-only проверке: OPEN, SHA
`a059c9b517dcc2fca24c5362735a9b2cbb9661db`, branch
`auto/self-heal-37769867198`, check rollup пустой. Diff — **только**
`data/repair-history.json`, +57/-0; конфигов в нём нет. Этот PR не является
доказательством внедрения или semantic verification нового scraper repair.
PR не изменён.

## Воспроизведение и исправления

### Native public gate

До изменения `verifyConfigLive` проверял только raw plausibility: наличие
событий, даты, имена, place/code bounds, raw volume. `verifyEvents` остаётся
чистым plausibility-тестом; окончательное решение теперь принимает live gate
после вызова штатного `processConcerts` с текущим artist catalogue и тем же
date anchor. Требуется хотя бы одно public событие. В report добавлен
`publicEventCount`, причина отказа содержит реальные processing drop counters.

| Replay/input | Старый raw gate | Native public output | Новый live gate |
| --- | --- | --- | --- |
| Сохранённые Nitsch raw rows, captured 2026-10-06T21:26:20.449Z | PASS, 3 raw | 0, `notApproved=3` по existing source quarantine | FAIL |
| 10 правдоподобных строк без city | PASS | 0, `incomplete=10` | FAIL |
| 10 строк с неутверждённым артистом | PASS | 0, `notApproved=10` | FAIL |
| Только вчерашние ISO dates у полуночного anchor | PASS из-за 24h raw cutoff | 0, `pastDate=10` | FAIL |
| 10 строк с невалидным scrapedAt | PASS | 0, `zodFail=10` | FAIL |
| 10 raw дублей одной identity при 10 public baseline identities | PASS по raw count | 1 | FAIL по public retention |
| Существующая Andrea Motis HTML fixture через настоящий runner | PASS, 7 raw | 6; unknown-country row остаётся incomplete | PASS, 6 public |

Nitsch replay использует `tests/fixtures/nitsch-source-provenance.json` и
реальную MBID identity; не вводит новую source quarantine. Andrea replay
использует текущий custom extractor и существующую fixture с отрицательными
строками через локальный HTTP server. Это проверка native extraction→normalization
на сохранённых данных, не новый live provider scrape или deployment.

Public baseline нормализуется на том же anchor/catalogue. Применяется существующий
порог удержания 30% (`floor`, минимум 1), но к **public deduplicated count**,
дополнительно к прежнему raw-count gate. Старые даты/неутверждённые строки в
baseline не создают public retention floor. Если baseline нет, public nonzero
gate всё равно обязателен; отсутствие каталога также не может дать PASS.

### Правильный cohort baseline

В исходном `heal.ts` всегда читался `reports/scrape-cache.json`, хотя artist
artifact содержит `artist-scrape-cache.json`. Поэтому artist repair не получал
свой baseline; при coincident id мог использовать venue данные. Теперь loader
выбирает **только** cache своего manifest cohort, возвращая и rows, и их count.
Тесты проверяют разные данные под одинаковым id и отсутствие artist cache при
наличии venue cache. Другой cohort не считается запасным источником baseline.
JSON `null` cache также означает отсутствие baseline и не прерывает healing pass;
это сохраняет прежнее поведение best-effort baseline reader.

### Artist fallback в предварительном repair probe

Настоящий static runner поддерживает `artistNameFallback` на tour pages без
имени в каждой строке. `testSelectorsOnHtml` его не использовал: valid repair
получал `extracted 0 events` до live verification. Regression воспроизведён
инъецированным локальным generator на существующем preservation-тесте после
удаления per-row artist span. Теперь local probe использует тот же artist
fallback. Защищённые selectors/fallback values продолжают переноситься из
оригинального config; live public gate остаётся обязательным.

### Fail-closed PR file-list gate

В `pr-test.yml` команда `gh api ... | grep -q` стояла внутри `if`. Даже с
`set -euo pipefail` API failure попадал в `else`, записывал `touched=false`,
успешно завершал step и отключал artist integrity gate. Большой file list с
ранним artist match мог аналогично получить SIGPIPE от раннего выхода grep.

Теперь весь `gh api --paginate` выполняется в отдельном assignment; ошибка
прерывает step. Только после успешного получения полного списка выполняется
grep по here-string. Offline тесты выполняют **реальный workflow shell step** с
локальным `gh` fixture: API error, большой stdout (20 000 строк), обычный PR без
artist-data изменений. До изменения первые два сценария воспроизводили
ложный skip; после изменения все три проходят. Не ослаблены ratchet, fork
условие, permissions, concurrency или timeout.

## Pending и availability: это не внедрённые подтверждённые repairs

Пинованный source snapshot `data/repair-history.json` содержит **1014** records:
confirmed 30, rejected 959, pending 23, superseded 2. Предоставленный published
snapshot содержит **1006**: 30/951/23/2. Разница — восемь rejected records,
а не изменение числа подтверждённых repairs. Накопительные statuses не являются
оценкой качества модели.

Проверка source snapshot на `2026-10-11T05:52:34.418553Z`:

- Pending 23: venue 13, artist 8, legacy без cohort/path/hash 2.
- Возраст min/median/max: **2.76 / 4.62 / 29.88 дней**; 8 старше 7 дней и те же 8 старше 14 дней.
- 10 records имеют текущие exact config bytes/hash, 11 имеют изменённый hash;
  2 legacy не допускают безопасной hash/cohort confirmation. Все 23 configs ещё существуют.
- У всех 23 отсутствует `lastProcessedRun`; историю этот аудит не менял.

| Exact hash сейчас | Changed hash сейчас | Legacy |
| --- | --- | --- |
| akbank-sanat-istanbul; meetfactory-prague; artist-philippine-philharmonic-orchestra; artist-hermann-nitsch; artist-10cc; artist-giora-feidman; yugong-yishan-beijing; roundhouse-london; botanique-brussels; artist-andrea-motis | artist-patricia-barber; armenian-national-opera-yerevan; asiaworld-expo-hong-kong; babylon-istanbul; osaka-jo-hall-osaka; artist-partenaire-particulier; progresja-warsaw; majestic-music-club-bratislava; artist-alabama-symphony-orchestra; artist-ai-kawashima; artist-iron-maidens-the | artist-abdee-negara; artist-stanley-clarke |

Главное operational ограничение: `prune-dead-scrapers.yml` запускает confirmation
с **`REPAIR_ROLLBACK_DRY_RUN=1`**. Dry-run сохраняет statuses, failure counters и
replay state; это намеренный migration safeguard, а не работающая автоматическая
confirmation/rollback. Он оставлен без изменений. Self-heal PR body обещает
автоматический rollback, однако текущий workflow фактически его не исполняет.

Текущее `data/scraper-health.json` — 143 legacy records без cohort, все с
`lastFailedAt=2026-09-11T08:45:21.129Z`, `lastReason=fetch_error`. Это устаревший
tracking snapshot, не доказательство сегодняшних streaks/availability. Exact
post-repair manifests для всех 23 records этот snapshot не предоставляет;
pending age не доказывает ни работу, ни текущую неработоспособность сайта.

## Сохранённые guards и пределы

- Healing требует complete same-cohort manifest, matching fail-log/run identity
  и exact failed config hash; stale config evidence пропускается без записи нового config.
- Live probe вызывает `runScraper` **без cache argument**; условный 304 не может
  проверить старый output вместо candidate. Native негативная проверка unsolicited
  304 отклоняется, malformed JSON API response отклоняется, valid empty schedule
  не становится принятым repair. Нормальная empty-schedule политика runner сохранена.
- Confirmation требует явный outcome exact id/path/hash, более новый complete
  run и replay guard. Отсутствие outcome/другой hash/cohort не является success.
  Modified/deleted config не перезаписывается rollback. Эти existing tests проходят.
- Cache fingerprint/config/custom-module и official raw-object provenance guards,
  source identity exclusions, строгая schema, SSRF policy, provider timeouts,
  budgets и limits не изменены; связанные native negative tests проходят.
- Public normalization доказывает совместимость с текущим pipeline, но не может
  сама обнаружить произвольную неверную дату/place/approved artist, если ошибочные
  значения выглядят валидными и не имеют проверенной source-specific quarantine.
  Для этого требуется доказательство от первоисточника. Identity substitution
  между двумя утверждёнными артистами не объявляется решённой общим count gate.
- Runtime Gemini auth/quota/catalogue и remote CI-after-change не проверялись:
  paid/model calls, account changes, push/dispatch запрещены. CI approval expiry,
  Eventbrite/WAF и unsupported external access нельзя исправить селекторами.

## Проверки

Рабочая директория: `.worktrees/agent/concert-heal-ci-20261011`. `npm ci` completed,
261 packages, audit 0 vulnerabilities; dependency manifests не менялись.

| Проверка | Фактический результат |
| --- | --- |
| `SCRAPER_ALLOW_LOCAL_HOSTS=1 node --import tsx --test tests/healing_verify.test.ts tests/healing_semantic.test.ts tests/healing_baseline.test.ts tests/confirm_repairs.test.ts tests/healing_chain.test.ts tests/healing_classify.test.ts tests/healing_strategies.test.ts tests/healing.test.ts` | PASS 77/77 |
| `node --import tsx --test tests/healing_pr_workflow.test.ts` | PASS 3/3 |
| `SCRAPER_ALLOW_LOCAL_HOSTS=1 node --import tsx --test tests/run_manifest.test.ts tests/cache_fingerprint.test.ts tests/empty_http_response.test.ts tests/custom_json_response.test.ts tests/empty_schedule_contract.test.ts tests/source_access_challenge.test.ts tests/official_artist_priority.test.ts tests/nitsch_source_provenance.test.ts tests/artist_andrea_motis.test.ts` | PASS 26/26 |
| `npm run test:ssrf-policy` без localhost escape hatch | PASS 1/1 |
| `npm run build` | PASS |
| `npx eslint src/heal.ts src/healing/ tests/healing*.test.ts tests/confirm_repairs.test.ts` | PASS, 0 errors; 15 existing/type-import warnings |
| `actionlint .github/workflows/pr-test.yml` | PASS |
| PyYAML safe-load обоих workflow | PASS syntax parse |
| Homebrew actionlint 1.7.12 на self-heal | UNSUPPORTED `concurrency.queue`; maintained repo action уже pinned |
| `git diff --check` | PASS |
| Полный integrated suite и consequential review | Hub-owned следующий этап; здесь не объявлены пройденными |

Сохранённые test/lint logs находятся в
`/Users/alex/agent-hub/concert-data-quality/coordinator/work/heal-ci-reliability-{targeted,pr-gate,boundaries,eslint}.log`.
Полный handoff с финальным commit SHA:
`/Users/alex/agent-hub/concert-data-quality/coordinator/work/heal-ci-reliability-REPORT.md`.
Hub должен интегрировать локальные commits и выполнить свои combined gates;
external approval/migration/production boundaries сохраняются.
