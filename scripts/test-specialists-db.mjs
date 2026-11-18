#!/usr/bin/env node
/**
 * Fondens eget sæt af specialister i databasen: hvem må læse og skrive, formen på
 * en egen specialist, reglerne ved udgivelse (mindst én aktiv, højst N egne pr. installation),
 * låsning efter udgivelse og kopien til en ny kladde.
 *
 *   npm run db:local -- fresh && npm run test:specialists-db
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
const MEMBER_A = "a3000000-0000-4000-8000-000000000002";
const ADMIN_B = "b3000000-0000-4000-8000-000000000001";
const DRAFT_A = "a3000000-0000-4000-8000-0000000000c1";
const ACTIVE_A = "a3000000-0000-4000-8000-0000000000c2";
const KEY = "custom_impact00001";

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN_A}', 'spec-admin-a@interlect.test'),
    ('${MEMBER_A}', 'spec-member-a@interlect.test'),
    ('${ADMIN_B}', 'spec-admin-b@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${FUND_A}', 'Specialist fond A', 'specialist-fond-a'),
    ('${FUND_B}', 'Specialist fond B', 'specialist-fond-b');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${FUND_A}', '${ADMIN_A}'), ('${FUND_A}', '${MEMBER_A}'), ('${FUND_B}', '${ADMIN_B}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, r.role::public.app_role
  from public.fund_memberships m
  join (values ('${ADMIN_A}', 'admin'), ('${MEMBER_A}', 'member'), ('${ADMIN_B}', 'admin'))
    as r(user_id, role) on r.user_id::uuid = m.user_id;
  insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
  values ('${DRAFT_A}', '${FUND_A}', 1, 'spec', 'test');
`;

const CUSTOM_COLUMNS =
  "config_version_id, specialist_key, kind, name, purpose, mandate, evidence_tests, risk_areas, research_questions, output_focus, categories";

function customValues(config, key, overrides = {}) {
  const row = {
    name: "'Impact og klima'",
    purpose: "'Vurderer selskabets dokumenterede klimaeffekt.'",
    mandate: "array['Vurder CO2-effekten']",
    evidence_tests: "array['Livscyklusanalyse eller målte tal']",
    risk_areas: "array['greenwashing']",
    research_questions: "array['Hvilke målte klimatal har selskabet?']",
    output_focus: "array['Klimaeffekt pr. kunde']",
    categories: "array['product_technology']",
    ...overrides,
  };
  return `('${config}', '${key}', 'custom', ${row.name}, ${row.purpose}, ${row.mandate}, ${row.evidence_tests}, ${row.risk_areas}, ${row.research_questions}::text[], ${row.output_focus}::text[], ${row.categories}::text[])`;
}

function insertCustom(config, key, overrides) {
  return `insert into public.fund_specialists (${CUSTOM_COLUMNS}) values ${customValues(config, key, overrides)}`;
}

const results = { passed: 0, failures: [] };

function record(name, ok, detail = "") {
  console.log(`${name.padEnd(76)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user (like PostgREST) inside a savepoint that is rolled back. */
async function asUser(client, userId, sql, params = []) {
  await client.query("savepoint spec_user");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await client.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount, error: null };
  } catch (cause) {
    return { rows: [], rowCount: 0, error: cause };
  } finally {
    await client.query("rollback to savepoint spec_user");
  }
}

/** Runs sql as postgres inside a savepoint that is rolled back; returns true or the problem. */
async function expectError(client, sql, pattern) {
  await client.query("savepoint spec_err");
  try {
    await client.query(sql);
    return "ingen fejl";
  } catch (cause) {
    return pattern.test(cause.message) ? true : cause.message;
  } finally {
    await client.query("rollback to savepoint spec_err");
  }
}

async function succeeds(client, sql) {
  await client.query("savepoint spec_ok");
  try {
    await client.query(sql);
    return true;
  } catch (cause) {
    return cause.message;
  } finally {
    await client.query("rollback to savepoint spec_ok");
  }
}

async function setting(client) {
  console.log("\nIndstilling pr. installation");
  const { rows } = await client.query("select max_custom_specialists from public.ai_settings");
  record("Standard er højst 3 egne specialister", rows[0]?.max_custom_specialists === 3);
  const tooMany = await expectError(
    client,
    "update public.ai_settings set max_custom_specialists = 7",
    /check/i,
  );
  record("Grænsen kan højst sættes til 6", tooMany === true, String(tooMany));
}

async function rights(client) {
  console.log("\nRettigheder");
  const asAdmin = await asUser(client, ADMIN_A, `${insertCustom(DRAFT_A, KEY)} returning id`);
  record(
    "Admin kan lave en egen specialist i kladden",
    asAdmin.rowCount === 1,
    asAdmin.error?.message,
  );
  const asMember = await asUser(client, MEMBER_A, insertCustom(DRAFT_A, KEY));
  record(
    "Et Medlem kan ikke ændre fondens specialister",
    asMember.error?.code === "42501",
    asMember.error?.message ?? "ingen fejl",
  );
  const otherFund = await asUser(client, ADMIN_B, insertCustom(DRAFT_A, KEY));
  record(
    "Admin i en anden fond kan ikke skrive i fondens kladde",
    otherFund.error?.code === "42501",
    otherFund.error?.message ?? "ingen fejl",
  );

  await client.query(insertCustom(DRAFT_A, KEY));
  const memberRead = await asUser(
    client,
    MEMBER_A,
    "select specialist_key from public.fund_specialists",
  );
  record("Et Medlem kan læse fondens specialister", memberRead.rows.length === 1);
  const otherRead = await asUser(
    client,
    ADMIN_B,
    "select specialist_key from public.fund_specialists",
  );
  record("En anden fond kan ikke læse dem", otherRead.rows.length === 0);
  await client.query(`delete from public.fund_specialists where config_version_id = '${DRAFT_A}'`);
}

async function shape(client) {
  console.log("\nFormen på en specialist");
  const cases = [
    ["En nøgle uden custom_ afvises", insertCustom(DRAFT_A, "impact")],
    ["Et for kort navn afvises", insertCustom(DRAFT_A, KEY, { name: "'Ab'" })],
    ["Et tomt mandat afvises", insertCustom(DRAFT_A, KEY, { mandate: "'{}'::text[]" })],
    [
      "Et mandat med 13 punkter afvises",
      insertCustom(DRAFT_A, KEY, { mandate: "array_fill('Punkt'::text, array[13])" }),
    ],
    ["Et tomt punkt afvises", insertCustom(DRAFT_A, KEY, { risk_areas: "array['  ']" })],
    ["Et ukendt scoreområde afvises", insertCustom(DRAFT_A, KEY, { categories: "array['esg']" })],
    [
      "Det samme scoreområde to gange afvises",
      insertCustom(DRAFT_A, KEY, { categories: "array['market_timing','market_timing']" }),
    ],
    [
      "Syv spørgsmål afvises",
      insertCustom(DRAFT_A, KEY, { research_questions: "array_fill('Spørgsmål'::text, array[7])" }),
    ],
    [
      "En standardspecialist med egen tekst afvises",
      `insert into public.fund_specialists (config_version_id, specialist_key, kind, name)
       values ('${DRAFT_A}', 'people_team', 'standard', 'Mit team')`,
    ],
    [
      "En ukendt standardspecialist afvises",
      `insert into public.fund_specialists (config_version_id, specialist_key, kind)
       values ('${DRAFT_A}', 'esg_team', 'standard')`,
    ],
  ];
  for (const [name, sql] of cases) {
    const outcome = await expectError(client, sql, /check constraint/i);
    record(name, outcome === true, String(outcome));
  }
  const fine = await succeeds(
    client,
    `${insertCustom(DRAFT_A, KEY, { research_questions: "'{}'", output_focus: "'{}'", categories: "'{}'" })};
     insert into public.fund_specialists (config_version_id, specialist_key, kind, enabled)
     values ('${DRAFT_A}', 'technology_risk', 'standard', false)`,
  );
  record(
    "En egen specialist uden spørgsmål og områder og et fravalg er gyldige",
    fine === true,
    String(fine),
  );
}

const ACTIVATE = `update public.fund_config_versions set status = 'active' where id = '${DRAFT_A}'`;

function switchOffStandard(keys) {
  return `insert into public.fund_specialists (config_version_id, specialist_key, kind, enabled)
    select '${DRAFT_A}', key, 'standard', false from unnest(array[${keys.map((key) => `'${key}'`).join(",")}]) as t(key)`;
}

async function publishRules(client) {
  console.log("\nReglerne ved udgivelse");
  const all = ["people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"];
  const none = await expectError(client, `${switchOffStandard(all)}; ${ACTIVATE}`, /Mindst én/);
  record("En version uden aktive specialister kan ikke udgives", none === true, String(none));

  const fourCustom = [1, 2, 3, 4]
    .map((n) => customValues(DRAFT_A, `custom_impact0000${n}`))
    .join(", ");
  const tooMany = await expectError(
    client,
    `insert into public.fund_specialists (${CUSTOM_COLUMNS}) values ${fourCustom}; ${ACTIVATE}`,
    /Højst 3 egne/,
  );
  record(
    "Fire aktive egne specialister kan ikke udgives (højst 3)",
    tooMany === true,
    String(tooMany),
  );

  const fourWithOneOff = await succeeds(
    client,
    `insert into public.fund_specialists (${CUSTOM_COLUMNS}) values ${fourCustom};
     update public.fund_specialists set enabled = false where specialist_key = 'custom_impact00004';
     ${ACTIVATE}`,
  );
  record("Tre aktive og én slået fra kan udgives", fourWithOneOff === true, String(fourWithOneOff));

  const lowered = await expectError(
    client,
    `update public.ai_settings set max_custom_specialists = 1;
     insert into public.fund_specialists (${CUSTOM_COLUMNS}) values
       ${customValues(DRAFT_A, "custom_impact00001")}, ${customValues(DRAFT_A, "custom_impact00002")};
     ${ACTIVATE}`,
    /Højst 1 egne/,
  );
  record("Grænsen pr. installation styrer reglen (sat til 1)", lowered === true, String(lowered));

  const oneStandardTwoOwn = await succeeds(
    client,
    `${switchOffStandard(["people_team", "product_market_gtm", "technology_risk"])};
     insert into public.fund_specialists (${CUSTOM_COLUMNS}) values
       ${customValues(DRAFT_A, "custom_impact00001")}, ${customValues(DRAFT_A, "custom_impact00002")};
     ${ACTIVATE}`,
  );
  record("1 standard + 2 egne kan udgives", oneStandardTwoOwn === true, String(oneStandardTwoOwn));

  const onlyOwn = await succeeds(
    client,
    `${switchOffStandard(all)}; ${insertCustom(DRAFT_A, KEY)}; ${ACTIVATE}`,
  );
  record("Kun én egen specialist kan udgives", onlyOwn === true, String(onlyOwn));
}

async function lockedAndCopied(client) {
  console.log("\nLåst efter udgivelse og kopieret til næste kladde");
  // An active version with a switched-off module and one own specialist.
  await client.query(`
    insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
    values ('${ACTIVE_A}', '${FUND_A}', 2, 'spec', 'test');
    ${insertCustom(ACTIVE_A, KEY)};
    insert into public.fund_specialists (config_version_id, specialist_key, kind, enabled)
    values ('${ACTIVE_A}', 'technology_risk', 'standard', false);
    delete from public.fund_config_versions where id = '${DRAFT_A}';
    update public.fund_config_versions set status = 'active' where id = '${ACTIVE_A}';
  `);
  const update = await expectError(
    client,
    `update public.fund_specialists set name = 'Nyt navn' where config_version_id = '${ACTIVE_A}'`,
    /uforanderlige/,
  );
  record(
    "En udgivet specialist kan ikke ændres (heller ikke af serveren)",
    update === true,
    String(update),
  );
  const remove = await expectError(
    client,
    `delete from public.fund_specialists where config_version_id = '${ACTIVE_A}'`,
    /uforanderlige/,
  );
  record("En udgivet specialist kan ikke slettes", remove === true, String(remove));
  const insert = await expectError(
    client,
    insertCustom(ACTIVE_A, "custom_late000001"),
    /uforanderlige/,
  );
  record(
    "Der kan ikke komme nye specialister i en udgivet version",
    insert === true,
    String(insert),
  );
  const userEdit = await asUser(
    client,
    ADMIN_A,
    `update public.fund_specialists set enabled = false where config_version_id = '${ACTIVE_A}' returning id`,
  );
  record("Admin kan ikke rette i en udgivet version", userEdit.rowCount === 0);

  await client.query("savepoint spec_draft");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN_A]);
  const { rows } = await client.query("select public.create_fund_config_draft($1) as id", [
    ACTIVE_A,
  ]);
  await client.query("reset role");
  const draftId = rows[0].id;
  const copied = await client.query(
    `select specialist_key, kind, enabled, name, categories from public.fund_specialists
     where config_version_id = $1 order by specialist_key`,
    [draftId],
  );
  record(
    "En ny kladde kopierer specialisterne med samme nøgle og valg",
    copied.rows.length === 2 &&
      copied.rows[0].specialist_key === KEY &&
      copied.rows[0].enabled === true &&
      copied.rows[0].name === "Impact og klima" &&
      copied.rows[1].specialist_key === "technology_risk" &&
      copied.rows[1].enabled === false,
    JSON.stringify(copied.rows),
  );
  const editDraft = await asUser(
    client,
    ADMIN_A,
    `update public.fund_specialists set enabled = false where config_version_id = '${draftId}' and specialist_key = '${KEY}' returning id`,
  );
  record("Kladden kan rettes igen", editDraft.rowCount === 1, editDraft.error?.message);
  await client.query("rollback to savepoint spec_draft");
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(SEED);
    await setting(client);
    await rights(client);
    await shape(client);
    await publishRules(client);
    await lockedAndCopied(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }

  console.log(
    `\n${results.passed} specialisttjek som forventet, ${results.failures.length} afvigelser.`,
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
