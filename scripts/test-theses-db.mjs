#!/usr/bin/env node
/**
 * Teser i databasen (spec og §5).
 *
 * To trin omkring migrationen, så selve udfyldningen af eksisterende teams bliver testet:
 *
 *   npm run db:local -- fresh --until 0126
 *   npm run test:theses-db -- --before     teams, versioner og cases fra før teser (gemmes)
 *   npm run db:local -- migrate            0127 og senere
 *   npm run test:theses-db -- --after      udfyldningen, reglerne pr. tese, RLS; rydder op
 *
 * --before skriver testdata og et øjebliksbillede (skemaet t1046) og committer. --after tjekker
 * udfyldningen mod billedet, kører resten i én transaktion, der rulles tilbage, og sletter til sidst
 * testdataene og billedet igen, så de øvrige database-tests får en tom database.
 *
 * Runs against the local test database only (scripts/local-db.mjs).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;
const MIGRATION = join(
  resolve(import.meta.dirname, ".."),
  "db",
  "migrations",
  "0127_fund_theses.sql",
);

const id = (suffix) => `a1046000-0000-4000-8000-${suffix.padStart(12, "0")}`;
// Team A: udgivet (v1 tidligere, v2 aktiv, v3 kladde) og to cases.
const TEAM_A = id("f1");
// Team B: kun en kladde (aldrig udgivet) og én case.
const TEAM_B = id("f2");
// Team C: ingen versioner og ingen cases.
const TEAM_C = id("f3");
const ADMIN_A = id("a1");
const MEMBER_A = id("a2");
const ADMIN_B = id("a3");
const A_V1 = id("c1");
const A_V2 = id("c2");
const A_V3 = id("c3");
const B_V1 = id("c4");
const ALFA = id("b1");
const BETA = id("b2");
const GAMMA = id("b3");
const CASE_ALFA = id("d1");
const CASE_BETA = id("d2");
const CASE_GAMMA = id("d3");
const TEAMS = [TEAM_A, TEAM_B, TEAM_C];
const USERS = [ADMIN_A, MEMBER_A, ADMIN_B];

const mandate = (version) => `
  insert into public.fund_mandates (config_version_id, thesis, stages, geographies, sectors,
    ticket_note, analysis_threshold, risk_posture) values
    ('${version}', 'Nordisk seed', '{seed}', '{Norden}', '{SaaS}', 'Op til 1 mio. EUR', 70, 'Middel');
  insert into public.mandate_gates (config_version_id, gate_key, label, description, treatment,
    sort_order) values ('${version}', 'geo', 'Norden', 'Selskabet er nordisk', 'hard', 1);
  insert into public.assessment_criteria (config_version_id, criterion_key, label, description,
    score_category, weight, sort_order) values
    ('${version}', 'team', 'Team', 'x', 'team', 25, 1),
    ('${version}', 'market', 'Marked', 'x', 'market', 25, 2),
    ('${version}', 'product', 'Produkt', 'x', 'product', 25, 3),
    ('${version}', 'traction', 'Traktion', 'x', 'traction', 25, 4);`;

const SEED_BEFORE = `
  insert into auth.users (id, email) values
    ('${ADMIN_A}', 't1046-admin-a@interlect.test'),
    ('${MEMBER_A}', 't1046-member-a@interlect.test'),
    ('${ADMIN_B}', 't1046-admin-b@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${TEAM_A}', 'Nordisk Kapital', 't1046-a'),
    ('${TEAM_B}', 'Bjerg Ventures', 't1046-b'),
    ('${TEAM_C}', 'C', 't1046-c');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${TEAM_A}', '${ADMIN_A}'), ('${TEAM_A}', '${MEMBER_A}'), ('${TEAM_B}', '${ADMIN_B}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, case when m.user_id = '${MEMBER_A}' then 'member' else 'admin' end::public.app_role
  from public.fund_memberships m where m.user_id in ('${ADMIN_A}', '${MEMBER_A}', '${ADMIN_B}');

  insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis,
    activated_at) values
    ('${A_V1}', '${TEAM_A}', 1, 'nordisk', 'draft', 'test', null),
    ('${A_V2}', '${TEAM_A}', 2, 'nordisk', 'draft', 'test', null),
    ('${B_V1}', '${TEAM_B}', 1, 'bjerg', 'draft', 'test', null);
  ${mandate(A_V1)}
  ${mandate(A_V2)}
  update public.fund_config_versions set status = 'active', activated_at = now() where id = '${A_V1}';
  update public.fund_config_versions set status = 'superseded' where id = '${A_V1}';
  update public.fund_config_versions set status = 'active', activated_at = now() where id = '${A_V2}';
  insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis)
  values ('${A_V3}', '${TEAM_A}', 3, 'nordisk', 'draft', 'test');

  insert into public.companies (id, fund_id, name, website, domain) values
    ('${ALFA}', '${TEAM_A}', 'Alfa ApS', 'https://alfa.test', 'alfa.test'),
    ('${BETA}', '${TEAM_A}', 'Beta ApS', null, null),
    ('${GAMMA}', '${TEAM_B}', 'Gamma ApS', null, null);
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by) values
    ('${CASE_ALFA}', '${TEAM_A}', '${ALFA}', 'manual', '${ADMIN_A}'),
    ('${CASE_BETA}', '${TEAM_A}', '${BETA}', 'manual', '${ADMIN_A}'),
    ('${CASE_GAMMA}', '${TEAM_B}', '${GAMMA}', 'manual', '${ADMIN_B}');

  create schema t1046;
  create table t1046.versions as
    select id, fund_id, version, profile_key, status::text as status
    from public.fund_config_versions where fund_id = any ('{${TEAMS}}'::uuid[]);
  create table t1046.cases as
    select id, fund_id, company_id from public.cases where fund_id = any ('{${TEAMS}}'::uuid[]);
`;

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(86)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql inside a savepoint that is rolled back; as a signed-in user unless role is null. */
async function attempt(client, userId, sql, params = [], role = "authenticated") {
  await client.query("savepoint t1046");
  try {
    if (role) {
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId ?? "", role }),
      ]);
    }
    const result = await client.query(sql, params);
    return { rows: result.rows, code: null, message: null };
  } catch (cause) {
    return { rows: [], code: cause.code, message: cause.message };
  } finally {
    await client.query("rollback to savepoint t1046");
  }
}

/** Like attempt, but keeps the changes (released savepoint); throws on error. */
async function asUser(client, userId, sql, params = []) {
  await client.query("savepoint t1046_keep");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query(sql, params);
    await client.query("reset role");
    await client.query("release savepoint t1046_keep");
    return result.rows;
  } catch (cause) {
    await client.query("rollback to savepoint t1046_keep");
    throw cause;
  }
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];

async function checkBackfill(client) {
  const theses = (
    await client.query(
      `select fund_id, name, status, is_default from public.fund_theses
       where fund_id = any ($1) order by fund_id`,
      [TEAMS],
    )
  ).rows;
  const byTeam = Object.groupBy(theses, (row) => row.fund_id);
  record(
    "Hvert team har præcis én tese efter migrationen",
    TEAMS.every((team) => byTeam[team]?.length === 1),
    JSON.stringify(theses),
  );
  const a = byTeam[TEAM_A]?.[0];
  const b = byTeam[TEAM_B]?.[0];
  const c = byTeam[TEAM_C]?.[0];
  record(
    "Tesen hedder som teamet; udgivet team = aktiv standardtese",
    a?.name === "Nordisk Kapital" && a?.status === "active" && a?.is_default === true,
    JSON.stringify(a),
  );
  record(
    "Et team uden udgivet version får en kladde-tese uden standard",
    b?.name === "Bjerg Ventures" && b?.status === "draft" && b?.is_default === false,
    JSON.stringify(b),
  );
  record(
    "Et team med et for kort navn får en gyldig tese",
    c?.name === "Tese" && c?.status === "draft",
    JSON.stringify(c),
  );

  const versions = await one(
    client,
    `select
       (select count(*) from t1046.versions)::int as before,
       (select count(*) from public.fund_config_versions where fund_id = any ($1))::int as after,
       (select count(*) from t1046.versions o
          join public.fund_config_versions v on v.id = o.id
          where v.version = o.version and v.profile_key = o.profile_key
            and v.status::text = o.status and v.fund_id = o.fund_id)::int as unchanged,
       (select count(*) from public.fund_config_versions v
          join public.fund_theses t on t.id = v.thesis_id and t.fund_id = v.fund_id
          where v.fund_id = any ($1))::int as on_team_thesis`,
    [TEAMS],
  );
  record(
    "Samme versioner pr. team (nummer, nøgle og status uændret) og alle på teamets tese",
    versions.before === 4 &&
      versions.after === 4 &&
      versions.unchanged === 4 &&
      versions.on_team_thesis === 4,
    JSON.stringify(versions),
  );
  const cases = await one(
    client,
    `select
       (select count(*) from t1046.cases)::int as before,
       (select count(*) from public.cases where fund_id = any ($1))::int as after,
       (select count(*) from t1046.cases o join public.cases c on c.id = o.id
          join public.fund_theses t on t.id = c.thesis_id and t.fund_id = c.fund_id
          where c.company_id = o.company_id)::int as on_team_thesis`,
    [TEAMS],
  );
  record(
    "Samme cases pr. team, alle på teamets tese",
    cases.before === 3 && cases.after === 3 && cases.on_team_thesis === 3,
    JSON.stringify(cases),
  );

  const locked = await attempt(
    client,
    null,
    `update public.fund_config_versions set source_basis = 'ændret' where id = $1`,
    [A_V1],
    null,
  );
  record(
    "En tidligere version er stadig låst efter migrationen",
    locked.code === "P0001" && /uforanderlige/.test(locked.message ?? ""),
    locked.message,
  );
}

async function checkRules(client) {
  const thesisA = (
    await one(client, "select id from public.fund_theses where fund_id = $1", [TEAM_A])
  ).id;
  const thesisB = (
    await one(client, "select id from public.fund_theses where fund_id = $1", [TEAM_B])
  ).id;

  // Køres igen: intet ændres, ingen fejl.
  const sql = readFileSync(MIGRATION, "utf8")
    .replace(/^\s*begin;\s*$/m, "")
    .replace(/^\s*commit;\s*$/m, "");
  // Den anden kørsel beholdes, så alle tjek nedenfor kører på funktionerne efter to kørsler.
  const rerun = await client.query(sql).then(
    () => null,
    (cause) => cause.message,
  );
  record("Migrationen kan køres to gange", rerun === null, rerun);
  if (rerun) return;
  const patched = await one(
    client,
    `select (length(d) - length(replace(d, 'dt.is_default', ''))) / length('dt.is_default') as n
     from pg_get_functiondef('public.brain_page_data(uuid, text, uuid)'::regprocedure) d`,
  );
  record(
    "Brains tese-side er kun rettet én gang efter to kørsler",
    patched.n === 1,
    String(patched.n),
  );

  const browserCopy = await attempt(
    client,
    ADMIN_A,
    "select public.create_thesis_from($1, 'Kopi') as id",
    [thesisA],
  );
  record(
    "Browseren kan ikke kopiere en tese før T-1047 (kun service_role)",
    browserCopy.code === "42501",
    browserCopy.code,
  );
  // Resten tester funktionens egne regler, som den bliver, når giver adgang.
  await client.query(
    "grant execute on function public.create_thesis_from(uuid, text) to authenticated",
  );

  // RLS og rettigheder.
  const seenA = await attempt(client, ADMIN_A, "select id from public.fund_theses");
  record(
    "Et medlem ser kun sit eget teams teser",
    seenA.rows.length === 1 && seenA.rows[0].id === thesisA,
    seenA.message ?? JSON.stringify(seenA.rows),
  );
  const seenB = await attempt(
    client,
    ADMIN_B,
    "select id from public.fund_theses where fund_id = $1",
    [TEAM_A],
  );
  record("Et medlem af team B kan ikke se team A's teser", seenB.rows.length === 0, seenB.message);
  const anon = await attempt(client, null, "select id from public.fund_theses", [], "anon");
  record("Uden login kan teser ikke læses", anon.code === "42501", anon.code);
  const insert = await attempt(
    client,
    ADMIN_A,
    "insert into public.fund_theses (fund_id, name) values ($1, 'Direkte')",
    [TEAM_A],
  );
  record(
    "En bruger kan ikke skrive teser direkte (kun via funktioner)",
    insert.code === "42501",
    insert.code,
  );
  const rename = await attempt(
    client,
    ADMIN_A,
    "update public.fund_theses set name = 'Nyt' where id = $1",
    [thesisA],
  );
  record("En bruger kan ikke omdøbe en tese direkte", rename.code === "42501", rename.code);
  const moveVersion = await attempt(
    client,
    ADMIN_A,
    "update public.fund_config_versions set thesis_id = $2 where id = $1",
    [A_V3, thesisB],
  );
  record(
    "En kladde kan ikke flyttes til en anden tese",
    moveVersion.code !== null,
    moveVersion.message,
  );
  const foreignVersion = await attempt(
    client,
    ADMIN_A,
    `insert into public.fund_config_versions (fund_id, thesis_id, version, profile_key, source_basis)
     values ($1, $2, 9, 'fremmed', 'test')`,
    [TEAM_A, thesisB],
  );
  record(
    "En version kan ikke lægges på et andet teams tese",
    foreignVersion.code === "23503",
    foreignVersion.code,
  );
  const moveCase = await attempt(
    client,
    null,
    "update public.cases set thesis_id = $2 where id = $1",
    [CASE_ALFA, thesisB],
    null,
  );
  record("En case kan ikke flyttes til en anden tese", moveCase.code !== null, moveCase.message);

  // Ny tese som kopi.
  const create = "select public.create_thesis_from($1, $2) as id";
  const member = await attempt(client, MEMBER_A, create, [thesisA, "Klima growth"]);
  record("Et Medlem kan ikke oprette en tese", member.code === "P0001", member.message);
  const outsider = await attempt(client, ADMIN_B, create, [thesisA, "Klima growth"]);
  record(
    "En Admin i et andet team kan ikke kopiere tesen",
    outsider.code === "P0001",
    outsider.message,
  );
  const sameName = await attempt(client, ADMIN_A, create, [thesisA, " nordisk kapital "]);
  record(
    "Navnet skal være unikt i teamet",
    /allerede/.test(sameName.message ?? ""),
    sameName.message,
  );
  const fromDraft = await attempt(client, ADMIN_B, create, [thesisB, "Kopi"]);
  record(
    "En tese uden udgivet version kan ikke kopieres",
    fromDraft.code === "P0001",
    fromDraft.message,
  );

  const klima = (await asUser(client, ADMIN_A, create, [thesisA, "Klima growth"]))[0].id;
  const klimaRow = await one(
    client,
    `select t.status, t.is_default, t.fund_id, v.id as version_id, v.version, v.status::text as vstatus,
       v.profile_key,
       (select count(*) from public.assessment_criteria c where c.config_version_id = v.id)::int as criteria,
       (select thesis from public.fund_mandates m where m.config_version_id = v.id) as thesis
     from public.fund_theses t join public.fund_config_versions v on v.thesis_id = t.id
     where t.id = $1`,
    [klima],
  );
  record(
    "Kopien er en kladde-tese med version 1 som kladde og samme indhold",
    klimaRow?.status === "draft" &&
      klimaRow?.is_default === false &&
      klimaRow?.fund_id === TEAM_A &&
      klimaRow?.version === 1 &&
      klimaRow?.vstatus === "draft" &&
      klimaRow?.criteria === 4 &&
      klimaRow?.thesis === "Nordisk seed",
    JSON.stringify(klimaRow),
  );
  record(
    "Kopien får sin egen analysenøgle",
    Boolean(klimaRow?.profile_key) &&
      klimaRow.profile_key !== "nordisk" &&
      klimaRow.profile_key.startsWith("nordisk-"),
    klimaRow?.profile_key,
  );
  const audit = await one(
    client,
    "select count(*)::int as n from public.audit_events where action = 'fund_thesis_created' and entity_id = $1",
    [klima],
  );
  record("Oprettelsen står i auditloggen", audit.n === 1, String(audit.n));

  // Kladde-tesen kan ikke vælges i Opret case.
  const caseSql = `select public.create_manual_case_for_fund($1, $2, $3, 'seed', null, null, 'test', '[]'::jsonb, $4) as id`;
  const draftCase = await attempt(client, ADMIN_A, caseSql, [
    TEAM_A,
    "Alfa ApS",
    "https://alfa.test",
    klima,
  ]);
  record(
    "En tese, der ikke er udgivet, kan ikke vælges til en case",
    /kan ikke vælges/.test(draftCase.message ?? ""),
    draftCase.message,
  );
  const foreignCase = await attempt(client, ADMIN_A, caseSql, [
    TEAM_A,
    "Alfa ApS",
    "https://alfa.test",
    thesisB,
  ]);
  record(
    "Et andet teams tese kan ikke vælges til en case",
    /kan ikke vælges/.test(foreignCase.message ?? ""),
    foreignCase.message,
  );

  // Udgiv kopien: begge teser har hver sin aktive version.
  await asUser(client, ADMIN_A, "select public.activate_fund_config($1)", [klimaRow.version_id]);
  const published = await one(
    client,
    `select
       (select status from public.fund_theses where id = $1) as klima_status,
       (select is_default from public.fund_theses where id = $1) as klima_default,
       (select is_default from public.fund_theses where id = $2) as a_default,
       (select status::text from public.fund_config_versions where id = $3) as a_v2,
       (select count(*) from public.fund_config_versions where fund_id = $4 and status = 'active')::int as active`,
    [klima, thesisA, A_V2, TEAM_A],
  );
  record(
    "Udgivelse gør tesen aktiv og lader den anden teses aktive version være",
    published.klima_status === "active" &&
      published.klima_default === false &&
      published.a_default === true &&
      published.a_v2 === "active" &&
      published.active === 2,
    JSON.stringify(published),
  );
  const twoActive = await attempt(
    client,
    null,
    `insert into public.fund_config_versions (fund_id, thesis_id, version, profile_key, status, source_basis)
     values ($1, $2, 7, 'nordisk', 'active', 'test')`,
    [TEAM_A, thesisA],
    null,
  );
  record("Højst én aktiv version pr. tese", twoActive.code === "23505", twoActive.code);

  // Kladde og versionsnummer pr. tese.
  const draftA = (
    await asUser(client, ADMIN_A, "select public.create_fund_config_draft($1) as id", [A_V2])
  )[0].id;
  record("Tesens åbne kladde genbruges", draftA === A_V3, draftA);
  const draftKlima = (
    await asUser(client, ADMIN_A, "select public.create_fund_config_draft($1) as id", [
      klimaRow.version_id,
    ])
  )[0].id;
  const draftKlimaRow = await one(
    client,
    "select version, thesis_id, profile_key from public.fund_config_versions where id = $1",
    [draftKlima],
  );
  record(
    "En ny kladde tæller versioner pr. tese",
    draftKlimaRow.version === 2 &&
      draftKlimaRow.thesis_id === klima &&
      draftKlimaRow.profile_key === klimaRow.profile_key,
    JSON.stringify(draftKlimaRow),
  );
  await client.query(
    "update public.fund_mandates set thesis = 'Klima' where config_version_id = $1",
    [draftKlima],
  );
  await asUser(client, ADMIN_A, "select public.activate_fund_config($1)", [draftKlima]);
  const superseded = await one(
    client,
    `select (select status::text from public.fund_config_versions where id = $1) as klima_v1,
            (select status::text from public.fund_config_versions where id = $2) as a_v2`,
    [klimaRow.version_id, A_V2],
  );
  record(
    "Udgiv afløser kun den samme teses tidligere version",
    superseded.klima_v1 === "superseded" && superseded.a_v2 === "active",
    JSON.stringify(superseded),
  );

  // Samme selskab under to teser.
  const alfaKlima = (
    await asUser(client, ADMIN_A, caseSql, [TEAM_A, "Alfa ApS", "https://alfa.test", klima])
  )[0].id;
  const alfaAgain = (
    await asUser(client, ADMIN_A, caseSql, [TEAM_A, "Alfa ApS", "https://alfa.test", klima])
  )[0].id;
  const alfaDefault = (
    await asUser(client, ADMIN_A, caseSql, [TEAM_A, "Alfa ApS", "https://alfa.test", null])
  )[0].id;
  record(
    "Samme selskab bliver én case pr. tese; uden tese bruges standardtesen",
    alfaKlima !== CASE_ALFA && alfaAgain === alfaKlima && alfaDefault === CASE_ALFA,
    JSON.stringify({ alfaKlima, alfaAgain, alfaDefault }),
  );
  const alfaCompanies = await one(
    client,
    "select count(*)::int as n from public.companies where fund_id = $1 and domain = 'alfa.test'",
    [TEAM_A],
  );
  record(
    "Selskabet findes stadig kun én gang i teamet",
    alfaCompanies.n === 1,
    String(alfaCompanies.n),
  );
  const dup = await attempt(
    client,
    null,
    "insert into public.cases (fund_id, thesis_id, company_id, primary_origin, created_by) values ($1, $2, $3, 'manual', $4)",
    [TEAM_A, klima, ALFA, ADMIN_A],
    null,
  );
  record("To cases for samme selskab under samme tese afvises", dup.code === "23505", dup.code);

  // Overgang uden screening bruger casens teses aktive version.
  await client.query("savepoint t1046_move");
  const moved = await client
    .query(
      `select changed from public.transition_case(
         _fund_id => $1, _case_id => $2, _actor_id => $3, _to_phase => 'screening',
         _to_status => 'on_hold',
         _reason_codes => array(select code from public.brain_reason_codes
                                where fund_id = $1 and code <> 'other' order by sort_order limit 1),
         _note => 'T-1046')`,
      [TEAM_A, alfaKlima, ADMIN_A],
    )
    .then(
      () => null,
      (cause) => cause.message,
    );
  await client.query(moved ? "rollback to savepoint t1046_move" : "release savepoint t1046_move");
  record("En case under en anden tese kan flyttes i processen", moved === null, moved);
  const event = await one(
    client,
    `select config_version_id from public.case_transition_events
     where case_id = $1 and config_version_id is not null order by occurred_at desc limit 1`,
    [alfaKlima],
  );
  record(
    "En overgang uden screening gemmer casens teses aktive version",
    event?.config_version_id === draftKlima,
    JSON.stringify(event),
  );

  // Brains tese-side viser standardtesen.
  const brain = await one(client, "select public.brain_page_data($1, 'thesis', null) as data", [
    TEAM_A,
  ]);
  record(
    "Brains tese-side bruger standardtesens aktive version",
    brain.data?.config?.thesis === "Nordisk seed" && brain.data?.config?.version === 2,
    JSON.stringify(brain.data?.config),
  );

  // Cases-listen.
  const list = "select public.case_list_payload($1, $2, $3) as payload";
  const ids = (answer) => (answer.rows[0]?.payload?.cases ?? []).map((row) => row.id).sort();
  const all = await attempt(client, ADMIN_A, list, [TEAM_A, A_V2, null]);
  record(
    "Cases-listen viser alle aktive tesers cases som standard",
    JSON.stringify(ids(all)) === JSON.stringify([CASE_ALFA, CASE_BETA, alfaKlima].sort()),
    all.message ?? JSON.stringify(ids(all)),
  );
  const onlyKlima = await attempt(client, ADMIN_A, list, [TEAM_A, A_V2, klima]);
  record(
    "Cases-listen kan vise én tese",
    JSON.stringify(ids(onlyKlima)) === JSON.stringify([alfaKlima]),
    onlyKlima.message ?? JSON.stringify(ids(onlyKlima)),
  );
  const oldCall = await attempt(
    client,
    ADMIN_A,
    "select public.case_list_payload($1, $2) as payload",
    [TEAM_A, A_V2],
  );
  record(
    "Det gamle kald med to argumenter virker uændret",
    ids(oldCall).length === 3,
    oldCall.message,
  );
  await client.query(
    "update public.fund_theses set status = 'archived', archived_at = now() where id = $1",
    [klima],
  );
  const afterArchive = await attempt(client, ADMIN_A, list, [TEAM_A, A_V2, null]);
  record(
    "En arkiveret teses cases er ikke i den almindelige liste",
    JSON.stringify(ids(afterArchive)) === JSON.stringify([CASE_ALFA, CASE_BETA].sort()),
    afterArchive.message ?? JSON.stringify(ids(afterArchive)),
  );
  const archivedDraft = await attempt(
    client,
    ADMIN_A,
    "select public.create_fund_config_draft($1)",
    [draftKlima],
  );
  record(
    "En arkiveret tese får ingen ny kladde",
    /arkiveret/.test(archivedDraft.message ?? ""),
    archivedDraft.message,
  );
  const archivedCase = await attempt(client, ADMIN_A, caseSql, [TEAM_A, "Beta ApS", null, klima]);
  record(
    "En arkiveret tese kan ikke vælges til en case",
    /kan ikke vælges/.test(archivedCase.message ?? ""),
    archivedCase.message,
  );

  // Indsættelse uden tese (scripts, createFund, customer:new).
  const NEW_TEAM = id("f9");
  await client.query(
    "insert into public.funds (id, name, slug) values ($1, 'Nyt team', 't1046-ny')",
    [NEW_TEAM],
  );
  await client.query(
    "insert into public.fund_config_versions (fund_id, version, profile_key, status, source_basis) values ($1, 1, 'ny', 'draft', 'test')",
    [NEW_TEAM],
  );
  const newThesis = await one(
    client,
    "select name, status, is_default from public.fund_theses where fund_id = $1",
    [NEW_TEAM],
  );
  record(
    "Et nyt team får sin første tese som kladde ved første version",
    newThesis?.name === "Nyt team" &&
      newThesis?.status === "draft" &&
      newThesis?.is_default === false,
    JSON.stringify(newThesis),
  );
  await client.query(
    "insert into public.fund_config_versions (fund_id, version, profile_key, status, source_basis) values ($1, 2, 'ny', 'active', 'test')",
    [NEW_TEAM],
  );
  const newAfter = await one(
    client,
    "select count(*)::int as n, bool_and(status = 'active') as active, bool_and(is_default) as standard from public.fund_theses where fund_id = $1",
    [NEW_TEAM],
  );
  record(
    "Første udgivne version gør tesen aktiv og til standard",
    newAfter.n === 1 && newAfter.active && newAfter.standard,
    JSON.stringify(newAfter),
  );
  const company = await one(
    client,
    "insert into public.companies (fund_id, name) values ($1, 'Delta ApS') returning id",
    [NEW_TEAM],
  );
  const scriptCase = await one(
    client,
    "insert into public.cases (fund_id, company_id, primary_origin, created_by) values ($1, $2, 'manual', $3) returning thesis_id",
    [NEW_TEAM, company.id, ADMIN_A],
  );
  const standard = await one(
    client,
    "select id from public.fund_theses where fund_id = $1 and is_default",
    [NEW_TEAM],
  );
  record(
    "En case uden tese får teamets standardtese",
    scriptCase.thesis_id === standard.id,
    scriptCase.thesis_id,
  );

  // Slet team med to teser.
  await client.query("select public.delete_fund($1)", [TEAM_A]);
  const gone = await one(
    client,
    `select (select count(*) from public.fund_theses where fund_id = $1)::int as theses,
            (select count(*) from public.fund_config_versions where fund_id = $1)::int as versions,
            (select count(*) from public.cases where fund_id = $1)::int as cases`,
    [TEAM_A],
  );
  record(
    "Slet team sletter et team med to teser helt",
    gone.theses === 0 && gone.versions === 0 && gone.cases === 0,
    JSON.stringify(gone),
  );
}

async function cleanUp(client) {
  for (const team of TEAMS) {
    await client.query(
      "select public.delete_fund($1) where exists (select 1 from public.funds where id = $1)",
      [team],
    );
  }
  await client.query("delete from auth.users where id = any ($1)", [USERS]);
  await client.query("drop schema if exists t1046 cascade");
}

async function main() {
  const mode = process.argv.includes("--before")
    ? "before"
    : process.argv.includes("--after")
      ? "after"
      : null;
  if (!mode) {
    console.error("Brug --before (før 0127) eller --after (efter 0127). Se toppen af filen.");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    if (mode === "before") {
      const applied = await one(
        client,
        "select to_regclass('public.fund_theses') is not null as yes",
      );
      if (applied.yes)
        throw new Error(
          "0127 er allerede kørt: start med `npm run db:local -- fresh --until 0126`.",
        );
      await client.query("begin");
      await client.query(SEED_BEFORE);
      await client.query("commit");
      console.log(
        "Testdata fra før teser er gemt. Kør nu `npm run db:local -- migrate` og `--after`.",
      );
      return;
    }
    const seeded = await one(client, "select to_regclass('t1046.versions') is not null as yes");
    if (!seeded.yes) throw new Error("Ingen testdata fra --before.");
    await client.query("begin");
    try {
      await checkBackfill(client);
      await checkRules(client);
    } finally {
      await client.query("rollback").catch(() => {});
      await cleanUp(client);
    }
  } finally {
    await client.end();
  }
  console.log(
    `\n${results.passed} tjek af teser som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
