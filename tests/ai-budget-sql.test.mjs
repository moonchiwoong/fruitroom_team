/**
 * PostgreSQL/WASM fixture integration tests. No Supabase or provider connection.
 * See ai-budget-sql.md for the isolated dependency install and limitations.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

const modulePath = process.env.AI_BUDGET_PGLITE_MODULE;
const { PGlite } = await import(modulePath
  ? pathToFileURL(resolve(modulePath)).href
  : "@electric-sql/pglite");
const migrationPath = fileURLToPath(new URL("../supabase/2026-10-23_ai_budget.sql", import.meta.url));
const migration = await readFile(migrationPath, "utf8");
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const bootstrap = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  INSERT INTO auth.users(id) VALUES ('${alice}'), ('${bob}');
`;
let db;

async function first(sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}
async function asRole(role, userId, action) {
  await db.exec(`SET ROLE ${role}`); // Only fixed role literals in this file.
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await action();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}
async function reserve(cost, requestId = randomUUID(), userId = alice) {
  return asRole("authenticated", userId, async () => (await first(
    "SELECT public.reserve_ai_budget($1::uuid, $2::numeric) AS result", [requestId, cost],
  )).result);
}
async function status(userId = alice) {
  return asRole("authenticated", userId, async () => (await first("SELECT public.ai_budget_status() AS result")).result);
}
async function quota(userId = alice) {
  return asRole("authenticated", userId, async () => (await first("SELECT public.consume_ai_read_quota() AS result")).result);
}
async function enable(overrides = {}) {
  const values = { enabled: true, monthly_budget_usd: 10, max_request_usd: 0.10,
    per_user_daily: 30, per_user_minute: 4, mcp_per_user_minute: 30, ...overrides };
  const entries = Object.entries(values);
  await db.query(`UPDATE public.ai_limits SET ${entries.map(([name], i) => `${name}=$${i + 1}`).join(",")} WHERE singleton`, entries.map(([, value]) => value));
}
async function seed(cost, age, userId = alice) {
  await db.query(`INSERT INTO public.ai_budget_reservations(request_id,user_id,reserved_usd,created_at)
    VALUES ($1,$2,$3,now()-$4::interval)`, [randomUUID(), userId, cost, age]);
}
async function countReservations() {
  return Number((await first("SELECT count(*) AS n FROM public.ai_budget_reservations")).n);
}

describe("AI budget migration on a local PostgreSQL fixture", { concurrency: false }, () => {
  before(async () => {
    db = new PGlite();
    await db.exec(bootstrap);
    await db.exec(migration);
    console.log(`SQL SHA256: ${createHash("sha256").update(migration).digest("hex")}`);
    console.log(`Engine: ${(await first("SELECT version() AS version")).version}`);
  });
  beforeEach(async () => {
    await db.exec(`RESET ROLE;
      TRUNCATE public.ai_budget_reservations, public.ai_read_windows;
      UPDATE public.ai_limits SET enabled=false, monthly_budget_usd=0,
        max_request_usd=0.10, per_user_daily=30, per_user_minute=4, mcp_per_user_minute=30;
      SELECT set_config('request.jwt.claim.sub', '', false);`);
  });
  after(async () => { await db?.close(); });

  test("migration applies, is re-runnable, and starts disabled with zero monthly budget", async () => {
    await db.exec(migration);
    assert.deepEqual(await status(), { enabled: false, available: false });
    assert.deepEqual(await reserve("0.01"), { allowed: false, code: "budget_not_configured" });
    assert.equal(await countReservations(), 0);
    const config = await first("SELECT enabled,monthly_budget_usd FROM public.ai_limits");
    assert.equal(config.enabled, false);
    assert.equal(Number(config.monthly_budget_usd), 0);
  });

  test("RLS is enabled and direct table access is revoked for fixture client roles", async () => {
    const rows = (await db.query(`SELECT relname,relrowsecurity FROM pg_class
      WHERE relnamespace='public'::regnamespace AND relname IN
      ('ai_limits','ai_budget_reservations','ai_read_windows') ORDER BY relname`)).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.relrowsecurity));
    for (const role of ["anon", "authenticated"]) {
      for (const { relname } of rows) {
        await asRole(role, alice, async () => {
          await assert.rejects(db.query(`SELECT * FROM public.${relname}`), { code: "42501" });
          await assert.rejects(db.query(`DELETE FROM public.${relname}`), { code: "42501" });
        });
      }
    }
  });

  test("anonymous role cannot execute the protected RPC functions", async () => {
    for (const call of ["ai_budget_status()", "consume_ai_read_quota()", "reserve_ai_budget(gen_random_uuid(), 0.01)"]) {
      await asRole("anon", null, async () => {
        await assert.rejects(db.query(`SELECT public.${call}`), { code: "42501" });
      });
    }
  });

  test("authenticated role without an identity is rejected by all function guards", async () => {
    for (const call of ["ai_budget_status()", "consume_ai_read_quota()", "reserve_ai_budget(gen_random_uuid(), 0.01)"]) {
      await asRole("authenticated", null, async () => {
        await assert.rejects(db.query(`SELECT public.${call}`), /Authentication required/);
      });
    }
    assert.equal(await countReservations(), 0);
  });

  test("successful reservation uses the caller identity and accepts the per-request limit exactly", async () => {
    await enable();
    const id = randomUUID();
    assert.deepEqual(await reserve("0.10", id), { allowed: true, reservation_id: id });
    const row = await first("SELECT request_id,user_id,reserved_usd FROM public.ai_budget_reservations");
    assert.equal(row.request_id, id);
    assert.equal(row.user_id, alice);
    assert.equal(Number(row.reserved_usd), 0.10);
  });

  test("null, zero, negative, and over-limit request costs and null request IDs are rejected", async () => {
    await enable();
    for (const cost of [null, "0", "-0.01", "0.100001", "NaN", "Infinity"]) {
      assert.deepEqual(await reserve(cost), { allowed: false, code: "request_budget_exceeded" });
    }
    assert.deepEqual(await reserve("0.01", null), { allowed: false, code: "request_budget_exceeded" });
    assert.equal(await countReservations(), 0);
  });

  test("duplicate UUID is denied for the same or a different user without double charging", async () => {
    await enable();
    const id = randomUUID();
    assert.equal((await reserve("0.01", id)).allowed, true);
    assert.deepEqual(await reserve("0.01", id), { allowed: false, code: "duplicate_request" });
    assert.deepEqual(await reserve("0.01", id, bob), { allowed: false, code: "duplicate_request" });
    assert.equal(await countReservations(), 1);
  });

  test("per-minute cap blocks the next request and ignores entries older than one minute", async () => {
    await enable({ per_user_minute: 2 });
    await seed("0.01", "61 seconds");
    assert.equal((await reserve("0.01")).allowed, true);
    assert.equal((await reserve("0.01")).allowed, true);
    assert.deepEqual(await reserve("0.01"), { allowed: false, code: "rate_limit" });
    assert.equal(await countReservations(), 3);
    assert.equal((await reserve("0.01", randomUUID(), bob)).allowed, true);
  });

  test("daily cap is a rolling 24-hour window and is isolated per user", async () => {
    await enable({ per_user_daily: 2 });
    await seed("0.01", "25 hours");
    await seed("0.01", "2 hours");
    assert.equal((await reserve("0.01")).allowed, true);
    assert.deepEqual(await reserve("0.01"), { allowed: false, code: "daily_limit" });
    assert.equal(await countReservations(), 3);
    assert.equal((await reserve("0.01", randomUUID(), bob)).allowed, true);
  });

  test("monthly budget is shared across users, allows exact exhaustion, and rejects the next micro-dollar", async () => {
    await enable({ monthly_budget_usd: 0.15 });
    assert.equal((await reserve("0.10")).allowed, true);
    assert.equal((await reserve("0.05", randomUUID(), bob)).allowed, true);
    assert.deepEqual(await status(), { enabled: true, available: false });
    assert.deepEqual(await reserve("0.000001"), { allowed: false, code: "monthly_limit" });
    const spent = await first("SELECT sum(reserved_usd) AS total FROM public.ai_budget_reservations");
    assert.equal(Number(spent.total), 0.15);
  });

  test("monthly accounting uses the UTC month boundary and excludes older reservations", async () => {
    await enable({ monthly_budget_usd: 0.10 });
    await db.exec("SET TIME ZONE 'Pacific/Honolulu'");
    try {
      await db.query(`INSERT INTO public.ai_budget_reservations(request_id,user_id,reserved_usd,created_at)
        VALUES ($1,$2,0.10,(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 microsecond')`, [randomUUID(), alice]);
      assert.deepEqual(await status(), { enabled: true, available: true });
      assert.equal((await reserve("0.10", randomUUID(), bob)).allowed, true);
      assert.deepEqual(await status(), { enabled: true, available: false });
    } finally { await db.exec("SET TIME ZONE 'UTC'"); }
  });

  test("sub-micro-dollar costs round up conservatively without exceeding the stored monthly limit", async () => {
    await enable({ monthly_budget_usd: 0.000001 });
    assert.equal((await reserve("0.0000001")).allowed, true);
    const spent = await first("SELECT sum(reserved_usd) AS total FROM public.ai_budget_reservations");
    assert.equal(Number(spent.total), 0.000001);
    assert.deepEqual(await reserve("0.0000001"), { allowed: false, code: "monthly_limit" });
  });

  test("read quota rejects requests beyond the cap without incrementing the counter", async () => {
    await enable({ mcp_per_user_minute: 2 });
    assert.equal(await quota(), true);
    assert.equal(await quota(), true);
    assert.equal(await quota(), false);
    const row = await first("SELECT requests FROM public.ai_read_windows WHERE user_id=$1", [alice]);
    assert.equal(row.requests, 2);
    assert.equal(await quota(bob), true);
  });

  test("read quota uses a new minute bucket and remains available while generation is disabled", async () => {
    await db.query(`INSERT INTO public.ai_read_windows(user_id,window_start,requests)
      VALUES ($1,date_trunc('minute',now())-interval '1 minute',30)`, [alice]);
    assert.equal(await quota(), true);
    assert.deepEqual(await status(), { enabled: false, available: false });
    assert.equal(Number((await first("SELECT count(*) AS n FROM public.ai_read_windows")).n), 2);
  });

  test("missing singleton configuration fails closed for reservations, status, and read quota", async () => {
    await db.exec("DELETE FROM public.ai_limits");
    try {
      assert.deepEqual(await status(), { enabled: false, available: false });
      assert.deepEqual(await reserve("0.01"), { allowed: false, code: "budget_not_configured" });
      assert.equal(await quota(), false);
    } finally { await db.exec("INSERT INTO public.ai_limits(singleton) VALUES(true)"); }
  });

  test("rolling back a reservation and read quota leaves no committed usage", async () => {
    await enable();
    await db.exec("BEGIN");
    assert.equal((await reserve("0.01")).allowed, true);
    assert.equal(await quota(), true);
    assert.equal(await countReservations(), 1);
    await db.exec("ROLLBACK");
    assert.equal(await countReservations(), 0);
    assert.equal(Number((await first("SELECT count(*) AS n FROM public.ai_read_windows")).n), 0);
  });

  test("a fixture identity absent from auth.users cannot create a reservation", async () => {
    await enable();
    await assert.rejects(reserve("0.01", randomUUID(), randomUUID()), { code: "23503" });
    assert.equal(await countReservations(), 0);
  });

  test("an injected migration error rolls back all budget schema objects", async () => {
    const isolated = new PGlite();
    try {
      await isolated.exec(bootstrap);
      const failingMigration = migration.replace(/\bcommit;/i, "SELECT ai_budget_fixture_injected_error(); COMMIT;");
      assert.notEqual(failingMigration, migration);
      await assert.rejects(isolated.exec(failingMigration), { code: "42883" });
      await isolated.exec("ROLLBACK");
      const row = (await isolated.query("SELECT to_regclass('public.ai_limits') AS limits, to_regclass('public.ai_budget_reservations') AS reservations, to_regclass('public.ai_read_windows') AS windows")).rows[0];
      assert.deepEqual(row, { limits: null, reservations: null, windows: null });
    } finally { await isolated.close(); }
  });
});
