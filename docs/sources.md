# Реестр источников

Проверено 20 октября 2026 года. Источники содержат факты для проектирования; они не заменяют согласование требований.

## Закреплённый стек и фактическая совместимость

Hono + Bun, PostgreSQL и отсутствие брокера приняты пользователем. [Матрица](STACK-COMPATIBILITY.md) фиксирует выполненные локальные проверки, а [manifest](../verification/stack/package.json), [lockfile](../verification/stack/bun.lock) и [toolchain](../deployment/toolchain.json) — версии. Старые разделы ниже сохраняют источники рассмотренных альтернатив, а не действующий выбор Next.js/SQLite.

- [Bun 1.4.3 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3) — stable runtime; локально фактически использован отдельный официальный бинарник без изменения системной установки.
- [Официальный npm binary](https://registry.npmjs.org/@oven%2Fbun-darwin-aarch64/1.4.3) — источник загруженного Bun, SHA-512 проверен перед исполнением.
- [Hono 4.13.13](https://registry.npmjs.org/hono/4.13.13), [Zod OpenAPI 1.6.3](https://registry.npmjs.org/@hono%2Fzod-openapi/1.6.3), [Zod 4.6.7](https://registry.npmjs.org/zod/4.6.7) — точные metadata, engines и peers.
- [Better Auth 1.7.11](https://registry.npmjs.org/better-auth/1.7.11) — stable dependency tree; [stable re-export](https://github.com/better-auth/better-auth/blob/v1.7.11/packages/better-auth/src/adapters/drizzle-adapter/index.ts) позволяет использовать уже входящий Drizzle adapter.
- [Drizzle ORM 0.45.4](https://registry.npmjs.org/drizzle-orm/0.45.4), [Kit 0.31.11](https://registry.npmjs.org/drizzle-kit/0.31.11), [stable Bun SQL driver](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/bun-sql/driver.ts) и [session](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/bun-sql/session.ts) — `bun-sql`, begin/savepoint существуют в стабильной версии.
- [React Router 8.5.0](https://registry.npmjs.org/react-router/8.5.0) — Node/React peer requirements; [declarative guide](https://reactrouter.com/start/declarative/installation) — browser-only режим.
- [DnD quickstart](https://dndkit.com/react/quickstart/), [sortable](https://dndkit.com/react/hooks/use-sortable/) и [sensors](https://dndkit.com/react/guides/sensors/) — современный пакет `@dnd-kit/react`, без Legacy core/sortable.
- [Bun/Vite](https://bun.com/guides/ecosystem/vite) — реальный runtime выбирается флагом `--bun`; обычный вызов CLI может соблюдать Node shebang.
- [PostgreSQL versioning](https://www.postgresql.org/support/versioning/), [официальные tags](https://raw.githubusercontent.com/docker-library/official-images/master/library/postgres), [PGDATA для 18](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata) — выбран PostgreSQL 18.6 и volume root `/var/lib/postgresql`.
- [Тестовый binary bundle](https://registry.npmjs.org/@embedded-postgres%2Fdarwin-arm64/18.4.0-beta.17) — источник отдельно запущенного PostgreSQL 18.4 для локальных проверок, не production-зависимость.
- [Caddy 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), [официальные tags](https://raw.githubusercontent.com/docker-library/official-images/master/library/caddy), [Docker Engine 29.9.1](https://github.com/moby/moby/releases/tag/docker-v29.9.1), [Compose 5.6.0](https://github.com/docker/compose/releases/tag/v5.6.0) — stable release metadata; эти инструменты не запускались локально.
- [Bun image 1.4.3-slim](https://hub.docker.com/v2/repositories/oven/bun/tags/1.4.3-slim) — tag и linux amd64/arm64 опубликованы; image не запускался.
- [Node official index](https://nodejs.org/dist/index.json) — CI browser tooling 24.22.0 LTS; [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), [setup-bun v2.2.0](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0) — action tags разрешены в полные commit SHA для примера CI.

## Проверка вариантов архитектуры

Проверено 20 октября 2026 года через официальную документацию; нагрузка и интеграция библиотек не проверялись. Выборы и их статус — в [пересмотре архитектуры](ARCHITECTURE-REVIEW.md).

- [Vite](https://vite.dev/guide/) — TS-шаблоны React/Vue и production-сборка статических ресурсов.
- [React: приложение с нуля](https://react.dev/learn/build-a-react-app-from-scratch) — клиентская SPA, самостоятельный выбор routing/data fetching и последствия такого выбора.
- [Vue 3](https://vuejs.org/guide/introduction.html) — реактивность, SFC и Composition API для полноценных приложений.
- [NestJS](https://docs.nestjs.com/) — архитектурный framework над Express или Fastify; Express используется по умолчанию.
- [NestJS Fastify](https://docs.nestjs.com/techniques/performance) — адаптер и ограничения совместимости middleware; upstream benchmarks не измеряют наше приложение.
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction) — официальный модуль описания HTTP-контракта; описание не заменяет runtime-проверки.
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing) — средства изолированного и end-to-end тестирования, взаимодействие с разными test runners.
- [Fastify](https://fastify.dev/) — HTTP-framework, инкапсуляция plugins/hooks и JSON Schema validation/serialization.
- [Django overview](https://docs.djangoproject.com/en/5.2/intro/overview/) — ORM, миграции и административный интерфейс; [auth](https://docs.djangoproject.com/en/5.2/topics/auth/) — пользователи и cookie-сессии. Приглашения и проверка владельца остаются задачами приложения.
- [Django supported versions](https://www.djangoproject.com/download/) — 5.2 LTS поддерживается до апреля 2028 года; это проверенная альтернатива, не выбранный framework проекта.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — Read Committed по умолчанию, блокировки и повторы при serialization failure.
- [SQLite isolation](https://www.sqlite.org/isolation.html) — настоящие транзакции, один writer, snapshot и WAL, `SQLITE_BUSY_SNAPSHOT`.
- [Docker Compose в production](https://docs.docker.com/compose/how-tos/production/) — односерверное размещение и отдельная production-конфигурация.
- [Caddy HTTPS](https://caddyserver.com/docs/automatic-https) — автоматическое получение и обновление TLS при выполнении требований DNS/портов и постоянного хранилища.
- [GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions) — workflow для CI/CD; проверки и сборка артефакта не требуют исполнения на целевом VPS.
- [Playwright](https://playwright.dev/docs/intro) — браузерные проверки; документация не означает, что интерфейс проекта уже проверен.

## Hono, Bun и фоновые задачи

Проверено 20 октября 2026 года. План интеграции и выводы отделены от проведённых измерений в [RUNTIME-AND-JOBS.md](RUNTIME-AND-JOBS.md).

- [Hono Node.js](https://hono.dev/docs/getting-started/nodejs) — Node HTTP-адаптер и graceful shutdown; выбор Hono не требует Bun.
- [Hono RPC](https://hono.dev/docs/guides/rpc) — вывод типов, `strict`, обработка глобальных ошибок; типизация не является runtime-валидацией внешних ответов.
- [Hono Zod OpenAPI](https://hono.dev/examples/zod-openapi) — отдельное расширение и явные схемы.
- [Bun HTTP server](https://bun.com/docs/runtime/http/server) — Fetch/streaming, default idle timeout 10 секунд, индивидуальные таймауты и остановка сервера.
- [Bun Node compatibility](https://bun.com/docs/runtime/nodejs-compat) — документированные отличия Node API; совместимость конкретного приложения не измерена.
- [Bun type checking](https://bun.com/docs/runtime/check) — текущие `bun check` и `--check`, особенности относительно установленного TypeScript; версия инструмента должна быть закреплена.
- [Better Auth Hono](https://better-auth.com/docs/integrations/hono) — Web Request/Response-интеграция и сессии; [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) — provider `pg`.
- [Drizzle Bun SQL](https://orm.drizzle.team/docs/connect-bun-sql) и [PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) — пути подключения; просмотренные инструкции предлагают `@rc`, их нельзя считать закреплённым стабильным набором.
- [Node.js releases](https://nodejs.org/en/about/previous-releases) — политика LTS и статус Node 24 на дату проверки.
- [Elysia overview](https://elysiajs.com/at-glance) — схемы, OpenAPI, Eden и поддерживаемые платформы. Таблица HTTP-скорости ссылается на старые условия измерения и не сравнивает наш проект.
- [Graphile Worker](https://worker.graphile.org/docs) — Node.js-обработчики, PostgreSQL и at-least-once; [SQL add_job](https://worker.graphile.org/docs/sql-add-job) — постановка задания в транзакции.
- [BullMQ production](https://docs.bullmq.io/guide/going-to-production) — persistence/AOF, `noeviction`, соединения и завершение workers; [семантика](https://docs.bullmq.io/) допускает повторное выполнение.
- [RabbitMQ reliability](https://www.rabbitmq.com/docs/reliability) — durable/persistent-настройки, подтверждения и повторная доставка.
- [NATS JetStream](https://docs.nats.io/concepts/jetstream) — хранение, consumers и повторная доставка; свойства Core NATS отличаются.
- [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) — первичное описание паттерна согласования изменения БД и доставки внешнего сообщения.

## Размещение

### GitHub Pages

- [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) — официальное описание размещения статических HTML, CSS и JavaScript.
- [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) — официальная инструкция: публикация статических файлов и отсутствие поддержки серверных языков непосредственно в Pages.

Вывод для проекта: если понадобится собственная серверная обработка или серверное хранение общего прогресса, её нужно размещать отдельно от GitHub Pages либо выбирать персональный сервер. Это архитектурное следствие проверенных ограничений, а не принятое решение.

## Учебный материал

### Совпадение с текущей учебной задачей

[Официальный каталог серии](https://marugoto.jpf.go.jp/en/about/series/) описывает Marugoto Starter (A1): Katsudoo, ISBN 978-4-384-05752-2, и парный Rikai, ISBN 978-4-384-05753-9. Katsudoo посвящён коммуникативным заданиям; Rikai — систематическому изучению языковых средств. Темы у книг совпадают.

[Оглавление Katsudoo, первая страница PDF](https://marugoto.jpf.go.jp/en/assets/docs/about/starter_activities_contents_en.pdf) подтверждает: урок 4 «かぞくは 3にんです» относится к теме 2 «Myself / わたし»; Can-do 7 — кратко рассказать о семье, Can-do 8 — рассказать о семье по фотографии. Тема начинается на странице 31 учебника.

[Методические рекомендации Katsudoo](https://marugoto.jpf.go.jp/assets/docs/teacher/resource/starter_a/starter_activities_teachers_notes_EN.pdf) уточняют материал урока: члены семьи, счёт людей, возраст, место проживания. В рекомендациях для урока упомянуты семейное дерево на странице 36 учебника и обсуждение фотографии на странице 37.

[Оглавление Rikai, первая страница PDF](https://marugoto.jpf.go.jp/en/assets/docs/about/starter_competences_contents_en.pdf) содержит урок 4 с тем же названием; среди языковых опор — перечисление членов семьи через と, место проживания через に и принадлежность через の. Тема 2 начинается на странице 35 учебника.

Вывод: запись пользователя соответствует Starter A1 Katsudoo. Конкретный тираж и наличие Rikai у пользователя не установлены. После проверки источников включение материала Katsudoo и Rikai согласовано пользователем в Q8.

### Индексы официальных материалов

- [Starter A1 Katsudoo](https://marugoto.jpf.go.jp/en/download/starter_a/).
- [Starter A1 Rikai](https://marugoto.jpf.go.jp/en/download/starter_c/).

Индексы охватывают 18 уроков / 9 тем. В них опубликованы следующие ссылки; содержание каждого PDF отдельно ещё не извлекалось:

| Материал | Официальный источник |
| --- | --- |
| Общий русский словарь | [Wordbook RU](https://marugoto.jpf.go.jp/assets/docs/download/starter_a/MarugotoStarterWordbook_RU.pdf) |
| Русский список коммуникативных целей | [Can-do Check RU](https://marugoto.jpf.go.jp/assets/docs/download/starter_a/MarugotoStarterActivitiesCan-doCheck_RU.pdf) |
| Лексика Katsudoo по порядку появления | [Vocabulary Index RU](https://marugoto.jpf.go.jp/assets/docs/download/starter_a/MarugotoStarterActivitiesVocabularyIndex2_RU.pdf) |
| Лексика Rikai по порядку появления | [Vocabulary Index RU](https://marugoto.jpf.go.jp/assets/docs/download/starter_c/MarugotoStarterCompetencesVocabularyIndex2_RU.pdf) |
| Выражения Katsudoo | [Phrase Index](https://marugoto.jpf.go.jp/assets/docs/download/starter_a/MarugotoStarterActivitiesPhraseIndex.pdf) |
| Выражения Rikai | [Phrase Index](https://marugoto.jpf.go.jp/assets/docs/download/starter_c/MarugotoStarterCompetencesPhraseIndex.pdf) |

Отдельный русский справочник грамматических объяснений в просмотренных индексах не найден. Для будущего корпуса необходимо отдельно отметить происхождение каждого материала и условия его включения. Аудио имеют явно указанные ограничения на изменение и распространение; обязательное включение оригинальных аудио пользователь не запрашивал.

## Проверка полной структуры курса

Оба оглавления и официальный Can-do Check подтверждают 18 уроков / 9 тем, Can-do 1–50. Первые два урока Katsudoo посвящены коммуникативным формулам, а Rikai — хирагане и катакане. Числа страниц в структурной карте означают начало темы в печатной книге. Русские тематические метки и технические имена в [карте](../materials/marugoto-starter-a1/curriculum-outline.json) подготовлены для проекта и не являются официальными формулировками. При извлечении русского Can-do Check выявлены ошибки OCR; их текст нельзя автоматически использовать в корпусе.

## Интервальное повторение

- [Anki: Answer Buttons](https://docs.ankiweb.net/manual/studying#answer-buttons) — Again означает неуспешное воспроизведение; Hard, Good и Easy — успешное с разной субъективной трудностью. Забытый ответ нельзя записывать как Hard.
- [Anki: FSRS](https://docs.ankiweb.net/manual/deck-options#fsrs) — интервалы опираются на историю ответов и целевое удержание; стандартная цель Anki — 90%, её повышение увеличивает нагрузку. Короткие шаги повторного изучения отделены от интервалов обычного повторения.
- [Официальный README ts-fsrs v5.4.2](https://raw.githubusercontent.com/open-spaced-repetition/ts-fsrs/v5.4.2/packages/fsrs/README.md) — кандидат для локального расчёта расписания в TypeScript, с поддержкой браузера и Node.js ≥20, состояниями New/Learning/Review/Relearning и журналом результата.
- [Метаданные npm ts-fsrs](https://registry.npmjs.org/ts-fsrs/5.4.2) — выбрана 5.4.2, лицензия MIT; выполнение на Bun подтверждено локальным probe.

Применение расписания к навыку с меняющимися предложениями — продуктовая гипотеза: расчёт удержания карточки сам по себе не доказывает перенос грамматики на новые ситуации.

## Кандидаты для проверки свободного разбора

- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) — на дату проверки стандартный ввод и вывод Gemini 3.8 Flash и 3.5 Flash-Lite имеют Free Tier. Бесплатный уровень отмечен как используемый для улучшения продуктов Google; бесплатность не означает отсутствие квот.
- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) — официальная карточка модели и поддержки структурированного вывода. Качество японско-русского разбора не проверено.
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) — квоты относятся к проекту, а не к каждому ключу; фактические ограничения нужно смотреть в аккаунте. Поддержка 100 пользователей ими пока не подтверждена.
- [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) — платный уровень включается настройкой биллинга; для проекта не предполагается автоматическое согласие на расходы.
- [Gemini available regions](https://ai.google.dev/gemini-api/docs/available-regions) — Россия отсутствует в опубликованном перечне доступных стран на дату проверки. Страна пользователя, аккаунта и будущего сервера пока не установлена; часовой пояс не считается доказательством доступности или недоступности конкретного аккаунта.
- [Официальный выпуск Qwen3](https://qwenlm.github.io/blog/qwen3/) — семейство моделей с Apache 2.0; японский и русский явно перечислены среди поддерживаемых языков. Это не подтверждает качество объяснений частиц.
- [Ollama qwen3:8b](https://ollama.com/library/qwen3:8b) — локально запускаемый кандидат с файлом модели около 5,2 ГБ; размер файла не равен потреблению оперативной памяти.
- [Ollama FAQ](https://docs.ollama.com/faq) — локальный режим, отключение облачных функций, влияние параллельности на память и возможность переполнения очереди.
- [Ollama authentication](https://docs.ollama.com/api/authentication) — локальный API не требует аутентификации; для приложения с пользователями его нужно оставлять за авторизованным сервером приложения.

Модели не запускались; ответы, скорость, квоты аккаунта и аппаратные требования проекта не измерены. План сравнения записан в [AI-EVALUATION.md](AI-EVALUATION.md).

## Кандидат технического стека для собственного сервера

- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) — Node.js/Docker, рекомендация reverse proxy и работа единственного экземпляра с постоянным локальным диском. Документация не заменяет проверку производительности проекта.
- [Better Auth SQLite](https://better-auth.com/docs/adapters/sqlite) — поддержка SQLite, рекомендуемый драйвер better-sqlite3, генерация и миграция схемы. Минимальные совместимые версии нужно закрепить при реализации.
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password) — регистрация, вход и сброс пароля; доставку сообщений реализует приложение, она не возникает автоматически.
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management) — cookie и серверная сессия, связанная с пользователем и сроком действия.
- [Better Auth Admin plugin](https://better-auth.com/docs/plugins/admin) — создание пользователя и административные операции. Это не доказательство наличия готового сценария одноразового приглашения; такой сценарий требует отдельной логики и согласования.

На этапе рассмотрения этого варианта установок не было. Next.js/SQLite не стали действующим выбором; актуальные установка и локальные проверки Hono/Bun/PostgreSQL перечислены в матрице совместимости.

## Поурочные грамматические источники

[MARUGOTO Plus: грамматический индекс](https://a1.marugotoweb.jp/en/grammar_top.php) публикует 52 заметки и 16 страниц практики для L3–18. [Манифест](../materials/marugoto-starter-a1/source-manifest.json) различает ссылки, наблюдавшиеся в индексе, и непосредственно прочитанные страницы; заметка не равна одному навыку.

Для L4 проверены отдельные заметки [перечисление с と](https://a1.marugotoweb.jp/en/note_2_4_1.php), [место проживания с に](https://a1.marugotoweb.jp/en/note_2_4_2.php) и [связь существительных с の](https://a1.marugotoweb.jp/en/note_2_4_3.php). Для дальнейших тем проверена [L18: でも / そして](https://a1.marugotoweb.jp/en/note_9_18_2.php). Их структуры служат первичной опорой для собственных объяснений; полный текст всех заметок не собирался.

[Практика L4](https://a1.marugotoweb.jp/en/grammar_topic2_4.php) содержит выбор частиц и сборку предложений. В извлечённом HTML могут присутствовать общие скрытые приложения поздних уроков: весь текст страницы нельзя автоматически приписать L4.

[MARUGOTO-NO-KOTOBA: описание](https://words.marugotoweb.jp/static_contents/sp/about/about.php?lang=en) подтверждает словарный поиск и фильтрацию по учебнику, темам и урокам. Стабильный API или отдельные URL списков каждого урока не проверены; произвольные параметры не придумывались.

## Сборка и ресурсы VPS

- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) — отдельный runtime-артефакт; каталоги `public` и `.next/static` нужно включать явно, а нужные SQLite/контентные файлы проверять в готовой поставке.
- [Next.js memory usage](https://nextjs.org/docs/app/guides/memory-usage) — диагностика памяти production-сборки; универсальной гарантии RAM для конкретного приложения нет. Сборка вне VPS сокращает её пиковую нагрузку, но не заменяет runtime-тест.
- [Ollama qwen3:8b](https://ollama.com/library/qwen3:8b) — опубликованный артефакт Q4_K_M около 5,2 GB. Это размер файла, а не замер RAM; интерактивная работа на имеющихся 2 GB не подтверждена и в базовую конфигурацию не входит.
