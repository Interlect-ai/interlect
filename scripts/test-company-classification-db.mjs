#!/usr/bin/env node
/**
 * Sektor og land som nøgler ud fra selskabets tekst: de rene funktioner mod en
 * facitliste, triggeren ved oprettelse og ændring (et menneskes og CVR's valg overskrives aldrig),
 * en case oprettet som bruger, og engangsopdateringen af selskaber, der fandtes før.
 *
 *   npm run db:local -- fresh && npm run test:classification-db
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything runs in one transaction that is rolled
 * back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND = "a8080000-0000-4000-8000-00000000000a";
const ADMIN = "a8080000-0000-4000-8000-000000000001";

/** Free text → sector key (null: no known word, counted as unknown on Overblik). */
const SECTORS = [
  ["fintech", "fintech"],
  ["marketplace", "consumer_marketplace"],
  ["deeptech", "deeptech_hardware"],
  ["healthtech", "healthtech"],
  ["b2b_saas", "software_b2b"],
  ["climate", "climate_energy"],
  // The branch wins over the general "B2B-software"; then the first named.
  ["B2B-software / fintech (udgiftsstyring og betalingsløsninger til virksomheder)", "fintech"],
  ["Fremstilling af spil og legetøj", "media_gaming"],
  ["AI-platform til machine learning i virksomheder", "software_b2b"],
  ["Windows-værktøjer til udviklere", "software_b2b"],
  ["Edtech-platform for skoler", "edtech"],
  ["Robotter til lagerlogistik", "robotics_manufacturing"],
  ["Cybersikkerhed for SMV'er", "security"],
  ["Batterier til elbiler", "climate_energy"],
  ["Plantebaserede fødevarer", "foodtech"],
  ["PropTech: udlejning af boliger", "proptech"],
  // Whole words only: these must not be guessed into a branch they only resemble.
  ["Workflow automation for HR", "software_b2b"],
  ["Automatisering af bogføring for SMV'er", "fintech"],
  ["Hospitality tech", null],
  ["Healthy food delivery", "foodtech"],
  ["Bæredygtig mode", null],
  ["Sustainable fashion marketplace", "consumer_marketplace"],
  ["Data platform for retail banks", "fintech"],
  ["Retail analytics SaaS", "software_b2b"],
  ["Cryptography for IoT", null],
  ["Bankruptcy services", null],
  ["Coworking space operator", null],
  ["Data streaming platform", "software_b2b"],
  ["Mediation platform", "software_b2b"],
  ["Pension savings app", "fintech"],
  ["Computerprogrammering", "software_b2b"],
  ["Konsulentvirksomhed", null],
  ["Andet", null],
  ["", null],
  [null, null],
];

/** Free text → country of the head office (null: none, or only a region). */
const COUNTRIES = [
  ["DK", "DK"],
  ["FI", "FI"],
  [" se ", "SE"],
  ["Danmark (København)", "DK"],
  ["Stockholm, Sverige", "SE"],
  ["Copenhagen HQ, expanding to Sweden", "DK"],
  ["Rhode Island", null],
  ["Oslo", "NO"],
  ["London, UK", "GB"],
  ["Cambridge, MA, USA", "US"],
  ["Long Island, New York", "US"],
  // Several countries: only the head office counts, else unknown.
  ["Kunder i Sverige og Norge, hovedkontor i København", "DK"],
  ["København HQ, kunder i hele Norden", "DK"],
  ["HQ: Oslo, kontor i Stockholm", "NO"],
  ["Headquartered in Berlin, offices in London", "DE"],
  ["Founded in Helsinki, HQ in London", "GB"],
  ["Stockholm and Oslo", null],
  ["Danmark og Sverige", null],
  ["Latin American markets", null],
  ["Norden", null],
  ["Europa", null],
  ["XX", null],
  ["", null],
  [null, null],
];

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(78)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function company(client, id) {
  const { rows } = await client.query(
    "select sector_key, hq_country, profile_source from public.companies where id = $1",
    [id],
  );
  return rows[0];
}

async function pure(client) {
  for (const [text, expected] of SECTORS) {
    const { rows } = await client.query("select private.company_sector_key($1) as key", [text]);
    record(`Sektor: ${JSON.stringify(text)} → ${expected}`, rows[0].key === expected, rows[0].key);
  }
  for (const [text, expected] of COUNTRIES) {
    const { rows } = await client.query("select private.company_country_code($1) as code", [text]);
    record(`Land: ${JSON.stringify(text)} → ${expected}`, rows[0].code === expected, rows[0].code);
  }
}

async function trigger(client) {
  const id = "a8080000-0000-4000-8000-0000000000c1";
  await client.query(
    `insert into public.companies (id, fund_id, name, sector, geography)
     values ($1, $2, 'Solsejl ApS', 'Solenergi til landbrug', 'Aarhus, Danmark')`,
    [id, FUND],
  );
  let row = await company(client, id);
  record(
    "Ny: sektor og land fra teksten, kilde text",
    row.sector_key === "climate_energy" &&
      row.hq_country === "DK" &&
      row.profile_source.sector_key === "text" &&
      row.profile_source.hq_country === "text",
    JSON.stringify(row),
  );

  await client.query(
    "update public.companies set sector = 'Betalinger', geography = 'Oslo' where id = $1",
    [id],
  );
  row = await company(client, id);
  record(
    "Ændret tekst: nøglerne følger med",
    row.sector_key === "fintech" && row.hq_country === "NO",
    JSON.stringify(row),
  );

  await client.query(
    "update public.companies set sector = 'Konsulent', geography = 'Norden' where id = $1",
    [id],
  );
  row = await company(client, id);
  record(
    "Tekst uden kendt ord: ingen nøgle og ingen kilde (ukendt, intet gæt)",
    row.sector_key === null &&
      row.hq_country === null &&
      !("sector_key" in row.profile_source) &&
      !("hq_country" in row.profile_source),
    JSON.stringify(row),
  );

  // A human's choice stays, also when the text changes.
  await client.query(
    `update public.companies set sector_key = 'other', hq_country = null,
       profile_source = '{"sector_key": "human", "hq_country": "human"}'::jsonb where id = $1`,
    [id],
  );
  await client.query(
    "update public.companies set sector = 'Fintech', geography = 'Danmark' where id = $1",
    [id],
  );
  row = await company(client, id);
  record(
    "Et menneskes sektor og land overskrives aldrig",
    row.sector_key === "other" && row.hq_country === null,
    JSON.stringify(row),
  );

  // CVR's country stays when the text names another one.
  const cvr = "a8080000-0000-4000-8000-0000000000c2";
  await client.query(
    `insert into public.companies (id, fund_id, name, geography, hq_country, profile_source)
     values ($1, $2, 'CVR ApS', 'Stockholm', 'DK', '{"hq_country": "cvr"}'::jsonb)`,
    [cvr, FUND],
  );
  await client.query("update public.companies set geography = 'Berlin' where id = $1", [cvr]);
  row = await company(client, cvr);
  record("CVR's land overskrives ikke af teksten", row.hq_country === "DK", JSON.stringify(row));

  // A country 0019 derived from the text ("backfill") follows the text like "text".
  const old0019 = "a8080000-0000-4000-8000-0000000000c4";
  await client.query(
    `insert into public.companies (id, fund_id, name, geography, hq_country, profile_source)
     values ($1, $2, '0019 ApS', 'Stockholm', 'SE', '{"hq_country": "backfill"}'::jsonb)`,
    [old0019, FUND],
  );
  await client.query("update public.companies set geography = 'Helsinki' where id = $1", [old0019]);
  row = await company(client, old0019);
  record(
    "Et land fra 0019 (backfill) følger teksten",
    row.hq_country === "FI" && row.profile_source.hq_country === "text",
    JSON.stringify(row),
  );

  // An explicit country without a new source stays (only a changed text re-derives it).
  const set = "a8080000-0000-4000-8000-0000000000c3";
  await client.query(
    `insert into public.companies (id, fund_id, name, geography) values ($1, $2, 'Sat ApS', 'Oslo')`,
    [set, FUND],
  );
  await client.query("update public.companies set hq_country = 'SE' where id = $1", [set]);
  row = await company(client, set);
  record(
    "Et land sat direkte står, til teksten ændres",
    row.hq_country === "SE",
    JSON.stringify(row),
  );
}

/** As a signed-in user (like PostgREST): the RPC behind Opret case, then the trigger. */
async function asUser(client) {
  await client.query("savepoint as_user");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ADMIN, role: "authenticated" }),
    ]);
    const { rows } = await client.query(
      `select public.create_manual_case_for_fund($1, 'Brugerens selskab', null, 'unknown',
         'Healthtech / diagnostik', 'Helsinki, Finland', '', '[]'::jsonb) as id`,
      [FUND],
    );
    await client.query("reset role");
    const { rows: keys } = await client.query(
      `select co.sector_key, co.hq_country from public.cases c
         join public.companies co on co.id = c.company_id where c.id = $1`,
      [rows[0].id],
    );
    record(
      "Opret case som bruger: nøglerne sættes (triggeren kører med egne rettigheder)",
      keys[0]?.sector_key === "healthtech" && keys[0]?.hq_country === "FI",
      JSON.stringify(keys[0]),
    );
    await client.query("savepoint deny");
    let denied = false;
    try {
      await client.query("set local role authenticated");
      await client.query("select private.company_sector_key('fintech')");
    } catch (error) {
      denied = error.code === "42501";
    }
    await client.query("rollback to savepoint deny");
    record("Brugere kan ikke kalde klassifikationen direkte", denied);
  } finally {
    await client.query("rollback to savepoint as_user");
  }
}

/** Companies from before 0080 (trigger off while they are written) get their keys once. */
async function backfill(client) {
  await client.query("alter table public.companies disable trigger companies_classify");
  const old = "a8080000-0000-4000-8000-0000000000d1";
  const human = "a8080000-0000-4000-8000-0000000000d2";
  await client.query(
    `insert into public.companies (id, fund_id, name, sector, geography, profile_source) values
       ($1, $3, 'Gammel ApS', 'fintech', 'SE', '{}'::jsonb),
       ($2, $3, 'Valgt ApS', 'fintech', 'SE', '{"sector_key": "human", "hq_country": "human"}'::jsonb)`,
    [old, human, FUND],
  );
  await client.query("alter table public.companies enable trigger companies_classify");
  const { rows } = await client.query("select * from private.companies_classify_backfill()");
  const oldRow = await company(client, old);
  const humanRow = await company(client, human);
  record(
    "Engangsopdatering: gamle selskaber får nøgler, et menneskes valg røres ikke",
    oldRow.sector_key === "fintech" &&
      oldRow.hq_country === "SE" &&
      humanRow.sector_key === null &&
      humanRow.hq_country === null,
    JSON.stringify({ oldRow, humanRow }),
  );
  const again = await client.query("select * from private.companies_classify_backfill()");
  record(
    "Engangsopdateringen kan køres igen uden at ændre noget",
    rows[0].sectors >= 1 && again.rows[0].sectors === 0 && again.rows[0].countries === 0,
    JSON.stringify({ first: rows[0], again: again.rows[0] }),
  );
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users (id, email) values ('${ADMIN}', 'class-admin@interlect.test');
       insert into public.funds (id, name, slug) values ('${FUND}', 'Klassifikation', 'klassifikation');
       insert into public.fund_memberships (fund_id, user_id) values ('${FUND}', '${ADMIN}');
       insert into public.fund_membership_roles (membership_id, role)
       select id, 'admin'::public.app_role from public.fund_memberships where user_id = '${ADMIN}';`,
    );
    await pure(client);
    await trigger(client);
    await asUser(client);
    await backfill(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(`\n${results.passed} tjek som forventet, ${results.failures.length} afvigelser.`);
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
