#!/usr/bin/env node
/**
 * Teamopsætning pr. stadie, skemaet (0133, session 1):
 *  - stage findes på assessment_criteria, mandate_gates, fund_specialists og
 *    prompt_module_overrides, er null på rækker fra før og tager kun de syv stadienøgler;
 *  - den unikke nøgle er (config_version_id, stage, nøgle) med nulls not distinct, og ON CONFLICT
 *    med stage virker, også når stage udelades (sådan gemmer serveren i dag);
 *  - fund_mandates.setup er '{}' som standard, og public.fund_setup_ok afviser forkerte former;
 *  - kladde, ny tese og gendan kopierer stage og setup (hele rækken i alle syv tabeller), og de tre
 *    funktioner kopierer via private.copy_fund_config_content;
 *  - en udgivet version er stadig uforanderlig, også i stage og setup, og RLS gælder de nye kolonner.
 *
 *   npm run db:local -- fresh && npm run test:setup-per-stage-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (suffix) => `a1091000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const TEAM = id("f1");
const ADMIN = id("a1");
const LEAD = id("a2");
const MEMBER = id("a3");
const V1 = id("c1");

const STAGES = ["pre_seed", "seed", "series_a", "series_b", "later", "growth", "buyout"];
const CONFIG_TABLES = [
  "fund_mandates",
  "mandate_gates",
  "assessment_criteria",
  "fund_profile_sources",
  "prompt_module_overrides",
  "research_module_overrides",
  "fund_specialists",
];
// Felter, der med vilje ikke kopieres 1:1 (ny række, ny version, hvem og hvornår).
const NOT_COPIED = ["id", "config_version_id", "updated_at", "updated_by"];

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 't1091-admin@interlect.test'),
    ('${LEAD}', 't1091-lead@interlect.test'),
    ('${MEMBER}', 't1091-member@interlect.test');
  insert into public.funds (id, name, slug) values ('${TEAM}', 'Stadieteamet', 't1091-a');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${TEAM}', '${ADMIN}'), ('${TEAM}', '${LEAD}'), ('${TEAM}', '${MEMBER}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, case m.user_id
      when '${LEAD}' then 'lead' when '${MEMBER}' then 'member' else 'admin' end::public.app_role
  from public.fund_memberships m
  where m.user_id in ('${ADMIN}', '${LEAD}', '${MEMBER}');

  -- v1 er en gammel version: skrevet uden stage og setup, som alle versioner før 0133.
  insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis)
  values ('${V1}', '${TEAM}', 1, 'stadier', 'draft', 'test');
  insert into public.fund_mandates (config_version_id, thesis, stages, geographies, sectors,
    ticket_note, analysis_threshold, risk_posture) values
    ('${V1}', 'Tidlige klimaselskaber', '{pre_seed,seed,series_a}', '{nordics}', '{climate}',
     'Op til 1 mio. EUR', 70, 'Middel');
  insert into public.mandate_gates (config_version_id, gate_key, label, description, treatment,
    sort_order) values ('${V1}', 'geo', 'Norden', 'Selskabet er nordisk', 'hard', 1);
  insert into public.assessment_criteria (config_version_id, criterion_key, label, description,
    score_category, weight, sort_order) values
    ('${V1}', 'team', 'Team', 'x', 'team_market_fit', 25, 1),
    ('${V1}', 'market', 'Marked', 'x', 'market_timing', 25, 2),
    ('${V1}', 'product', 'Produkt', 'x', 'product_market_fit', 25, 3),
    ('${V1}', 'traction', 'Traktion', 'x', 'traction_gtm', 25, 4);
  insert into public.fund_profile_sources (config_version_id, label, url, supports, source_type)
  values ('${V1}', 'Hjemmeside', 'https://t1091.interlect.test', 'Tesen', 'official_website');
  insert into public.prompt_module_overrides (config_version_id, module_id, mandate,
    evidence_tests, risk_areas) values
    ('${V1}', 'people_team', '{Vurdér founderne}', '{CV og resultater}', '{Nøglepersoner}');
  insert into public.research_module_overrides (config_version_id, mode, module_id, questions)
  values ('${V1}', 'screening', 'screening_market_mandate', '{Hvor stort er markedet?}');
  insert into public.fund_specialists (config_version_id, specialist_key, kind, enabled)
  values ('${V1}', 'technology_risk', 'standard', false);
  update public.fund_config_versions set status = 'active', activated_at = now() where id = '${V1}';
`;

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(92)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

let savepoints = 0;
/** Runs sql (as the given user, or as postgres) in a savepoint; keeps the change unless `keep` is false. */
async function attempt(client, sql, params = [], { as = null, keep = true } = {}) {
  const name = `t1091_${(savepoints += 1)}`;
  await client.query(`savepoint ${name}`);
  try {
    if (as) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [as]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: as, role: "authenticated" }),
      ]);
    }
    const result = await client.query(sql, params);
    if (as) await client.query("reset role");
    await client.query(keep ? `release savepoint ${name}` : `rollback to savepoint ${name}`);
    return { rows: result.rows, rowCount: result.rowCount, message: null };
  } catch (cause) {
    await client.query(`rollback to savepoint ${name}`);
    return { rows: [], rowCount: 0, message: cause.message };
  }
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];

/** Every row of a table in one version, without the fields that are not copied, in a fixed order. */
async function content(client, table, configId) {
  const row = await one(
    client,
    `select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) as rows
     from (select to_jsonb(t) - $2::text[] as x from public.${table} t
           where t.config_version_id = $1) s`,
    [configId, NOT_COPIED],
  );
  return row.rows;
}

async function sameContent(client, label, fromId, toId) {
  const differs = [];
  let rows = 0;
  for (const table of CONFIG_TABLES) {
    const [from, to] = await Promise.all([
      content(client, table, fromId),
      content(client, table, toId),
    ]);
    rows += from.length;
    if (JSON.stringify(from) !== JSON.stringify(to)) differs.push(table);
  }
  record(
    `${label}: alle syv tabeller er kopieret med stage og setup (${rows} rækker)`,
    differs.length === 0,
    differs.join(", "),
  );
}

const INSERTS = {
  assessment_criteria: (version, stage, key) => [
    `insert into public.assessment_criteria (config_version_id, stage, criterion_key, label,
       description, score_category, weight, sort_order)
     values ($1, $2, $3, 'Ekstra', 'x', 'evidence_quality', 10, 9)`,
    [version, stage, key],
  ],
  mandate_gates: (version, stage, key) => [
    `insert into public.mandate_gates (config_version_id, stage, gate_key, label, description,
       treatment, sort_order)
     values ($1, $2, $3, 'Regel', 'Beskrivelse', 'review', 9)`,
    [version, stage, key],
  ],
  fund_specialists: (version, stage, key) => [
    `insert into public.fund_specialists (config_version_id, stage, specialist_key, kind, enabled)
     values ($1, $2, $3, 'standard', false)`,
    [version, stage, key],
  ],
  prompt_module_overrides: (version, stage, key) => [
    `insert into public.prompt_module_overrides (config_version_id, stage, module_id, mandate,
       evidence_tests, risk_areas)
     values ($1, $2, $3, '{a}', '{b}', '{c}')`,
    [version, stage, key],
  ],
};
// En nøgle, som v1 ikke har, pr. tabel.
const FREE_KEY = {
  assessment_criteria: "extra",
  mandate_gates: "ticket",
  fund_specialists: "people_team",
  prompt_module_overrides: "fund_finance_deal",
};

async function run(client) {
  const thesisId = (
    await one(client, "select thesis_id from public.fund_config_versions where id = $1", [V1])
  ).thesis_id;

  // 1. Kolonnerne, og at gamle rækker er urørte.
  for (const table of Object.keys(INSERTS)) {
    const column = await one(
      client,
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = 'stage'`,
      [table],
    );
    record(
      `${table}.stage findes (tekst, kan være tom, ingen standard)`,
      column?.data_type === "text" && column?.is_nullable === "YES" && !column?.column_default,
    );
  }
  const setupColumn = await one(
    client,
    `select data_type, is_nullable, column_default from information_schema.columns
     where table_schema = 'public' and table_name = 'fund_mandates' and column_name = 'setup'`,
  );
  record(
    "fund_mandates.setup findes (jsonb, påkrævet, standard '{}')",
    setupColumn?.data_type === "jsonb" &&
      setupColumn?.is_nullable === "NO" &&
      /'\{\}'::jsonb/.test(setupColumn?.column_default ?? ""),
  );
  const oldRows = await one(
    client,
    `select
       (select count(*) from public.assessment_criteria where config_version_id = $1 and stage is not null)
     + (select count(*) from public.mandate_gates where config_version_id = $1 and stage is not null)
     + (select count(*) from public.fund_specialists where config_version_id = $1 and stage is not null)
     + (select count(*) from public.prompt_module_overrides where config_version_id = $1 and stage is not null)
       as staged,
       (select setup from public.fund_mandates where config_version_id = $1) as setup`,
    [V1],
  );
  record(
    "En version skrevet uden de nye felter har stage = null og setup = {} (ingen backfill)",
    Number(oldRows.staged) === 0 && JSON.stringify(oldRows.setup) === "{}",
  );

  // En kladde at arbejde i (Admin, som i appen).
  const draft = await attempt(client, "select public.create_fund_config_draft($1) as id", [V1], {
    as: ADMIN,
  });
  const v2 = draft.rows[0]?.id;
  record("Admin laver en kladde v2 af den gamle version", Boolean(v2), draft.message ?? "");
  await sameContent(client, "Kladde af en gammel version", V1, v2);

  // 2. Stadienøglerne.
  for (const [index, bad] of ["unknown", "series_b_plus", "Seed", ""].entries()) {
    const [sql, params] = INSERTS.assessment_criteria(v2, bad, `bad_${index}`);
    const result = await attempt(client, sql, params, { keep: false });
    record(
      `Stadiet "${bad}" afvises`,
      /assessment_criteria_stage_known/.test(result.message ?? ""),
      result.message ?? "blev gemt",
    );
  }
  const allStages = [];
  for (const stage of STAGES) {
    const [sql, params] = INSERTS.assessment_criteria(v2, stage, "team");
    allStages.push((await attempt(client, sql, params)).message);
  }
  record(
    "Alle syv stadier kan bære kriteriet 'team' ved siden af rækken uden stadie",
    allStages.every((message) => message === null),
    allStages.filter(Boolean).join("; "),
  );

  // 3. Den unikke nøgle pr. tabel.
  for (const [table, insert] of Object.entries(INSERTS)) {
    const key = FREE_KEY[table];
    const tryInsert = (stage) => {
      const [sql, params] = insert(v2, stage, key);
      return attempt(client, sql, params);
    };
    const firstNull = await tryInsert(null);
    const secondNull = await tryInsert(null);
    const seed = await tryInsert("seed");
    const seriesA = await tryInsert("series_a");
    const secondSeed = await tryInsert("seed");
    const unique = new RegExp(`${table}_version_stage_key`);
    record(
      `${table}: samme nøgle én gang uden stadie og én gang pr. stadie, aldrig to gange`,
      firstNull.message === null &&
        unique.test(secondNull.message ?? "") &&
        seed.message === null &&
        seriesA.message === null &&
        unique.test(secondSeed.message ?? ""),
      [firstNull, secondNull, seed, seriesA, secondSeed]
        .map((result) => result.message ?? "ok")
        .join(" | "),
    );
  }

  // 4. ON CONFLICT, som serveren bruger (stage udeladt = null).
  const upsertOverride = (mandate) =>
    attempt(
      client,
      `insert into public.prompt_module_overrides (config_version_id, module_id, mandate,
         evidence_tests, risk_areas)
       values ($1, 'technology_risk', $2, '{b}', '{c}')
       on conflict (config_version_id, stage, module_id) do update set mandate = excluded.mandate`,
      [v2, mandate],
    );
  const firstUpsert = await upsertOverride(["Første"]);
  const secondUpsert = await upsertOverride(["Anden"]);
  const overrides = (
    await client.query(
      `select stage, mandate from public.prompt_module_overrides
       where config_version_id = $1 and module_id = 'technology_risk'`,
      [v2],
    )
  ).rows;
  record(
    "ON CONFLICT (config_version_id, stage, nøgle) uden stage retter den samme række",
    !firstUpsert.message &&
      !secondUpsert.message &&
      overrides.length === 1 &&
      overrides[0].stage === null &&
      overrides[0].mandate[0] === "Anden",
    firstUpsert.message ?? secondUpsert.message ?? JSON.stringify(overrides),
  );
  const upsertSpecialist = await attempt(
    client,
    `insert into public.fund_specialists (config_version_id, specialist_key, kind, enabled)
     values ($1, 'technology_risk', 'standard', true)
     on conflict (config_version_id, stage, specialist_key) do update set enabled = excluded.enabled`,
    [v2],
  );
  const specialist = await one(
    client,
    `select count(*) as n, bool_and(enabled) as enabled from public.fund_specialists
     where config_version_id = $1 and specialist_key = 'technology_risk'`,
    [v2],
  );
  record(
    "ON CONFLICT på fund_specialists uden stage retter den kopierede række",
    !upsertSpecialist.message && Number(specialist.n) === 1 && specialist.enabled === true,
    upsertSpecialist.message ?? JSON.stringify(specialist),
  );
  const oldTarget = await attempt(
    client,
    `insert into public.fund_specialists (config_version_id, specialist_key, kind, enabled)
     values ($1, 'technology_risk', 'standard', true)
     on conflict (config_version_id, specialist_key) do nothing`,
    [v2],
    { keep: false },
  );
  record(
    "Den gamle nøgle uden stadie findes ikke længere (ON CONFLICT på den afvises)",
    /no unique or exclusion constraint/.test(oldTarget.message ?? ""),
    oldTarget.message ?? "blev accepteret",
  );

  // 5. setup.
  const setSetup = (value, keep = false) =>
    attempt(
      client,
      "update public.fund_mandates set setup = $2::jsonb where config_version_id = $1",
      [v2, value],
      { keep },
    );
  const valid = {
    about:
      "Vi går tidligt ind og arbejder tæt med founderne. Dokumenteret evidens vægter højere end fortællinger.",
    fixed_rules: {
      evidence_public_absence: "At noget ikke kan findes offentligt, er ikke et modbevis.",
    },
    stages: {
      seed: {
        economy: {
          runway: { enabled: true, threshold: 12, question: "Hvor længe rækker pengene?" },
        },
        questions: ["Hvad er burn pr. måned?"],
        lists: { criteria: "edited", economy: "standard" },
      },
      series_a: {},
    },
  };
  const validResult = await setSetup(JSON.stringify(valid), true);
  record("En gyldig setup gemmes", validResult.message === null, validResult.message ?? "");
  const invalid = [
    ["en liste", "[]"],
    ["en tekst", '"x"'],
    ["en ukendt nøgle øverst", '{"other": 1}'],
    ["stadiet 'unknown'", '{"stages": {"unknown": {}}}'],
    ["stadiet 'series_b_plus'", '{"stages": {"series_b_plus": {}}}'],
    ["et stadie, der ikke er et objekt", '{"stages": {"seed": []}}'],
    ["stages som liste", '{"stages": []}'],
    ["about som tal", '{"about": 5}'],
    ["about over 3.000 tegn", JSON.stringify({ about: "x".repeat(3001) })],
    ["et regel-id med store bogstaver og mellemrum", '{"fixed_rules": {"Bad Key": "x"}}'],
    ["en tom regeltekst", '{"fixed_rules": {"ok": "   "}}'],
    ["en regeltekst som tal", '{"fixed_rules": {"ok": 1}}'],
    ["en regeltekst over 600 tegn", JSON.stringify({ fixed_rules: { ok: "x".repeat(601) } })],
    ["over 128 KiB", JSON.stringify({ stages: { seed: { note: "x".repeat(140_000) } } })],
  ];
  for (const [label, value] of invalid) {
    const result = await setSetup(value);
    record(
      `setup afviser ${label}`,
      /fund_mandates_setup_ok/.test(result.message ?? ""),
      result.message ?? "blev gemt",
    );
  }
  const nullSetup = await attempt(
    client,
    "update public.fund_mandates set setup = null where config_version_id = $1",
    [v2],
    { keep: false },
  );
  record("setup kan ikke være tom (null)", /null value|not-null/.test(nullSetup.message ?? ""));

  // 6. RLS gælder de nye felter: Medlem skriver ikke, Admin skriver i kladden.
  const memberSetup = await attempt(
    client,
    `update public.fund_mandates set setup = '{"about": "Medlem"}'::jsonb
     where config_version_id = $1`,
    [v2],
    { as: MEMBER },
  );
  const memberStage = await attempt(
    client,
    `update public.assessment_criteria set stage = 'growth'
     where config_version_id = $1 and criterion_key = 'market' and stage is null`,
    [v2],
    { as: MEMBER },
  );
  const [memberInsertSql, memberInsertParams] = INSERTS.assessment_criteria(v2, "buyout", "member");
  const memberInsert = await attempt(client, memberInsertSql, memberInsertParams, { as: MEMBER });
  const afterMember = await one(
    client,
    "select setup ->> 'about' as about from public.fund_mandates where config_version_id = $1",
    [v2],
  );
  record(
    "Medlem kan ikke ændre setup, stage eller tilføje rækker pr. stadie (RLS uændret)",
    memberSetup.rowCount === 0 &&
      memberStage.rowCount === 0 &&
      /row-level security/.test(memberInsert.message ?? "") &&
      afterMember.about === valid.about,
    `${memberSetup.rowCount}/${memberStage.rowCount}/${memberInsert.message ?? "indsat"}`,
  );
  const memberRead = await attempt(
    client,
    "select stage from public.assessment_criteria where config_version_id = $1",
    [V1],
    { as: MEMBER, keep: false },
  );
  record(
    "Medlem kan læse stage som resten af opsætningen",
    memberRead.message === null && memberRead.rows.length === 4,
    memberRead.message ?? String(memberRead.rows.length),
  );
  const adminSetup = await attempt(
    client,
    "update public.fund_mandates set setup = $2::jsonb where config_version_id = $1",
    [v2, JSON.stringify(valid)],
    { as: ADMIN },
  );
  const [adminInsertSql, adminInsertParams] = INSERTS.mandate_gates(v2, "growth", "admin_rule");
  const adminInsert = await attempt(client, adminInsertSql, adminInsertParams, { as: ADMIN });
  record(
    "Admin kan skrive setup og rækker pr. stadie i kladden",
    adminSetup.rowCount === 1 && adminInsert.message === null,
    adminSetup.message ?? adminInsert.message ?? "",
  );

  // v2 udgives direkte i samme rækkefølge som activate_fund_config (v1 afløses, v2 bliver aktiv):
  // activate_fund_config regner endnu vægtsummen over alle stadier samlet; det rettes i session 4
  // . Triggerne på skiftet (vægtgrænser, specialister, tesen) kører stadig.
  // NB: assert_config_specialist_limits tæller på tværs af stadier. v2 har tre slukkede
  // standardrækker (people_team uden stadie, seed og series_a); udgivelsen går kun igennem, fordi
  // trin 4 tændte technology_risk igen. Fjernes det trin, afvises udgivelsen ("Mindst én specialist").
  const supersede = await attempt(
    client,
    "update public.fund_config_versions set status = 'superseded' where id = $1",
    [V1],
  );
  const publish = await attempt(
    client,
    "update public.fund_config_versions set status = 'active', activated_at = now() where id = $1",
    [v2],
  );
  record(
    "Forudsætning: v2 med indhold pr. stadie er udgivet",
    supersede.message === null && publish.message === null,
    supersede.message ?? publish.message ?? "",
  );

  // 7. En udgivet version er uforanderlig, også i stage og setup (0031 og 0076), selv for postgres.
  const immutable = /uforanderlige/;
  const changes = [
    [
      "assessment_criteria.stage",
      "update public.assessment_criteria set stage = 'later' where config_version_id = $1 and stage = 'seed'",
    ],
    [
      "mandate_gates.stage",
      "update public.mandate_gates set stage = 'later' where config_version_id = $1 and stage = 'seed'",
    ],
    [
      "fund_specialists.stage",
      "update public.fund_specialists set stage = 'later' where config_version_id = $1 and stage = 'seed'",
    ],
    [
      "prompt_module_overrides.stage",
      "update public.prompt_module_overrides set stage = 'later' where config_version_id = $1 and stage = 'seed'",
    ],
    [
      "fund_mandates.setup",
      "update public.fund_mandates set setup = '{}'::jsonb where config_version_id = $1",
    ],
    [
      "sletning af en række pr. stadie",
      "delete from public.assessment_criteria where config_version_id = $1 and stage = 'growth'",
    ],
  ];
  for (const [label, sql] of changes) {
    const result = await attempt(client, sql, [v2], { keep: false });
    record(
      `Udgivet: ${label} kan ikke ændres`,
      immutable.test(result.message ?? ""),
      result.message ?? "blev ændret",
    );
  }
  const [specialistSql, specialistParams] = INSERTS.fund_specialists(
    v2,
    "later",
    "fund_finance_deal",
  );
  const lateSpecialist = await attempt(client, specialistSql, specialistParams, { keep: false });
  record(
    "Udgivet: en ny specialist pr. stadie kan ikke tilføjes (0076)",
    immutable.test(lateSpecialist.message ?? ""),
    lateSpecialist.message ?? "blev tilføjet",
  );
  const [lateCriterionSql, lateCriterionParams] = INSERTS.assessment_criteria(v2, "later", "late");
  const lateCriterion = await attempt(client, lateCriterionSql, lateCriterionParams, {
    as: ADMIN,
    keep: false,
  });
  record(
    "Udgivet: Admin kan ikke tilføje et kriterium pr. stadie (RLS: kun kladder)",
    /row-level security/.test(lateCriterion.message ?? ""),
    lateCriterion.message ?? "blev tilføjet",
  );

  // 8. De tre veje til en ny version kopierer alt, også stage og setup.
  const v3 = (
    await attempt(client, "select public.create_fund_config_draft($1) as id", [v2], { as: LEAD })
  ).rows[0]?.id;
  record("Lead laver en kladde v3 af v2", Boolean(v3));
  await sameContent(client, "Kladde (create_fund_config_draft)", v2, v3);
  const staged = await one(
    client,
    `select (select count(*) from public.assessment_criteria where config_version_id = $1 and stage is not null) as criteria,
            (select setup -> 'stages' -> 'seed' -> 'economy' -> 'runway' ->> 'threshold' from public.fund_mandates where config_version_id = $1) as runway`,
    [v3],
  );
  record(
    "Kladden har kriterierne pr. stadie og økonomipunktet fra setup",
    Number(staged.criteria) === STAGES.length + 2 && staged.runway === "12",
    JSON.stringify(staged),
  );

  const copy = await attempt(
    client,
    "select public.create_thesis_from($1, 'Kopi pr. stadie') as id",
    [thesisId],
    { as: ADMIN },
  );
  const copyVersion = copy.rows[0]?.id
    ? (
        await one(client, "select id from public.fund_config_versions where thesis_id = $1", [
          copy.rows[0].id,
        ])
      )?.id
    : null;
  record("Admin laver en ny tese som kopi", Boolean(copyVersion), copy.message ?? "");
  await sameContent(client, "Ny tese (create_thesis_from)", v2, copyVersion);

  // Gendan kræver, at tesen ikke har en kladde: v3 fjernes først.
  await client.query("delete from public.fund_config_versions where id = $1", [v3]);
  const restoredNew = await attempt(
    client,
    "select public.restore_fund_config_version($1) as id",
    [v2],
    { as: LEAD },
  );
  record(
    "Lead gendanner v2 som en ny kladde",
    Boolean(restoredNew.rows[0]?.id),
    restoredNew.message ?? "",
  );
  await sameContent(client, "Gendan (restore_fund_config_version)", v2, restoredNew.rows[0]?.id);
  await client.query("delete from public.fund_config_versions where id = $1", [
    restoredNew.rows[0]?.id,
  ]);
  const restoredOld = await attempt(
    client,
    "select public.restore_fund_config_version($1) as id",
    [V1],
    { as: ADMIN },
  );
  await sameContent(client, "Gendan en gammel version uden stadier", V1, restoredOld.rows[0]?.id);

  // 9. Ingen af de tre funktioner har sin egen kopi med en fast kolonneliste.
  for (const signature of [
    "public.create_fund_config_draft(uuid)",
    "public.create_thesis_from(uuid, text)",
    "public.restore_fund_config_version(uuid)",
  ]) {
    const definition = (
      await one(client, "select pg_get_functiondef($1::regprocedure) as body", [signature])
    ).body;
    record(
      `${signature} kopierer via private.copy_fund_config_content`,
      /private\.copy_fund_config_content\(/.test(definition) &&
        !/insert into public\.(fund_mandates|mandate_gates|assessment_criteria|prompt_module_overrides|fund_specialists)\b/i.test(
          definition,
        ),
    );
  }
}

/**
 * Rækker, der lå i databasen, før 0133 kørte (i CI: testdata fra `test:theses-db -- --before`,
 * committet før `migrate`): ingen backfill, så stage er null og setup er {} overalt.
 */
async function preexisting(client) {
  const row = await one(
    client,
    `select
       (select count(*) from public.assessment_criteria) + (select count(*) from public.mandate_gates)
     + (select count(*) from public.fund_specialists) + (select count(*) from public.prompt_module_overrides)
       as rows,
       (select count(*) from public.assessment_criteria where stage is not null)
     + (select count(*) from public.mandate_gates where stage is not null)
     + (select count(*) from public.fund_specialists where stage is not null)
     + (select count(*) from public.prompt_module_overrides where stage is not null)
       as staged,
       (select count(*) from public.fund_mandates) as mandates,
       (select count(*) from public.fund_mandates where setup <> '{}'::jsonb) as with_setup`,
  );
  record(
    `Rækker fra før 0133 (${row.rows} rækker, ${row.mandates} mandater) har stage = null og setup = {}`,
    Number(row.staged) === 0 && Number(row.with_setup) === 0,
    JSON.stringify(row),
  );
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await preexisting(client);
    await client.query(SEED);
    await run(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(
    `\n${results.passed} tjek af opsætning pr. stadie som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
