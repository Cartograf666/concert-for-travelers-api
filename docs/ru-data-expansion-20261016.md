# Расширение RU concert data — 16.10.2026

Статус: реализация в изолированной локальной ветке; проверка результата ещё не завершена.

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
Это состояние будет повторно проверено перед передачей результата.

Следующий шаг: завершить независимые пакеты, интегрировать только их коммиты,
измерить корректный прирост public JSON и выполнить проверки итоговой ветки.
Срез не публикуется. Следующая граница — ревью дифа и проверок Claude;
решения об отправке запросов и production принадлежат Alex.
