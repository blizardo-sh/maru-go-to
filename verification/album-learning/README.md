# Album acceptance

These checks use real React UI, the HTTP API and a disposable PostgreSQL database. They create UUID learners and delete only their own fixtures. No database reset, schema migration, production account or external AI call is involved.

Use Bun 1.4.3 on `PATH`, existing dependencies and an already migrated `japanese_app_test` database on `127.0.0.1`. Set both `TEST_DATABASE_URL` and `JAPANESE_INTEGRATION_DATABASE_URL` to that disposable database for integration tests. Finish database suites before starting browser fixtures.

## Built application / CI

After the final production build:

```sh
bun tests/helpers/run-guided-browser.ts verification/album-learning/flow.ts
bun tests/helpers/run-guided-browser.ts verification/album-learning/flight.ts
bun tests/helpers/run-guided-browser.ts
bun tests/helpers/run-guided-browser.ts tests/integration.study-layout.browser.ts
```

The existing launcher chooses separate API/frontend ports and supplies `GUIDED_BROWSER_URL`. The Album runner checks five reviewed family spellings, image-left tiles, click/Enter JP/RU bounds, actual example audio, responsive quiz controls, painted prop bounds/proportions/collisions, delayed and lost ACKs, one native sound cue, retry idempotency, visibility, cookie owner changes and logout. The focused flight runner checks one-shot native image loading and reserved size, short-drag return, a departing paper held until ACK, error return/retry, and grammar without flight. The guided regression separately supplies an explicitly historical DTO without `wordChoices`; the real server still grades its old actions, and an unmodified GET must preserve the old queue while offering four choices. Keyboard, paper movement, short-drag return, emulated native touch, grammar, optional videos and progress guards remain covered.

JSON and PNG evidence goes to ignored `test-results/album-learning`. `ALBUM_ARTIFACT_DIR` can select another local output folder. Touch and visibility are browser emulations; these checks do not claim physical-device coverage.

## Source preview

```sh
bun verification/album-learning/serve.ts
```

`ALBUM_PREVIEW_BUILT=true bun verification/album-learning/serve.ts` serves the final `dist` instead, without HMR.

This binds only API `127.0.0.1:3098` and frontend `localhost:5298`, with an explicit proxy to 3098. It never uses primary ports 3000/5173 or the frozen prototype port 5297. The `localhost` cookie host is separate from primary `127.0.0.1`; automated checks also use their own browser context.

The launcher prints a temporary fixture JSON path, never passwords. Its mode is 0600. Actor 0 belongs to visual preview; the focused wrapper uses actor 1. `ALBUM_FIXTURE_PATH` may select a temporary path. Sign in through the actual UI using the synthetic preview actor. Keep this file outside Git. The flow runner creates separate learners and never changes actor 0.

```sh
bun verification/album-learning/browser.ts
GUIDED_BROWSER_URL=http://localhost:5298 bun verification/album-learning/flow.ts
```

Source preview reloads client files, but `loadCourse()` is a startup snapshot: restart only this isolated service after approved corpus changes. Type `stop` and Enter in the launcher terminal for graceful shutdown and exact fixture cleanup. A forced process signal may let Vite exit first; after forced termination, verify and remove only the exact UUID actors recorded in the temporary fixture file. Preserve all other services and learners.
