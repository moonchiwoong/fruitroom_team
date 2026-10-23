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

`run-local.mjs` starts Next with non-secret fake Supabase settings and runs five suites: the main UI suite, isolated A → B session switching and date boundaries, measurement-condition comparisons, controlled mock AI responses, and the separate Hongro calculator. It stops the local server afterward. `UI_TEST_SCRIPT=run-auth-switch.mjs` selects only the session-switch/date-boundary suite.

If external fonts are blocked, `PRETENDARD_FONT=/path/to/PretendardVariable.woff2` serves a local copy through the request fixture without changing production code. Screenshots and JSON results are written under `tests/browser/artifacts/`.

The session-switch test uses Supabase's cross-tab `SIGNED_IN` event with fictitious cookies and HTTP responses; there is no authentication bypass in application code. It verifies the React application's cleanup on an identity transition, not production authentication or RLS.

Generated screenshots show implemented UI with fixture data; they are not screenshots of an authenticated production session.
These tests cannot establish live Supabase RLS correctness or real AI-provider connectivity.

`UI_TEST_SCRIPT=run-measurement-ui.mjs,run-ai-ui.mjs` runs focused measurement-condition regressions plus controlled mock AI responses, cancellation and scope-switch isolation. These AI tests verify frontend lifecycle behavior only; they do not connect an AI provider or MCP server. The delivery screenshots retain the unavailable/unconfigured AI state.

`UI_TEST_SCRIPT=run-hongro-ui.mjs` verifies the Hongro form, exact endpoints, missing/invalid values, user-scoped drafts, CSV and desktop/mobile layout. Test values are fixtures and are never recorded as measurements.
