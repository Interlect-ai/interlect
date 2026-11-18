#!/usr/bin/env node
/**
 * Fondens egen screening i databasen: "sådan screener vi"-instruktionen og de
 * ekstra screeningskort pr. version. Hvem må gemme, hvad databasen afviser, standardværdier for
 * eksisterende versioner, låsning efter udgivelse og kopien til en ny kladde.
 *
 *   npm run db:local -- fresh && npm run test:screening-setup-db
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything runs in one transaction that is rolled
 * back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND_A = "a4000000-0000-4000-8000-00000000000a";
const FUND_B = "b4000000-0000-4000-8000-00000000000b";
const ADMIN_A = "a4000000-0000-4000-8000-000000000001";
const LEAD_A = "a4000000-0000-4000-8000-000000000003";
const MEMBER_A = "a4000000-0000-4000-8000-000000000002";
const ADMIN_B = "b4000000-0000-4000-8000-000000000001";
const ACTIVE_A = "a4000000-0000-4000-8000-0000000000c1";
const DRAFT_A = "a4000000-0000-4000-8000-0000000000c2";

const MANDATE_COLUMNS =
  "config_version_id, thesis, stages, geographies, sectors, ticket_note, analysis_threshold, risk_posture";
const mandateValues = (config) =>
  `('${config}', 'B2B-software i Norden', array['seed'], array['DK'], array['software'], '', 60, 'Moderat')`;

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN_A}', 'screen-admin-a@interlect.test'),
    ('${LEAD_A}', 'screen-lead-a@interlect.test'),
    ('${MEMBER_A}', 'screen-member-a@interlect.test'),
    ('${ADMIN_B}', 'screen-admin-b@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${FUND_A}', 'Screening fond A', 'screening-fond-a'),
    ('${FUND_B}', 'Screening fond B', 'screening-fond-b');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${FUND_A}', '${ADMIN_A}'), ('${FUND_A}', '${LEAD_A}'), ('${FUND_A}', '${MEMBER_A}'),
    ('${FUND_B}', '${ADMIN_B}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, r.role::public.app_role
  from public.fund_memberships m
  join (values ('${ADMIN_A}', 'admin'), ('${LEAD_A}', 'lead'), ('${MEMBER_A}', 'member'),
    ('${ADMIN_B}', 'admin')) as r(user_id, role) on r.user_id::uuid = m.user_id;
  insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
  values ('${ACTIVE_A}', '${FUND_A}', 1, 'screen', 'test'),
         ('${DRAFT_A}', '${FUND_A}', 2, 'screen', 'test');
  insert into public.fund_mandates (${MANDATE_COLUMNS}) values ${mandateValues(ACTIVE_A)}, ${mandateValues(DRAFT_A)};
  update public.fund_config_versions set status = 'active' where id = '${ACTIVE_A}';
`;

const results = { passed: 0, failures: [] };

function record(name, ok, detail = "") {
  console.log(`${name.padEnd(76)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user (like PostgREST) inside a savepoint that is rolled back. */
async function asUser(client, userId, sql, params = []) {
  await client.query("savepoint screen_user");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const raw = await client.query(sql, params);
    // Several statements give one result each; the last one is the answer.
    const result = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    // Read back inside the same savepoint, as postgres, before it is rolled back.
    await client.query("reset role");
    const after = await client.query(
      `select screening_instruction, screening_cards from public.fund_mandates
       where config_version_id = $1`,
      [DRAFT_A],
    );
    return { rows: result.rows, after: after.rows[0], error: null };
  } catch (cause) {
    return { rows: [], after: null, error: cause };
  } finally {
    await client.query("rollback to savepoint screen_user");
  }
}

/** Runs sql as postgres inside a savepoint that is rolled back; returns true or the problem. */
async function expectError(client, sql, pattern) {
  await client.query("savepoint screen_err");
  try {
    await client.query(sql);
    return "ingen fejl";
  } catch (cause) {
    return pattern.test(cause.message) ? true : cause.message;
  } finally {
    await client.query("rollback to savepoint screen_err");
  }
}

const save = (config, instruction, cards) =>
  `select public.save_fund_screening_setup('${config}', ${instruction}, ${cards})`;
const INSTRUCTION = "'Vi vægter dokumenteret betalingsvillighed højere end vækst i brugere.'";

async function defaults(client) {
  console.log("\nStandardværdier");
  const { rows } = await client.query(
    `select screening_instruction, screening_cards from public.fund_mandates
     where config_version_id = $1`,
    [ACTIVE_A],
  );
  record(
    "En version uden valg har ingen instruktion og Finanser-kortet (som i dag)",
    rows[0]?.screening_instruction === "" &&
      JSON.stringify(rows[0]?.screening_cards) === JSON.stringify(["finance"]),
    JSON.stringify(rows[0]),
  );
}

async function rights(client) {
  console.log("\nRettigheder");
  const asAdmin = await asUser(
    client,
    ADMIN_A,
    save(DRAFT_A, INSTRUCTION, "array['team','market']"),
  );
  record(
    "Admin kan gemme instruktion og kort i kladden",
    !asAdmin.error &&
      asAdmin.after?.screening_instruction.startsWith("Vi vægter") &&
      JSON.stringify(asAdmin.after?.screening_cards) === JSON.stringify(["team", "market"]),
    asAdmin.error?.message ?? JSON.stringify(asAdmin.after),
  );
  const asLead = await asUser(client, LEAD_A, save(DRAFT_A, INSTRUCTION, "array['technology']"));
  record("Lead kan gemme i kladden", !asLead.error, asLead.error?.message);
  const asMember = await asUser(client, MEMBER_A, save(DRAFT_A, INSTRUCTION, "array['team']"));
  record(
    "Et Medlem kan ikke ændre screeningen",
    /Admin eller Lead/.test(asMember.error?.message ?? ""),
    asMember.error?.message ?? "ingen fejl",
  );
  const otherFund = await asUser(client, ADMIN_B, save(DRAFT_A, INSTRUCTION, "array['team']"));
  record(
    "En anden fonds Admin kan ikke ændre fondens screening",
    /Admin eller Lead/.test(otherFund.error?.message ?? ""),
    otherFund.error?.message ?? "ingen fejl",
  );
  const active = await asUser(client, ADMIN_A, save(ACTIVE_A, INSTRUCTION, "array['team']"));
  record(
    "En udgivet version kan ikke ændres gennem funktionen",
    /Kladdeversionen blev ikke fundet/.test(active.error?.message ?? ""),
    active.error?.message ?? "ingen fejl",
  );
  const anon = await expectError(
    client,
    `set local role anon; ${save(DRAFT_A, INSTRUCTION, "array['team']")}`,
    /permission denied/,
  );
  record("anon kan ikke kalde funktionen", anon === true, String(anon));
  const audit = await asUser(
    client,
    ADMIN_A,
    `${save(DRAFT_A, INSTRUCTION, "array['team']")};
     select payload from public.audit_events
     where action = 'fund_screening_setup_saved' and entity_id = '${DRAFT_A}'`,
  );
  record(
    "Revisionsloggen får længden og kortene, ikke teksten",
    !audit.error &&
      audit.rows.length === 1 &&
      audit.rows[0].payload.instruction_chars > 0 &&
      !JSON.stringify(audit.rows[0].payload).includes("Vi vægter"),
    audit.error?.message ?? JSON.stringify(audit.rows),
  );
}

async function shape(client) {
  console.log("\nHvad databasen afviser");
  const tooLong = await asUser(
    client,
    ADMIN_A,
    save(DRAFT_A, "repeat('x', 3001)", "array['team']"),
  );
  record(
    "En instruktion over 3.000 tegn afvises",
    /3\.000 tegn/.test(tooLong.error?.message ?? ""),
    tooLong.error?.message ?? "ingen fejl",
  );
  const trimmed = await asUser(client, ADMIN_A, save(DRAFT_A, "'  Kort tekst.  '", "'{}'"));
  record(
    "Instruktionen trimmes, og ingen ekstra kort er tilladt",
    trimmed.after?.screening_instruction === "Kort tekst." &&
      trimmed.after?.screening_cards.length === 0,
    trimmed.error?.message ?? JSON.stringify(trimmed.after),
  );
  const cleared = await asUser(client, ADMIN_A, save(DRAFT_A, "null", "null"));
  record(
    "null rydder instruktionen og kortene",
    cleared.after?.screening_instruction === "" && cleared.after?.screening_cards.length === 0,
    cleared.error?.message ?? JSON.stringify(cleared.after),
  );
  const unknown = await asUser(client, ADMIN_A, save(DRAFT_A, "''", "array['esg']"));
  record(
    "Et ukendt kort afvises",
    /Ukendt eller gentaget/.test(unknown.error?.message ?? ""),
    unknown.error?.message ?? "ingen fejl",
  );
  const twice = await asUser(client, ADMIN_A, save(DRAFT_A, "''", "array['team','team']"));
  record(
    "Et kort to gange afvises",
    /Ukendt eller gentaget/.test(twice.error?.message ?? ""),
    twice.error?.message ?? "ingen fejl",
  );
  const directCard = await expectError(
    client,
    `update public.fund_mandates set screening_cards = array['finance', null]
     where config_version_id = '${DRAFT_A}'`,
    /screening_cards_known/,
  );
  record(
    "Tabellen afviser et tomt kort direkte (også for serveren)",
    directCard === true,
    String(directCard),
  );
  const directLong = await expectError(
    client,
    `update public.fund_mandates set screening_instruction = repeat('x', 3001)
     where config_version_id = '${DRAFT_A}'`,
    /screening_instruction_length/,
  );
  record(
    "Tabellen afviser en for lang instruktion direkte",
    directLong === true,
    String(directLong),
  );
}

async function lockedAndCopied(client) {
  console.log("\nLåst efter udgivelse og kopieret til næste kladde");
  await client.query(`
    update public.fund_config_versions set status = 'superseded' where id = '${ACTIVE_A}';
    update public.fund_mandates set screening_instruction = 'Founders først.',
      screening_cards = array['finance', 'team'] where config_version_id = '${DRAFT_A}';
    update public.fund_config_versions set status = 'active' where id = '${DRAFT_A}';
  `);
  const locked = await expectError(
    client,
    `update public.fund_mandates set screening_instruction = 'Ny tekst'
     where config_version_id = '${DRAFT_A}'`,
    /uforanderlige/,
  );
  record(
    "En udgivet instruktion kan ikke ændres (heller ikke af serveren)",
    locked === true,
    String(locked),
  );

  await client.query("savepoint screen_draft");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN_A]);
  const { rows } = await client.query("select public.create_fund_config_draft($1) as id", [
    DRAFT_A,
  ]);
  const draftId = rows[0].id;
  const copied = await client.query(
    `select screening_instruction, screening_cards from public.fund_mandates
     where config_version_id = $1`,
    [draftId],
  );
  record(
    "En ny kladde kopierer instruktionen og kortene",
    copied.rows[0]?.screening_instruction === "Founders først." &&
      JSON.stringify(copied.rows[0]?.screening_cards) === JSON.stringify(["finance", "team"]),
    JSON.stringify(copied.rows),
  );
  await client.query(save(draftId, "'Ny tekst i kladden.'", "array['market']"));
  await client.query("reset role");
  const after = await client.query(
    `select config_version_id, screening_instruction from public.fund_mandates
     where config_version_id in ($1, $2)`,
    [DRAFT_A, draftId],
  );
  const byId = Object.fromEntries(after.rows.map((row) => [row.config_version_id, row]));
  record(
    "Den nye kladde kan rettes, og den udgivne version er uændret",
    byId[draftId]?.screening_instruction === "Ny tekst i kladden." &&
      byId[DRAFT_A]?.screening_instruction === "Founders først.",
    JSON.stringify(after.rows),
  );
  await client.query("rollback to savepoint screen_draft");
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(SEED);
    await defaults(client);
    await rights(client);
    await shape(client);
    await lockedAndCopied(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }

  console.log(
    `\n${results.passed} screeningstjek som forventet, ${results.failures.length} afvigelser.`,
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
