#!/usr/bin/env node
/**
 * Teamopsætning pr. stadie, gem og udgiv (0134, session 4):
 *  - save_fund_config_draft uden _setup (alle kald fra) erstatter kun de delte regler og
 *    kriterier; rækkerne pr. stadie og fund_mandates.setup bliver stående, og et stadie i inputtet
 *    afvises;
 *  - med _setup erstattes alle regler og kriterier (hver med sit stadie), og setup gemmes;
 *  - activate_fund_config regner vægtene pr. stadie, og "Hvem er I" (setup.about) afløser
 *    risikotolerancen;
 *  - specialistgrænserne gælder hvert sæt for sig (det delte og hvert stadies eget);
 *  - validation_public viser setupStage og economy, og case_list_payload sender
 *    screening_setup_stage med.
 *
 *   npm run db:local -- fresh && npm run test:setup-per-stage-server-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (suffix) => `a1094000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const TEAM = id("f1");
const ADMIN = id("a1");
const MEMBER = id("a3");
const V1 = id("c1");
const COMPANY = id("b1");
const CASE = id("d1");
const RUN = id("e1");

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 't1094-admin@interlect.test'),
    ('${MEMBER}', 't1094-member@interlect.test');
  insert into public.funds (id, name, slug) values ('${TEAM}', 'Stadieteamet', 't1094-a');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${TEAM}', '${ADMIN}'), ('${TEAM}', '${MEMBER}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, case m.user_id when '${MEMBER}' then 'member' else 'admin' end::public.app_role
  from public.fund_memberships m
  where m.user_id in ('${ADMIN}', '${MEMBER}');

  insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis)
  values ('${V1}', '${TEAM}', 1, 'stadier', 'draft', 'test');
  insert into public.fund_mandates (config_version_id, thesis, stages, geographies, sectors,
    ticket_note, analysis_threshold, risk_posture) values
    ('${V1}', 'Tidlige klimaselskaber', '{seed,series_a}', '{nordics}', '{climate}',
     'Op til 1 mio. EUR', 70, 'Middel');
  insert into public.mandate_gates (config_version_id, gate_key, label, description, treatment,
    sort_order) values ('${V1}', 'geo', 'Norden', 'Selskabet er nordisk', 'hard', 1);
  insert into public.assessment_criteria (config_version_id, criterion_key, label, description,
    score_category, weight, sort_order) values
    ('${V1}', 'team', 'Team', 'x', 'team_market_fit', 25, 1),
    ('${V1}', 'market', 'Marked', 'x', 'market_timing', 25, 2),
    ('${V1}', 'product', 'Produkt', 'x', 'product_market_fit', 25, 3),
    ('${V1}', 'traction', 'Traktion', 'x', 'traction_gtm', 25, 4);
  update public.fund_config_versions set status = 'active', activated_at = now() where id = '${V1}';

  insert into public.companies (id, fund_id, name, website) values
    ('${COMPANY}', '${TEAM}', 'Alfa ApS', 'https://alfa.test');
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by) values
    ('${CASE}', '${TEAM}', '${COMPANY}', 'manual', '${ADMIN}');
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
  const name = `t1094_${(savepoints += 1)}`;
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

const crit = (key, weight, stage = null) => ({
  key,
  label: key,
  description: `${key} beskrevet`,
  category: "team_market_fit",
  weight,
  ...(stage ? { stage } : {}),
});
const SHARED = [crit("team", 25), crit("market", 25), crit("product", 25), crit("traction", 25)];
const GATES = [
  { key: "geo", label: "Norden", description: "Selskabet er nordisk", treatment: "hard" },
];

/** save_fund_config_draft with named arguments; `setup` undefined = an old caller. */
function save(client, draft, { criteria, gates = GATES, setup, risk = "Middel" }) {
  const args = [
    draft,
    "Stadieteamet",
    "Tidlige klimaselskaber",
    ["seed", "series_a"],
    ["nordics"],
    ["climate"],
    null,
    null,
    "",
    70,
    "partner_approval",
    risk,
    "venture",
    "{}",
    [],
    JSON.stringify(gates),
    JSON.stringify(criteria),
  ];
  const named = `_config_version_id => $1, _fund_name => $2, _thesis => $3, _stages => $4,
    _geographies => $5, _sectors => $6, _ticket_min_eur => $7, _ticket_max_eur => $8,
    _ticket_note => $9, _analysis_threshold => $10, _approval_mode => $11::public.fund_approval_mode,
    _risk_posture => $12, _strategy_type => $13, _stage_expectations => $14::jsonb,
    _dealbreakers => $15, _gates => $16::jsonb, _criteria => $17::jsonb`;
  if (setup === undefined) {
    return attempt(client, `select public.save_fund_config_draft(${named})`, args, { as: ADMIN });
  }
  return attempt(
    client,
    `select public.save_fund_config_draft(${named}, _setup => $18::jsonb)`,
    [...args, JSON.stringify(setup)],
    { as: ADMIN },
  );
}

async function rows(client, table, draft) {
  const key = table === "mandate_gates" ? "gate_key" : "criterion_key";
  return (
    await client.query(
      `select coalesce(stage, '-') || ':' || ${key} as k from public.${table}
       where config_version_id = $1 order by 1`,
      [draft],
    )
  ).rows.map((row) => row.k);
}

const activate = (client, draft) =>
  attempt(client, "select public.activate_fund_config($1)", [draft], { as: ADMIN, keep: false });

async function run(client) {
  const draft = (
    await attempt(client, "select public.create_fund_config_draft($1) as id", [V1], { as: ADMIN })
  ).rows[0]?.id;
  record("Admin laver en kladde af v1", Boolean(draft));

  // 1. Et gammelt kald (uden _setup) rører ikke stadiets rækker eller setup.
  await client.query(
    `insert into public.assessment_criteria (config_version_id, stage, criterion_key, label,
       description, score_category, weight, sort_order)
     values ($1, 'seed', 'team', 'Team', 'x', 'team_market_fit', 40, 9),
            ($1, 'seed', 'market', 'Marked', 'x', 'market_timing', 30, 10),
            ($1, 'seed', 'product', 'Produkt', 'x', 'product_market_fit', 30, 11)`,
    [draft],
  );
  await client.query(
    `update public.fund_mandates set setup = '{"about": "Vi er tekniske."}' where config_version_id = $1`,
    [draft],
  );
  const oldSave = await save(client, draft, {
    criteria: [crit("team", 50), crit("market", 50)],
  });
  record("Et gammelt kald gemmer kladden", oldSave.message === null, oldSave.message ?? "");
  record(
    "Et gammelt kald erstatter kun de delte kriterier; stadiets bliver",
    JSON.stringify(await rows(client, "assessment_criteria", draft)) ===
      JSON.stringify(["-:market", "-:team", "seed:market", "seed:product", "seed:team"]),
    JSON.stringify(await rows(client, "assessment_criteria", draft)),
  );
  const keptSetup = await one(
    client,
    "select setup from public.fund_mandates where config_version_id = $1",
    [draft],
  );
  record(
    "Et gammelt kald lader fund_mandates.setup stå",
    keptSetup.setup?.about === "Vi er tekniske.",
  );
  const stagedWithoutSetup = await save(client, draft, {
    criteria: [...SHARED, crit("team", 100, "seed")],
  });
  record(
    "Et stadie i et gammelt kald afvises",
    /pr\. stadie gemmes kun sammen med hele opsætningen/.test(stagedWithoutSetup.message ?? ""),
    stagedWithoutSetup.message ?? "ingen fejl",
  );

  // 2. Hele opsætningen: alle rækker erstattes, hver med sit stadie, og setup gemmes.
  const fullSave = await save(client, draft, {
    criteria: [
      ...SHARED,
      crit("team", 40, "seed"),
      crit("market", 30, "seed"),
      crit("traction", 30, "seed"),
    ],
    gates: [
      ...GATES,
      {
        key: "geo",
        label: "Danmark",
        description: "Kun danske",
        treatment: "review",
        stage: "seed",
      },
    ],
    setup: { about: "Klimahold", stages: { seed: { threshold: 60 }, series_a: {} } },
  });
  record("Hele opsætningen gemmes", fullSave.message === null, fullSave.message ?? "");
  record(
    "Alle kriterier er erstattet med inputtet, med stadie",
    JSON.stringify(await rows(client, "assessment_criteria", draft)) ===
      JSON.stringify([
        "-:market",
        "-:product",
        "-:team",
        "-:traction",
        "seed:market",
        "seed:team",
        "seed:traction",
      ]),
    JSON.stringify(await rows(client, "assessment_criteria", draft)),
  );
  record(
    "Samme regel-nøgle står delt og for stadiet",
    JSON.stringify(await rows(client, "mandate_gates", draft)) ===
      JSON.stringify(["-:geo", "seed:geo"]),
  );
  const savedSetup = await one(
    client,
    "select setup from public.fund_mandates where config_version_id = $1",
    [draft],
  );
  record(
    "setup er gemt",
    savedSetup.setup?.about === "Klimahold" && savedSetup.setup?.stages?.seed?.threshold === 60,
    JSON.stringify(savedSetup.setup),
  );
  const badStage = await save(client, draft, {
    criteria: [crit("team", 100, "series_z")],
    setup: {},
  });
  record("Et ukendt stadie afvises af databasen", Boolean(badStage.message), "ingen fejl");

  // 3. Udgiv: vægtene pr. stadie.
  const fine = await activate(client, draft);
  record(
    "En version med delte og egne kriterier (100 + 100) kan udgives",
    fine.message === null,
    fine.message ?? "",
  );
  await client.query(
    `update public.assessment_criteria set weight = 20
     where config_version_id = $1 and stage = 'seed' and criterion_key = 'traction'`,
    [draft],
  );
  const offStage = await activate(client, draft);
  record(
    "Et stadie, hvis vægte ikke summer til 100, stopper udgivelsen og nævnes",
    /stadiet seed skal summe til 100, men summerer til 90/.test(offStage.message ?? ""),
    offStage.message ?? "ingen fejl",
  );
  await client.query(
    `update public.assessment_criteria set weight = 30
     where config_version_id = $1 and stage = 'seed' and criterion_key = 'traction'`,
    [draft],
  );

  // 4. "Hvem er I" afløser risikotolerancen.
  await client.query(
    "update public.fund_mandates set risk_posture = '' where config_version_id = $1",
    [draft],
  );
  const aboutOnly = await activate(client, draft);
  record(
    "Uden risikotolerance, men med 'Hvem er I', kan versionen udgives",
    aboutOnly.message === null,
    aboutOnly.message ?? "",
  );
  await client.query(
    `update public.fund_mandates set setup = setup - 'about' where config_version_id = $1`,
    [draft],
  );
  const neither = await activate(client, draft);
  record(
    "Uden begge stopper udgivelsen som før",
    neither.message === "Risikotolerancen mangler.",
    neither.message ?? "ingen fejl",
  );
  await client.query(
    "update public.fund_mandates set risk_posture = 'Middel' where config_version_id = $1",
    [draft],
  );

  // 5. Specialisterne: hvert sæt for sig.
  const custom = (key, stage) => [
    `insert into public.fund_specialists (config_version_id, stage, specialist_key, kind, enabled,
       name, purpose, mandate, evidence_tests, risk_areas)
     values ($1, $2, $3, 'custom', true, 'Klimaspecialist', 'Vurderer klimaeffekten grundigt.',
       '{Vurdér effekten}', '{Målinger}', '{Grønvask}')`,
    [draft, stage, key],
  ];
  for (const [key, stage] of [
    ["custom_shared01", null],
    ["custom_shared02", null],
    ["custom_seed0001", "seed"],
    ["custom_seed0002", "seed"],
  ]) {
    await client.query(...custom(key, stage));
  }
  const perSet = await activate(client, draft);
  record(
    "To egne specialister delt og to for stadiet (4 i alt, grænsen er 3 pr. sæt) kan udgives",
    perSet.message === null,
    perSet.message ?? "",
  );
  await client.query(
    `insert into public.fund_specialists (config_version_id, stage, specialist_key, kind, enabled)
     select $1, 'series_a', k, 'standard', false
     from unnest(array['people_team', 'product_market_gtm', 'technology_risk', 'fund_finance_deal']) k`,
    [draft],
  );
  const emptyStage = await activate(client, draft);
  record(
    "Et stadie uden en eneste aktiv specialist stopper udgivelsen",
    emptyStage.message === "Mindst én specialist skal være aktiv i den dybe analyse.",
    emptyStage.message ?? "ingen fejl",
  );
  await client.query(
    "delete from public.fund_specialists where config_version_id = $1 and stage = 'series_a'",
    [draft],
  );
  await client.query(...custom("custom_seed0003", "seed"));
  await client.query(...custom("custom_seed0004", "seed"));
  const tooMany = await activate(client, draft);
  record(
    "Fire aktive egne specialister i ét stadie stopper udgivelsen",
    /Højst 3 egne specialister kan være aktive \(opsætningen har 4\)/.test(tooMany.message ?? ""),
    tooMany.message ?? "ingen fejl",
  );
  await client.query(
    "delete from public.fund_specialists where config_version_id = $1 and specialist_key in ('custom_seed0003', 'custom_seed0004')",
    [draft],
  );
  const published = await attempt(client, "select public.activate_fund_config($1)", [draft], {
    as: ADMIN,
  });
  record("Versionen udgives", published.message === null, published.message ?? "");
  const locked = await attempt(
    client,
    `update public.assessment_criteria set weight = 50
     where config_version_id = $1 and stage = 'seed' and criterion_key = 'team'`,
    [draft],
    { keep: false },
  );
  record("Den udgivne versions rækker pr. stadie er låst (0031)", Boolean(locked.message));

  // 6. Casesiden og caselisten: stadiet og økonomien.
  await client.query(
    `insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status,
       workflow_version, prompt_template_name, prompt_template_version, requested_by,
       raw_response, validation_result, input_evidence_ids, completed_at)
     values ($1, $2, $3, $4, 'screening', 'complete', 't', 't', 't', $5,
       '{"gates": [{"gateKey": "geo", "passed": false}]}', $6::jsonb, '{}', now())`,
    [
      RUN,
      TEAM,
      CASE,
      draft,
      ADMIN,
      JSON.stringify({
        model: "skjult",
        teamGateAnswers: [],
        setupStage: { stage: "seed", caseStage: null, reason: "unknown", assumed: true },
        economy: { stage: "seed", missingMode: "task", points: [], questions: [] },
      }),
    ],
  );
  const publicPart = await attempt(
    client,
    "select validation_public from public.analysis_runs where id = $1",
    [RUN],
    { as: MEMBER },
  );
  const shown = publicPart.rows[0]?.validation_public;
  record(
    "Et medlem ser stadiet og økonomien i validation_public, ikke modellen",
    shown?.setupStage?.assumed === true &&
      shown?.economy?.stage === "seed" &&
      !("model" in (shown ?? {})),
    publicPart.message ?? JSON.stringify(shown),
  );
  const list = await attempt(
    client,
    "select public.case_list_payload($1, $2, null) as payload",
    [TEAM, draft],
    { as: MEMBER },
  );
  const listed = list.rows[0]?.payload?.cases?.find((row) => row.id === CASE);
  record(
    "Caselisten sender screeningens stadie med",
    listed?.screening_setup_stage?.stage === "seed",
    list.message ?? JSON.stringify(listed ?? null),
  );
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
    `\n${results.passed} tjek af gem og udgiv pr. stadie som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
