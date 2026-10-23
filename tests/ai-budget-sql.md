# AI budget SQL fixture verification

Verified on 2026-10-23: **18 tests passed, 0 failed**. The migration was executed
by PostgreSQL, not checked only with string assertions or a mocked SQL parser.
No production Supabase, user account, provider, or paid AI endpoint was contacted.

## Engine and source

- Engine: PostgreSQL 18.6, embedded in `@electric-sql/pglite` 0.5.11 (WASM).
- Runner: Node.js 24.19.0, built-in `node:test`.
- SQL: `supabase/2026-10-23_ai_budget.sql`.
- SHA-256: `adf10f63ce921515d05db936332aa4aa2119da4d60833aaf96ae6250c87a911b`.
- Test: `tests/ai-budget-sql.test.mjs`.
- Last completed run: 18 tests, 1 suite, 18 passed, 0 failed, 0 skipped;
  duration 14.15 seconds.

Native `postgres`, `psql`, and `initdb` were unavailable. PGlite was installed in
a separate scratch directory; it was not added to the application dependencies
or lockfile. Each execution creates new in-memory databases and closes them.

## Reproduce

Run the following in the repository root. The temporary directory must be
outside the repository so no application dependency changes are needed.

```bash
AI_BUDGET_TEST_DEPS=$(mktemp -d /tmp/ai-budget-sql.XXXXXX)
npm install --prefix "$AI_BUDGET_TEST_DEPS" --no-audit --no-fund @electric-sql/pglite@0.5.11
AI_BUDGET_PGLITE_MODULE="$AI_BUDGET_TEST_DEPS/node_modules/@electric-sql/pglite/dist/index.js" \
  node --test tests/ai-budget-sql.test.mjs
```

The runner prints the SQL hash and engine version before its results. It reads
the current migration from disk, so compare the printed hash before treating an
earlier result as verification of changed SQL. This is a separate integration
command; `npm test` runs the existing TypeScript test suite and does not run this
optional engine dependency.

## Passing scenarios

| Area | Executed assertion |
| --- | --- |
| Apply and reapply | Entire migration executes twice without error. Initial status is disabled with zero monthly budget; no reservation is written. |
| Table protection | RLS flags are enabled on all three AI tables. Fixture `anon` and `authenticated` roles cannot select or delete their rows. |
| RPC grants | `anon` receives PostgreSQL permission errors for all three RPC functions. |
| Missing identity | `authenticated` with a null mocked user ID is rejected by each function's authentication guard. |
| Accepted request | A valid reservation records the caller's ID and accepts exactly the per-request maximum. |
| Invalid request | Null, zero, negative, above-limit, NaN and infinite costs, and a null request ID are rejected without charging. |
| Duplicate UUID | The same request UUID is rejected for both the original user and a different user; only one reservation remains. |
| Per-minute cap | The next request after the cap is rejected; a row older than one minute is excluded, and another user's quota is separate. |
| Daily cap | The cap uses the previous 24 hours; a 25-hour-old row is excluded, and another user's quota is separate. |
| Monthly cap | Usage is shared across users; exact budget exhaustion succeeds and the next micro-dollar is denied. Status reports no availability. |
| UTC month | A reservation immediately before the UTC month boundary is excluded, even with a non-UTC session timezone. |
| Cost rounding | A sub-micro-dollar request rounds up to one micro-dollar and cannot push stored usage above the stored monthly limit. |
| Read quota cap | Allowed calls reach the cap; denied calls do not keep incrementing it, and another user has a separate counter. |
| Read quota rollover | A previous minute bucket does not consume the current bucket. Read quota works while paid AI generation is disabled. |
| Missing config | Deleting the singleton configuration causes reservation, status, and read quota to fail closed. |
| Transaction rollback | A reservation and read count created inside a rolled-back transaction leave no committed usage. |
| User foreign key | A fabricated user ID absent from the mocked `auth.users` table cannot create a reservation. |
| Migration rollback | A deliberately injected error before `COMMIT` followed by `ROLLBACK` leaves none of the three AI tables behind. |

## What this does not verify

`auth.users`, `auth.uid()`, `anon`, and `authenticated` are local fixture objects.
The mocked `auth.uid()` reads a test-controlled session setting. This validates
the SQL guards and PostgreSQL grants under those fixture identities, **not**
Supabase JWT validation, login/session handling, PostgREST RPC exposure, the
deployed database's ownership or role configuration, existing production RLS
policies, service-role privileges, or access to real lots and measurement data.

PGlite runs one embedded database connection for these sequential tests. The
suite does **not** prove multi-instance or multi-connection contention behavior
of `SELECT ... FOR UPDATE`, concurrent request races, network failures, database
deployment compatibility with the target Supabase PostgreSQL version, provider
pricing accuracy, or real billing. Those require an isolated Supabase/PostgreSQL
staging environment and separate integration/load verification.

The production migration and application source were not modified for this
verification. AI was not enabled in any deployed environment.
