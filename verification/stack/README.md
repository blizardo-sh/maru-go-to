# Воспроизводимая проверка стека

Это отдельный compatibility-пакет, не код учебного приложения. [Отчёт](../../docs/STACK-COMPATIBILITY.md) различает выполненные проверки и оставшиеся. Прямые версии закреплены в `package.json`, транзитивные — в `bun.lock`, режим установки — в `bunfig.toml`.

## Запуск без БД

Из этой папки, с Bun 1.4.3:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run migrations
bun run build
bun test --timeout 20000
```

Без `STACK_PROBE_DATABASE_URL` две DB-проверки пропускаются. Такой результат не считается полным подтверждением совместимости с PostgreSQL. SQL в `generated/` — fixture проверок, он не заменяет миграции будущего приложения.

## Полная проверка с PostgreSQL 18.6

Нужны работающие Docker Engine/Compose. В отдельной оболочке этой папки задать случайный одноразовый пароль; сохранить его до завершения проверки:

```sh
export STACK_PROBE_DB_PASSWORD="$(openssl rand -hex 24)"
export STACK_PROBE_DATABASE_URL="postgres://stack_probe:${STACK_PROBE_DB_PASSWORD}@127.0.0.1:55436/stack_compat"
docker compose -p japanese-stack-compat up -d --wait
bun run migrations
bun test --timeout 20000
docker compose -p japanese-stack-compat down
```

Compose-файл создаёт только одноразовую localhost-БД, данные которой находятся в tmpfs. Тесты принимают только localhost и имя `stack_compat`. На production-БД их не запускают. Даже при сбое проверки остановить именно этот Compose project. В текущем сеансе Docker отсутствовал: выполнен тест с отдельно запущенным PostgreSQL 18.4, а не этот сценарий 18.6.

## Браузер

Собрать frontend, затем использовать установленный Google Chrome:

```sh
bun run build
bun run browser
```

Для browser tooling CI выбран Node 24.22.0 и Chromium из Playwright 1.64.1:

```sh
node node_modules/@playwright/test/cli.js install --with-deps chromium
STACK_PROBE_BROWSER=chromium bun run browser
```

Probe запускает отдельный headless-профиль и локальный HTTP-сервер, проверяет два размера экрана, затем закрывает их. Он не подключается к пользовательскому браузерному профилю. Локальный запуск выполнен на Node 22.21.1 и установленном Chrome; CI-пример ещё не исполнялся.

## Для реализующего агента

Перенести выбранные версии, isolated linker и lockfile в реальную структуру проекта осознанно. Dependency tree пакета проверки объединяет frontend/backend ради проверки, а приложение можно организовать Bun workspace. После разделения пакетов обновить lockfile и повторить затронутые проверки. Сохранять полный `node_modules/.bun` при доставке готового образа или устанавливать зависимости из lockfile внутри Linux build stage.

После готовности репозитория перенести [ci.example.yaml](ci.example.yaml) в `.github/workflows/`, сохранив пути и версии. GitHub Actions в текущем сеансе не создавался и не запускался.
