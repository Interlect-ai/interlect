#!/usr/bin/env node
/**
 * Udenlandske selskabsregistre (0083, udvidet i 0084, 0086, 0087, og 0089): selskabets registernummer pr. land (højst ét af
 * dansk CVR og udenlandsk nummer), regnskaber med registrets land og nummerformat pr. land, de
 * nye kilder, at eksisterende danske rækker er uændrede, at registrets land ikke overskrives af
 * teksten, og at en bruger stadig ikke kan skrive regnskaber selv (0030).
 *
 *   npm run db:local -- fresh && npm run test:registries-db
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything runs in one transaction that is rolled
 * back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND = "a8510000-0000-4000-8000-00000000000a";
const ADMIN = "a8510000-0000-4000-8000-000000000001";
const COMPANY = "a8510000-0000-4000-8000-0000000000c1";
const CASE = "a8510000-0000-4000-8000-0000000000e1";

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(78)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs the statement in a savepoint; returns the SQLSTATE it failed with, or null. */
async function failsWith(client, sql, params = []) {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("release savepoint attempt");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return error.code ?? "unknown";
  }
}

const STATEMENT = `insert into public.financial_statements
  (fund_id, case_id, cvr_number, registry_country, period_start, period_end, currency,
   source_kind, source_document_url)
  values ($1, $2, $3, $4, '2025-01-01', '2025-12-31', $5, $6, 'https://example.test/regnskab')`;

async function companies(client) {
  const set = (number, country, cvr = null) =>
    failsWith(
      client,
      `update public.companies set registry_number = $2, registry_country = $3, cvr_number = $4
        where id = $1`,
      [COMPANY, number, country, cvr],
    );
  record(
    "Selskab: norsk org.nr. (9 cifre, 8/9 først) kan gemmes",
    (await set("998209218", "NO")) === null,
  );
  record("Selskab: svensk org.nr. (10 cifre) kan gemmes", (await set("5560360793", "SE")) === null);
  record("Selskab: norsk nummer med 8 cifre afvises", (await set("99820921", "NO")) === "23514");
  record(
    "Selskab: norsk nummer, der ikke starter med 8 eller 9, afvises",
    (await set("123456789", "NO")) === "23514",
  );
  record("Selskab: finsk Y-tunnus (1234567-8) kan gemmes", (await set("2336509-6", "FI")) === null);
  record(
    "Selskab: finsk nummer uden bindestreg afvises",
    (await set("23365096", "FI")) === "23514",
  );
  record(
    "Selskab: estisk registerkode (8 cifre) kan gemmes",
    (await set("12417834", "EE")) === null,
  );
  record("Selskab: estisk kode med 7 cifre afvises", (await set("1241783", "EE")) === "23514");
  record(
    "Selskab: lettisk reg.nr. (11 cifre, starter på 4) kan gemmes",
    (await set("40203050078", "LV")) === null,
  );
  record(
    "Selskab: lettisk personkode (starter på 0–3) afvises",
    (await set("01019012345", "LV")) === "23514",
  );
  record(
    "Selskab: litauisk selskabskode (9 cifre) kan gemmes",
    (await set("302767152", "LT")) === null,
  );
  record(
    "Selskab: litauisk personkode (11 cifre) afvises",
    (await set("38703181745", "LT")) === "23514",
  );
  record("Selskab: fransk SIREN (9 cifre) kan gemmes", (await set("794598813", "FR")) === null);
  record(
    "Selskab: fransk SIRET (14 cifre) afvises",
    (await set("79459881300057", "FR")) === "23514",
  );
  record("Selskab: polsk KRS (10 cifre) kan gemmes", (await set("0000019193", "PL")) === null);
  record("Selskab: polsk KRS uden nuller foran afvises", (await set("19193", "PL")) === "23514");
  record("Selskab: hollandsk KVK (8 cifre) kan gemmes", (await set("30204462", "NL")) === null);
  record(
    "Selskab: hollandsk vestigingsnummer (12 cifre) afvises",
    (await set("000037178598", "NL")) === "23514",
  );
  record("Selskab: nummer uden land afvises", (await set("998209218", null)) === "23514");
  record(
    "Selskab: tysk selskab med LEI (20 tegn) kan gemmes",
    (await set("529900DCE9HLEPY8MW24", "DE")) === null,
  );
  record(
    "Selskab: spansk selskab med LEI kan gemmes",
    (await set("2549007L3XEFOWWQIN72", "ES")) === null,
  );
  record(
    "Selskab: italiensk selskab med LEI kan gemmes",
    (await set("9845007360679F1CC223", "IT")) === null,
  );
  record(
    "Selskab: tysk HRB-nummer i stedet for LEI afvises",
    (await set("HRB 225439", "DE")) === "23514",
  );
  record(
    "Selskab: italiensk codice fiscale i stedet for LEI afvises",
    (await set("10927360015", "IT")) === "23514",
  );
  record(
    "Selskab: LEI med små bogstaver afvises",
    (await set("529900dce9hlepy8mw24", "DE")) === "23514",
  );
  record("Selskab: ukendt land afvises", (await set("998209218", "AT")) === "23514");
  record(
    "Selskab: dansk CVR og udenlandsk nummer på én gang afvises",
    (await set("998209218", "NO", "37561304")) === "23514",
  );
  record("Selskab: kun dansk CVR som før", (await set(null, null, "37561304")) === null);
}

async function statements(client) {
  const insert = (number, country, kind, currency = "NOK") =>
    failsWith(client, STATEMENT, [FUND, CASE, number, country, currency, kind]);
  // A Danish statement written like the code always has (no registry_country) is DK.
  await client.query(
    `insert into public.financial_statements
       (fund_id, case_id, cvr_number, period_start, period_end, source_document_url)
     values ($1, $2, '37561304', '2024-01-01', '2024-12-31', 'https://example.test/dk')`,
    [FUND, CASE],
  );
  const { rows } = await client.query(
    "select registry_country, source_kind, currency from public.financial_statements where cvr_number = '37561304'",
  );
  record(
    "Regnskab: en dansk række uden land er DK, XBRL og DKK som før",
    rows[0]?.registry_country === "DK" &&
      rows[0]?.source_kind === "xbrl_structured" &&
      rows[0]?.currency === "DKK",
    JSON.stringify(rows[0]),
  );
  record(
    "Regnskab: norsk fra Regnskapsregisteret (JSON) kan gemmes",
    (await insert("998209218", "NO", "registry_json")) === null,
  );
  record(
    "Regnskab: svensk iXBRL kan gemmes",
    (await insert("5560360793", "SE", "ixbrl_structured", "SEK")) === null,
  );
  record(
    "Regnskab: finsk XBRL kan gemmes",
    (await insert("0100379-9", "FI", "xbrl_structured", "EUR")) === null,
  );
  record(
    "Regnskab: lettiske åbne data kan gemmes",
    (await insert("40203050078", "LV", "registry_json", "EUR")) === null,
  );
  record(
    "Regnskab: estisk kode kan gemmes",
    (await insert("12417834", "EE", "registry_json", "EUR")) === null,
  );
  record(
    "Regnskab: litauiske åbne data (Registrų centras) kan gemmes",
    (await insert("302767152", "LT", "registry_json", "EUR")) === null,
  );
  record(
    "Regnskab: litauisk kode med 8 cifre afvises",
    (await insert("30276715", "LT", "registry_json", "EUR")) === "23514",
  );
  record(
    "Regnskab: finsk nummer uden bindestreg afvises",
    (await insert("01003799", "FI", "xbrl_structured", "EUR")) === "23514",
  );
  record(
    "Regnskab: lettisk personkode afvises",
    (await insert("01019012345", "LV", "registry_json", "EUR")) === "23514",
  );
  record(
    "Regnskab: franske åbne data (INPI) kan gemmes",
    (await insert("794598813", "FR", "registry_json", "EUR")) === null,
  );
  record(
    "Regnskab: polsk KRS kan gemmes",
    (await insert("0000019193", "PL", "registry_json", "PLN")) === null,
  );
  record(
    "Regnskab: hollandsk KVK kan gemmes",
    (await insert("30204462", "NL", "registry_json", "EUR")) === null,
  );
  record(
    "Regnskab: fransk nummer med 8 cifre afvises",
    (await insert("79459881", "FR", "registry_json", "EUR")) === "23514",
  );
  record(
    "Regnskab: norsk nummer med 8 cifre afvises",
    (await insert("37561304", "NO", "registry_json")) === "23514",
  );
  record(
    "Regnskab: dansk nummer med 9 cifre afvises",
    (await insert("998209218", "DK", "xbrl_structured")) === "23514",
  );
  record(
    "Regnskab: ukendt kilde afvises",
    (await insert("998209218", "NO", "ai_guess")) === "23514",
  );
  record(
    "Regnskab: ukendt land afvises",
    (await insert("998209218", "AT", "registry_json")) === "23514",
  );
  record(
    "Regnskab: tyske regnskaber gemmes ikke (ingen gratis kilde, T-854)",
    (await insert("529900DCE9HLEPY8MW24", "DE", "registry_json", "EUR")) === "23514",
  );
  const { rows: upserted } = await client.query(
    `insert into public.financial_statements
       (fund_id, case_id, cvr_number, registry_country, period_start, period_end, currency,
        source_kind, source_document_url)
     values ($1, $2, '998209218', 'NO', '2025-01-01', '2025-12-31', 'NOK', 'registry_json',
             'https://data.brreg.no/regnskapsregisteret/regnskap/998209218/2')
     on conflict (case_id, cvr_number, period_end)
       do update set source_document_url = excluded.source_document_url
     returning source_document_url`,
    [FUND, CASE],
  );
  record(
    "Regnskab: hentes året igen, opdateres samme række (samme nøgle som DK)",
    upserted[0]?.source_document_url.endsWith("/2"),
    JSON.stringify(upserted[0]),
  );
}

/** The registry's country is not overwritten by the company's free text (0080's trigger). */
async function country(client) {
  await client.query(
    `update public.companies
        set cvr_number = null, registry_country = 'NO', registry_number = '998209218',
            hq_country = 'NO', profile_source = '{"hq_country": "registry"}'::jsonb
      where id = $1`,
    [COMPANY],
  );
  await client.query("update public.companies set geography = 'Stockholm' where id = $1", [
    COMPANY,
  ]);
  const { rows } = await client.query("select hq_country from public.companies where id = $1", [
    COMPANY,
  ]);
  record(
    "Registrets land overskrives ikke af teksten",
    rows[0]?.hq_country === "NO",
    JSON.stringify(rows[0]),
  );
}

async function asUser(client) {
  await client.query("savepoint as_user");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ADMIN, role: "authenticated" }),
    ]);
    const { rows } = await client.query(
      "select registry_country, cvr_number from public.financial_statements where case_id = $1 order by 1, 2",
      [CASE],
    );
    record(
      "Som bruger: fondens norske og danske regnskaber kan læses",
      rows.some((row) => row.registry_country === "NO") &&
        rows.some((row) => row.registry_country === "DK"),
      JSON.stringify(rows),
    );
    const code = await failsWith(client, STATEMENT, [
      FUND,
      CASE,
      "998209218",
      "NO",
      "NOK",
      "registry_json",
    ]);
    record("Som bruger: regnskaber kan stadig ikke skrives direkte (0030)", code === "42501", code);
  } finally {
    await client.query("rollback to savepoint as_user");
  }
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users (id, email) values ('${ADMIN}', 'registries-admin@interlect.test');
       insert into public.funds (id, name, slug) values ('${FUND}', 'Registre', 'registre');
       insert into public.fund_memberships (fund_id, user_id) values ('${FUND}', '${ADMIN}');
       insert into public.fund_membership_roles (membership_id, role)
       select id, 'admin'::public.app_role from public.fund_memberships where user_id = '${ADMIN}';
       insert into public.companies (id, fund_id, name) values ('${COMPANY}', '${FUND}', 'Spond AS');
       insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
       values ('${CASE}', '${FUND}', '${COMPANY}', 'manual', '${ADMIN}');`,
    );
    await companies(client);
    await statements(client);
    await country(client);
    await asUser(client);
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
