#!/usr/bin/env node
/**
 * AI-loggen i databasen: kun service-rollen, 90 dages oprydning af payloaden,
 * "Glem person" og sletning af fonden.
 *
 *   npm run db:local -- fresh && npm run test:ai-log-db
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything runs in one transaction that is rolled
 * back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND_A = "a3000000-0000-4000-8000-00000000000a";
const FUND_B = "b3000000-0000-4000-8000-00000000000b";
const ADMIN_A = "a3000000-0000-4000-8000-000000000001";
const NAME = "Anders Nørregaard";

const SEED = `
  insert into auth.users (id, email) values ('${ADMIN_A}', 'ai-log-admin-a@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${FUND_A}', 'AI-log fond A', 'ai-log-fond-a'),
    ('${FUND_B}', 'AI-log fond B', 'ai-log-fond-b');
  insert into public.fund_memberships (fund_id, user_id) values ('${FUND_A}', '${ADMIN_A}');
`;

const results = { passed: 0, failures: [] };

function record(name, ok, detail = "") {
  console.log(`${name.padEnd(72)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user (like PostgREST) inside a savepoint that is rolled back. */
async function asUser(client, userId, sql, params = []) {
  await client.query("savepoint ai_log_user");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await client.query(sql, params);
    return { rows: result.rows, code: null };
  } catch (cause) {
    return { rows: [], code: cause.code, message: cause.message };
  } finally {
    await client.query("rollback to savepoint ai_log_user");
  }
}

/** Runs sql as the service role (the server). */
async function asService(client, sql, params = []) {
  await client.query("set local role service_role");
  try {
    return await client.query(sql, params);
  } finally {
    await client.query("reset role").catch(() => {});
  }
}

async function insertRow(
  client,
  fundId,
  { ageDays = 0, payload = { prompt: "hej" }, flow = "screening" } = {},
) {
  const { rows } = await asService(
    client,
    `insert into public.ai_call_log (fund_id, created_at, flow, model, zdr, status, payload)
     values ($1, now() - make_interval(days => $2), $3, 'openai/gpt-5.4', true, 'ok', $4)
     returning id`,
    [fundId, ageDays, flow, JSON.stringify(payload)],
  );
  return rows[0].id;
}

async function row(client, id) {
  const { rows } = await client.query(
    "select payload, payload_removed_at, model, flow from public.ai_call_log where id = $1",
    [id],
  );
  return rows[0];
}

async function rights(client) {
  const id = await insertRow(client, FUND_A);
  const read = await asUser(client, ADMIN_A, "select * from public.ai_call_log");
  record("en bruger i fonden kan ikke læse AI-loggen", read.code === "42501", read.code ?? "læste");
  const write = await asUser(
    client,
    ADMIN_A,
    `insert into public.ai_call_log (fund_id, flow, model, zdr, status) values ($1, 'x', 'm', true, 'ok')`,
    [FUND_A],
  );
  record("en bruger kan ikke skrive i AI-loggen", write.code === "42501", write.code ?? "skrev");
  const forget = await asUser(client, ADMIN_A, "select public.ai_call_log_forget($1, $2)", [
    FUND_A,
    [NAME],
  ]);
  record(
    "en bruger kan ikke kalde ai_call_log_forget",
    forget.code === "42501",
    forget.code ?? "kaldte",
  );
  const service = await asService(
    client,
    "select count(*)::int as n from public.ai_call_log where id = $1",
    [id],
  );
  record("service-rollen kan læse AI-loggen", service.rows[0].n === 1);
  await client.query("savepoint bad_flow");
  let flow = "indsat";
  try {
    await insertRow(client, FUND_A, { flow: "Screening; drop" });
  } catch (cause) {
    flow = cause.code;
  } finally {
    await client.query("rollback to savepoint bad_flow");
  }
  record("et flow-navn uden for a-z, 0-9 og _ afvises", flow === "23514", flow);
}

async function retention(client) {
  const old = await insertRow(client, FUND_A, { ageDays: 91 });
  const after = await row(client, old);
  record(
    "efter 90 dage er payloaden væk, metadata bliver (oprydning ved skrivning)",
    after.payload === null && after.payload_removed_at !== null && after.model === "openai/gpt-5.4",
    JSON.stringify(after),
  );
  const recent = await insertRow(client, FUND_A, { ageDays: 89 });
  record("en payload på 89 dage bliver", (await row(client, recent)).payload !== null);
  await client.query(
    "update public.ai_call_log set created_at = now() - interval '95 days' where id = $1",
    [recent],
  );
  const { rows } = await asService(client, "select public.ai_call_log_purge() as n");
  record(
    "ai_call_log_purge fjerner payloads ældre end 90 dage og tæller dem",
    rows[0].n === 1 && (await row(client, recent)).payload === null,
    `n=${rows[0].n}`,
  );
}

async function forgetPerson(client) {
  const named = await insertRow(client, FUND_A, {
    payload: [{ role: "user", content: [{ type: "text", text: `Founder ${NAME} siger ja.` }] }],
  });
  const other = await insertRow(client, FUND_A, { payload: { prompt: "Pleo har 100 kunder." } });
  const otherFund = await insertRow(client, FUND_B, { payload: { prompt: `${NAME} i fond B` } });
  const wildcard = await insertRow(client, FUND_A, { payload: { prompt: "100% vækst" } });
  const word = await insertRow(client, FUND_A, { payload: { prompt: "En super properties-model." } });
  const spaced = await insertRow(client, FUND_A, { payload: { prompt: "Anders  Nørregaard ringede." } });
  const { rows } = await asService(client, "select public.ai_call_log_forget($1, $2) as n", [
    FUND_A,
    [NAME, "Per", "%", " ", "a"],
  ]);
  record(
    "Glem person fjerner payloads, der nævner navnet",
    (await row(client, named)).payload === null,
  );
  record("andre payloads i fonden bliver", (await row(client, other)).payload !== null);
  record(
    "en anden fonds payload med samme navn bliver",
    (await row(client, otherFund)).payload !== null,
  );
  record("et navn findes også med dobbelt mellemrum", (await row(client, spaced)).payload === null);
  record(
    'et alias som "Per" rammer kun hele ord, ikke "super" eller "properties"',
    (await row(client, word)).payload !== null,
  );
  record(
    "et '%' eller et bogstav alene sletter ikke alt",
    (await row(client, wildcard)).payload !== null && rows[0].n === 2,
    `n=${rows[0].n}`,
  );
}

async function fundDeletion(client) {
  await insertRow(client, FUND_B);
  await client.query("delete from public.funds where id = $1", [FUND_B]);
  const { rows } = await client.query(
    "select count(*)::int as n from public.ai_call_log where fund_id = $1",
    [FUND_B],
  );
  record("når fonden slettes, forsvinder dens AI-log", rows[0].n === 0, `n=${rows[0].n}`);
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(SEED);
    await rights(client);
    await retention(client);
    await forgetPerson(client);
    await fundDeletion(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(
    `\n${results.passed} tjek af AI-loggen som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`FEJL: ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
