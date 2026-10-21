# Версии и проверка совместимости

Проверено 20 октября 2026 года. Пользователь выбрал Hono + Bun, PostgreSQL и отсутствие брокера на старте. Этот документ фиксирует проверенный набор, а [ARCHITECTURE.md](ARCHITECTURE.md) описывает применение инструментов. Исходники probe, команды, manifest и lockfile — в [verification/stack](../verification/stack/README.md).

## Закреплённые npm-версии

Источник точных прямых зависимостей — [package.json](../verification/stack/package.json), транзитивных — [bun.lock](../verification/stack/bun.lock). Таблица — снимок этого manifest; обновление версии требует повторной проверки всего затронутого пути.

| Инструмент | Версия | Назначение |
| --- | --- | --- |
| Hono | 4.13.13 | HTTP API и типизированный клиент `hc` |
| @hono/zod-openapi | 1.6.3 | Явные схемы запросов и OpenAPI |
| Zod | 4.6.7 | Runtime-валидация |
| Better Auth | 1.7.11 | Пароли и серверные сессии |
| Drizzle ORM | 0.45.4 | PostgreSQL через `drizzle-orm/bun-sql` |
| Drizzle Kit | 0.31.11 | SQL-миграции |
| ts-fsrs | 5.4.2 | Расписание повторений |
| Pino | 10.4.0 | JSON-логи в stdout |
| React / React DOM | 19.3.1 | Интерфейс |
| react-router | 8.5.0 | Клиентская маршрутизация |
| @tanstack/react-query | 5.104.5 | Серверные данные в frontend |
| @dnd-kit/react | 0.5.1 | Перетаскивание и sortable из того же пакета |
| Vite | 8.3.4 | Статическая production-сборка |
| @vitejs/plugin-react | 6.1.2 | Интеграция React/Vite |
| TypeScript | 7.0.2 | Явный typecheck через CLI `tsc` |
| @types/bun | 1.4.3 | Типы выбранного runtime |
| @types/react / @types/react-dom | 19.3.0 | Типы frontend |
| @playwright/test | 1.64.1 | Браузерные проверки |

Отдельные прямые `pg`, `postgres` и `@better-auth/drizzle-adapter` не нужны выбранному пути: драйвер входит в Bun, а Better Auth 1.7.11 уже содержит адаптер и реэкспортирует его через `better-auth/adapters/drizzle`. Несвязанные optional integrations не устанавливаются ради удовлетворения всех возможных вариантов ORM.

## Runtime и инфраструктура

Машиночитаемый источник — [toolchain.json](../deployment/toolchain.json).

| Компонент | Выбранная версия | Подтверждение в этом сеансе |
| --- | --- | --- |
| Bun | 1.4.3 | Отдельный официальный бинарник, SHA-512 npm проверен; запуск выполнен |
| PostgreSQL выпуска | 18.6 / `postgres:18.6-bookworm` | Версия и официальный tag проверены; именно этот image локально не запускался |
| Caddy | 2.11.7 / `caddy:2.11.7-alpine` | Release и официальный tag проверены; запуск не выполнялся |
| Docker Engine | 29.9.1 | Официальный stable release; локально отсутствует |
| Compose | 5.6.0 | Официальный stable release; локально отсутствует |
| Node для CI browser tools | 24.22.0 LTS | Официальный индекс; локальный browser probe выполнен на 22.21.1 |
| CI runner | ubuntu-24.04 | Выбранная среда для примера; job не запускался |

Для CI закреплены checkout v7.0.1, setup-node v7.1.0 и setup-bun v2.2.0 с полными commit SHA. [Пример workflow](../verification/stack/ci.example.yaml) — подготовленный файл, а не выполненный workflow. Перед фактическим выпуском образы фиксируются также digest для целевой архитектуры.

## Что выполнено

Среда: macOS / arm64; Bun 1.4.3; настоящий PostgreSQL 18.4 в отдельном временном localhost-кластере; Chrome 145.0.7632.160 через Playwright 1.64.1. PostgreSQL получен как тестовый binary bundle `@embedded-postgres/darwin-arm64@18.4.0-beta.17`, с проверенной SHA-512. Суффикс npm-обёртки не переносится в production: фактический бинарник сообщает PostgreSQL 18.4, выбранный production image — 18.6.

| Проверка | Результат и точный смысл |
| --- | --- |
| Чистая установка | `bun install --frozen-lockfile --ignore-scripts` с isolated linker выполнен в пустой `node_modules` |
| Peer dependencies | Проверены установленные peers прямых зависимостей с учётом резолвинга из самого пакета; нерелевантные optional peers допускаются отсутствующими |
| Typecheck | TypeScript 7.0.2 CLI на Bun; strict, noUncheckedIndexedAccess, noEmit; стандартный skipLibCheck включён |
| Production build | Vite 8.3.4 и plugin-react 6.1.2 действительно выполнены Bun, собран минимальный клиент |
| Hono / Zod / OpenAPI / hc | Неверный вход отклоняется, корректный принимается, OpenAPI содержит маршрут, типизированный клиент вызывает его |
| FSRS | Again и Good дают разные даты, состояние карточки обновляется под Bun |
| Pino | JSON-строка и redaction работают без worker transport |
| HTTP timeout | Ответ после 11 секунд проходит с явно заданным idleTimeout 30 s |
| Graceful stop | Активный HTTP-запрос завершается при остановке приёма новых запросов |
| Миграции | Drizzle Kit исполнился на Bun; SQL fixture применён к настоящему PostgreSQL |
| Транзакции | Rollback сохраняет прежнюю ревизию; два конкурентных условных обновления дают одного победителя |
| Better Auth | Signup, sign-in, cookie session через Hono и отказ неверному паролю работают с Bun.SQL / Drizzle |
| Браузер | React, Router, Query и DnD монтируются; фокус и ruby видны на 1280×800 и 390×844; ошибок JavaScript нет |

Unit/HTTP/DB-набор содержит восемь проверок. Браузерный smoke-test проверяет совместное монтирование и базовое взаимодействие, а не завершённый конструктор предложений, полноценное перетаскивание или все требования доступности.

## Обнаруженные ограничения

- **Hoisting.** Первоначальная плоская установка открывала Vite необязательный esbuild 0.25.12 из инструментов миграций, за пределами peer range Vite. Isolated linker устранил видимость несовместимой зависимости; новый frozen install и проверка прошли. В проект переносится [bunfig.toml](../verification/stack/bunfig.toml).
- **Drizzle stable.** Предыдущее исследование заметило `@rc` в текущем guide, но exact metadata и исходники Drizzle 0.45.4 уже содержат `bun-sql`. Стабильная связка теперь подтверждена исполнением; переход на RC не требуется.
- **Bun docs и целевой release.** Флаг `bun check --no-script` из просмотренной документации не поддержан выбранным бинарником. Проверка типов закреплена через TypeScript 7.0.2 CLI, фактически запущенный на Bun.
- **Router.** 8.5.0 объявляет Node ≥ 22.22 и React ≥ 19.2.7. Его browser-only путь собран на Bun и открыт в Chrome; Node для CI выбран 24.22.0. Локальный Node 22.21.1 использовался только для Playwright и не исполнял Router server code.
- **DnD.** Выбран современный `@dnd-kit/react`, а не Legacy core/sortable; версия 0.5.1 закреплена точно. Контракт перемещения, фокус и сенсоры конструктора нужно проверить на реализованном интерфейсе.

## Что остаётся до выпуска

Linux image с PostgreSQL 18.6, образ Caddy, Compose и пример CI не исполнялись. На VPS не измерены память, CPU, задержки и сохранность данных при обновлении. Не проверены прикладные приглашения/reset, полный алгоритм идемпотентного review, весь корпус, реальные ИИ-запросы, лимиты провайдера и restore. Локальные результаты подтверждают совместимость библиотек для проверенных операций, а не готовность приложения или достаточность 2 GB RAM.
