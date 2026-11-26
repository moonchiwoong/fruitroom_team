# Local UI verification

The harness uses only fictitious account and lot records in `tests/fixtures/browser-fixtures.mjs`.
Every Supabase request and application data request is intercepted. Unknown external requests are blocked.
No production account, credentials, database or customer record is used or modified.

Run the suites using a Playwright-compatible Chromium executable:

```sh
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node tests/browser/run-local.mjs
```

The runner imports the installed `playwright` package. In the Codex runtime it can use the runtime-owned dependency without changing the project lockfile.
`npm ci` does not install Playwright for this optional browser suite. To reproduce it in a separate temporary dependency directory without changing this project's dependencies:

```sh
UI_TEST_DEPS="$(mktemp -d)"
npm install --prefix "$UI_TEST_DEPS" --no-package-lock playwright@1.62.1
"$UI_TEST_DEPS/node_modules/.bin/playwright" install chromium
NODE_PATH="$UI_TEST_DEPS/node_modules" npm run test:ui
```

Alternatively, set `NODE_PATH` to an existing Playwright installation and `CHROMIUM_EXECUTABLE_PATH` to its Chromium executable. On a minimal Linux host, Playwright's documented browser system dependencies must also be installed.

`run-local.mjs` starts Next with non-secret fake Supabase settings and runs the current suites: six fixes, summary layout, guest trial cards, consumer comparison, consumer sugar line, target calendar, Seoul Garak price card and harvest month. Run with `LANG=C.UTF-8 LC_ALL=C.UTF-8` so Korean download file names are kept.

If external fonts are blocked, `PRETENDARD_FONT=/path/to/PretendardVariable.woff2` serves a local copy through the request fixture without changing production code. Screenshots and JSON results are written under `tests/browser/artifacts/`.


Generated screenshots show implemented UI with fixture data; they are not screenshots of an authenticated production session.
These tests cannot establish live Supabase RLS correctness or real AI-provider connectivity.


