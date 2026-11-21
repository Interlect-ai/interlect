#!/usr/bin/env node
/**
 * Version og sporbarhed (0129, TS-21):
 * restore_fund_config_version gendanner en ældre version som en NY kladde (næste nummer, samme
 * indhold, intet gammelt ændret, auditlinje), kun for Admin og Lead, aldrig oven i en kladde og
 * ikke for en arkiveret tese; og kolonnerne prompt_fingerprint på kørsler og trin findes, tager kun
 * sha256-hex og er lukket for browserens rolle (0115).
 *
 *   npm run db:local -- fresh && npm run test:config-restore-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (suffix) => `a1039000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const TEAM = id("f1");
const OTHER_TEAM = id("f2");
const ADMIN = id("a1");
const LEAD = id("a2");
const MEMBER = id("a3");
const OUTSIDER = id("a4");
const V1 = id("c1");
const ALFA = id("b1");
const CASE_ALFA = id("d1");
const RUN = id("e1");

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 't1039-admin@interlect.test'),
    ('${LEAD}', 't1039-lead@interlect.test'),
    ('${MEMBER}', 't1039-member@interlect.test'),
    ('${OUTSIDER}', 't1039-outsider@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${TEAM}', 'Nordisk Kapital', 't1039-a'),
    ('${OTHER_TEAM}', 'Andet team', 't1039-b');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${TEAM}', '${ADMIN}'), ('${TEAM}', '${LEAD}'), ('${TEAM}', '${MEMBER}'),
    ('${OTHER_TEAM}', '${OUTSIDER}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, case m.user_id
      when '${LEAD}' then 'lead' when '${MEMBER}' then 'member' else 'admin' end::public.app_role
  from public.fund_memberships m
  where m.user_id in ('${ADMIN}', '${LEAD}', '${MEMBER}', '${OUTSIDER}');

  insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis)
  values ('${V1}', '${TEAM}', 1, 'nordisk', 'draft', 'test');
  insert into public.fund_mandates (config_version_id, thesis, stages, geographies, sectors,
    ticket_note, analysis_threshold, risk_posture) values
    ('${V1}', 'Nordisk seed', '{seed}', '{Norden}', '{SaaS}', 'Op til 1 mio. EUR', 70, 'Middel');
  insert into public.mandate_gates (config_version_id, gate_key, label, description, treatment,
    sort_order) values ('${V1}', 'geo', 'Norden', 'Selskabet er nordisk', 'hard', 1);
  insert into public.assessment_criteria (config_version_id, criterion_key, label, description,
    score_category, weight, sort_order) values
    ('${V1}', 'team', 'Team', 'x', 'team', 25, 1),
    ('${V1}', 'market', 'Marked', 'x', 'market', 25, 2),
    ('${V1}', 'product', 'Produkt', 'x', 'product', 25, 3),
    ('${V1}', 'traction', 'Traktion', 'x', 'traction', 25, 4);
  update public.fund_config_versions set status = 'active', activated_at = now() where id = '${V1}';

  insert into public.companies (id, fund_id, name) values ('${ALFA}', '${TEAM}', 'Alfa ApS');
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
  values ('${CASE_ALFA}', '${TEAM}', '${ALFA}', 'manual', '${ADMIN}');
`;

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(86)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user in a savepoint; keeps the change unless `keep` is false. */
async function as(client, userId, sql, params = [], keep = true) {
  await client.query("savepoint t1039");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query(sql, params);
    await client.query("reset role");
    await client.query(keep ? "release savepoint t1039" : "rollback to savepoint t1039");
    return { rows: result.rows, message: null };
  } catch (cause) {
    await client.query("rollback to savepoint t1039");
    return { rows: [], message: cause.message };
  }
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];
const thesis = (client, thesisId) =>
  one(client, "select * from public.fund_theses where id = $1", [thesisId]);
const audits = async (client, action, entityId) =>
  Number(
    (
      await one(
        client,
        "select count(*) as n from public.audit_events where action = $1 and entity_id = $2",
        [action, entityId],
      )
    ).n,
  );

async function run(client) {
  const thesisId = (
    await one(client, "select thesis_id from public.fund_config_versions where id = $1", [V1])
  ).thesis_id;
  // v1 er aktiv; v2 laves og udgives med v1's tærskel ændret, så v1 er en ældre version.
  const draft = await as(client, ADMIN, "select public.create_fund_config_draft($1) as id", [V1]);
  const v2 = draft.rows[0]?.id;
  await client.query(
    "update public.fund_mandates set analysis_threshold = 55 where config_version_id = $1",
    [v2],
  );
  const published = await as(client, ADMIN, "select public.activate_fund_config($1)", [v2]);
  const v1Before = await one(
    client,
    "select status, version from public.fund_config_versions where id = $1",
    [V1],
  );
  record(
    "Forudsætning: v1 er afløst, v2 er aktiv",
    v1Before?.status === "superseded" && !published.message,
    published.message ?? draft.message ?? "",
  );

  // Rettigheder: Medlem og en udenfor kan ikke gendanne.
  const memberRestore = await as(client, MEMBER, "select public.restore_fund_config_version($1)", [
    V1,
  ]);
  record(
    "Medlem kan ikke gendanne en version",
    /Admin eller Lead/.test(memberRestore.message ?? ""),
  );
  const outsiderRestore = await as(
    client,
    OUTSIDER,
    "select public.restore_fund_config_version($1)",
    [V1],
  );
  record("En udenfor teamet kan ikke gendanne", outsiderRestore.message !== null);

  // Lead gendanner v1: en ny kladde v3 med v1's indhold; v1 og v2 er uændrede.
  const restored = await as(client, LEAD, "select public.restore_fund_config_version($1) as id", [
    V1,
  ]);
  const v3 = restored.rows[0]?.id;
  const v3Row = v3
    ? await one(
        client,
        "select version, status, thesis_id from public.fund_config_versions where id = $1",
        [v3],
      )
    : null;
  record(
    "Lead gendanner v1 som en NY kladde v3 i samme tese",
    v3 !== V1 && v3Row?.version === 3 && v3Row?.status === "draft" && v3Row?.thesis_id === thesisId,
    restored.message ?? "",
  );
  const threshold = async (configId) =>
    Number(
      (
        await one(
          client,
          "select analysis_threshold from public.fund_mandates where config_version_id = $1",
          [configId],
        )
      )?.analysis_threshold,
    );
  record("Kladden har v1's indhold (tærskel 70)", (await threshold(v3)) === 70);
  const criteria = Number(
    (
      await one(
        client,
        "select count(*) as n from public.assessment_criteria where config_version_id = $1",
        [v3],
      )
    ).n,
  );
  record("Kladden har v1's kriterier", criteria === 4);
  const statuses = await client.query(
    "select id, status from public.fund_config_versions where id = any($1) order by version",
    [[V1, v2]],
  );
  record(
    "Historikken er kun-tilføj: v1 er stadig afløst, v2 stadig aktiv med tærskel 55",
    statuses.rows[0]?.status === "superseded" &&
      statuses.rows[1]?.status === "active" &&
      (await threshold(v2)) === 55,
  );
  const audit = await one(
    client,
    "select payload from public.audit_events where action = 'fund_config_restored_as_draft' and entity_id = $1",
    [v3],
  );
  record(
    "Gendannelsen står i auditloggen med gammel og ny version",
    audit?.payload?.source_version === 1 && audit?.payload?.version === 3,
  );

  // Aldrig oven i en kladde.
  const twice = await as(client, ADMIN, "select public.restore_fund_config_version($1)", [V1]);
  record(
    "En gendannelse overskriver aldrig en kladde",
    /allerede en kladde/.test(twice.message ?? ""),
  );
  record(
    "Kladden er uændret efter den afviste gendannelse",
    (await threshold(v3)) === 70 &&
      Number(
        (
          await one(
            client,
            "select count(*) as n from public.fund_config_versions where thesis_id = $1",
            [thesisId],
          )
        ).n,
      ) === 3,
  );

  // En kladde kan ikke "gendannes" (kun udgivne versioner).
  const fromDraft = await as(client, ADMIN, "select public.restore_fund_config_version($1)", [v3]);
  record("En kladde kan ikke gendannes", /ikke fundet/.test(fromDraft.message ?? ""));

  // En arkiveret tese: tjekket sker, før kladden ses på.
  await client.query("savepoint archived");
  await client.query(
    "update public.fund_theses set status = 'archived', archived_at = now(), is_default = false where id = $1",
    [thesisId],
  );
  const archived = await as(client, ADMIN, "select public.restore_fund_config_version($1)", [V1]);
  await client.query("rollback to savepoint archived");
  record(
    "En arkiveret tese kan ikke få en gendannet version",
    /arkiveret/.test(archived.message ?? ""),
    archived.message ?? "",
  );

  // Den aktive version kan også gendannes (fx efter en kladde er slettet): ny kladde v3 = v2.
  await client.query("savepoint active");
  await client.query("delete from public.fund_config_versions where id = $1", [v3]);
  const fromActive = await as(
    client,
    ADMIN,
    "select public.restore_fund_config_version($1) as id",
    [v2],
  );
  const activeCopy = fromActive.rows[0]?.id;
  const activeCopyRow = activeCopy
    ? await one(client, "select version, status from public.fund_config_versions where id = $1", [
        activeCopy,
      ])
    : null;
  record(
    "Den aktive version gendannes som ny kladde med dens indhold",
    activeCopyRow?.status === "draft" &&
      activeCopyRow?.version === 3 &&
      (await threshold(activeCopy)) === 55,
    fromActive.message ?? "",
  );
  await client.query("rollback to savepoint active");

  const anon = await client
    .query(
      "select has_function_privilege('anon', 'public.restore_fund_config_version(uuid)', 'execute') as yes",
    )
    .then((result) => result.rows[0].yes);
  record("anon kan ikke gendanne", anon === false);

  // Fingeraftrykket: kun sha256-hex, og browserens rolle kan ikke læse det.
  await client.query(
    `insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status,
       workflow_version, prompt_template_name, prompt_template_version, requested_by,
       prompt_fingerprint)
     values ($1, $2, $3, $4, 'screening', 'complete', 'w', 'p', 'v', $5, $6)`,
    [RUN, TEAM, CASE_ALFA, V1, ADMIN, "a".repeat(64)],
  );
  const bad = await client
    .query("savepoint fp")
    .then(() =>
      client.query(
        "update public.analysis_runs set prompt_fingerprint = 'ikke en hash' where id = $1",
        [RUN],
      ),
    )
    .then(
      () => null,
      (cause) => cause.message,
    );
  await client.query("rollback to savepoint fp");
  record("prompt_fingerprint tager kun sha256-hex", /prompt_fingerprint_format/.test(bad ?? ""));
  for (const table of ["analysis_runs", "analysis_run_steps"]) {
    const readable = await client
      .query(
        "select has_column_privilege('authenticated', $1, 'prompt_fingerprint', 'select') as yes",
        [`public.${table}`],
      )
      .then((result) => result.rows[0].yes);
    record(`Browserens rolle kan ikke læse ${table}.prompt_fingerprint`, readable === false);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(SEED);
    await run(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(
    `\n${results.passed} tjek af gendannelse og fingeraftryk som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
