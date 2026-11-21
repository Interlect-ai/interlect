#!/usr/bin/env node
/**
 * Tese-funktionerne (spec, §3, §4.7):
 * create_thesis, create_thesis_from (nu for authenticated), rename_thesis, set_default_thesis,
 * archive_thesis og reactivate_thesis. Rettigheder (Admin og Lead; ikke Medlem eller en udenfor),
 * navneregler, standardtesen, "mindst én aktiv tese", arkivér/genaktivér uden at slette noget,
 * auditlinjer, og at Cases-listen sender hver cases tese og aktive version med.
 *
 *   npm run db:local -- fresh && npm run test:thesis-functions-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (suffix) => `a1047000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const TEAM = id("f1");
const OTHER_TEAM = id("f2");
const ADMIN = id("a1");
const LEAD = id("a2");
const MEMBER = id("a3");
const OUTSIDER = id("a4");
const V1 = id("c1");
const ALFA = id("b1");
const CASE_ALFA = id("d1");

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 't1047-admin@interlect.test'),
    ('${LEAD}', 't1047-lead@interlect.test'),
    ('${MEMBER}', 't1047-member@interlect.test'),
    ('${OUTSIDER}', 't1047-outsider@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${TEAM}', 'Nordisk Kapital', 't1047-a'),
    ('${OTHER_TEAM}', 'Andet team', 't1047-b');
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
  await client.query("savepoint t1047");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query(sql, params);
    await client.query("reset role");
    await client.query(keep ? "release savepoint t1047" : "rollback to savepoint t1047");
    return { rows: result.rows, message: null };
  } catch (cause) {
    await client.query("rollback to savepoint t1047");
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
  const first = await one(
    client,
    "select id, status, is_default from public.fund_theses where fund_id = $1",
    [TEAM],
  );
  record("Teamets første tese er aktiv og standard", first.status === "active" && first.is_default);

  // Opret: Admin og Lead, ikke Medlem eller en udenfor.
  const memberCreate = await as(client, MEMBER, "select public.create_thesis($1, 'Klima')", [TEAM]);
  record("Medlem kan ikke oprette en tese", /Admin eller Lead/.test(memberCreate.message ?? ""));
  const outsiderCreate = await as(client, OUTSIDER, "select public.create_thesis($1, 'Klima')", [
    TEAM,
  ]);
  record("En udenfor teamet kan ikke oprette en tese", outsiderCreate.message !== null);
  const created = await as(
    client,
    LEAD,
    "select public.create_thesis($1, ' Klima growth ') as id",
    [TEAM],
  );
  const klima = created.rows[0]?.id;
  const klimaRow = klima ? await thesis(client, klima) : null;
  record(
    "Lead opretter en tom tese som kladde, navnet trimmet",
    klimaRow?.status === "draft" && klimaRow?.name === "Klima growth" && !klimaRow?.is_default,
    created.message ?? "",
  );
  record(
    "Oprettelsen står i auditloggen",
    (await audits(client, "fund_thesis_created", klima)) === 1,
  );
  const duplicate = await as(client, ADMIN, "select public.create_thesis($1, 'KLIMA GROWTH')", [
    TEAM,
  ]);
  record(
    "Samme navn (uanset store bogstaver) afvises",
    /med det navn/.test(duplicate.message ?? ""),
  );
  const tooShort = await as(client, ADMIN, "select public.create_thesis($1, 'x')", [TEAM]);
  record("Et navn på under 2 tegn afvises", /2-80 tegn/.test(tooShort.message ?? ""));

  // Kopi: authenticated må nu kalde create_thesis_from.
  const copied = await as(
    client,
    ADMIN,
    "select public.create_thesis_from($1, 'Nordisk growth') as id",
    [first.id],
  );
  const copy = copied.rows[0]?.id;
  const copyVersion = copy
    ? await one(
        client,
        "select id, version, status, profile_key from public.fund_config_versions where thesis_id = $1",
        [copy],
      )
    : null;
  record(
    "Admin kopierer en aktiv tese: v1 som kladde med egen analysenøgle",
    copyVersion?.version === 1 &&
      copyVersion?.status === "draft" &&
      copyVersion?.profile_key !== "nordisk",
    copied.message ?? "",
  );
  const memberCopy = await as(client, MEMBER, "select public.create_thesis_from($1, 'Kopi')", [
    first.id,
  ]);
  record("Medlem kan ikke kopiere en tese", /Admin eller Lead/.test(memberCopy.message ?? ""));

  // Udgiv kopien: nu har teamet to aktive teser, og standarden er uændret.
  const published = await as(client, ADMIN, "select public.activate_fund_config($1)", [
    copyVersion?.id,
  ]);
  const copyRow = copy ? await thesis(client, copy) : null;
  record(
    "Udgivelse gør kopien aktiv uden at tage standarden",
    published.message === null && copyRow?.status === "active" && !copyRow?.is_default,
    published.message ?? "",
  );
  const activeVersions = await one(
    client,
    "select count(*) as n, count(distinct thesis_id) as theses from public.fund_config_versions where fund_id = $1 and status = 'active'",
    [TEAM],
  );
  record(
    "To aktive teser har hver sin aktive version",
    Number(activeVersions.n) === 2 && Number(activeVersions.theses) === 2,
  );

  // Standardtesen.
  const memberDefault = await as(client, MEMBER, "select public.set_default_thesis($1)", [copy]);
  record("Medlem kan ikke vælge standardtesen", memberDefault.message !== null);
  const draftDefault = await as(client, ADMIN, "select public.set_default_thesis($1)", [klima]);
  record("En kladde-tese kan ikke være standard", /udgivet tese/.test(draftDefault.message ?? ""));
  const setDefault = await as(client, LEAD, "select public.set_default_thesis($1)", [copy]);
  const defaults = await client.query(
    "select id from public.fund_theses where fund_id = $1 and is_default",
    [TEAM],
  );
  record(
    "Lead gør kopien til standard; der er stadig kun én",
    setDefault.message === null && defaults.rows.length === 1 && defaults.rows[0].id === copy,
    setDefault.message ?? "",
  );

  // Omdøb.
  const renameTaken = await as(client, ADMIN, "select public.rename_thesis($1, 'klima growth')", [
    copy,
  ]);
  record(
    "Omdøb til et navn, der er taget, afvises",
    /med det navn/.test(renameTaken.message ?? ""),
  );
  const renamed = await as(client, ADMIN, "select public.rename_thesis($1, 'Nordisk vækst')", [
    copy,
  ]);
  record(
    "Admin omdøber; det står i auditloggen",
    renamed.message === null &&
      (await thesis(client, copy)).name === "Nordisk vækst" &&
      (await audits(client, "fund_thesis_renamed", copy)) === 1,
    renamed.message ?? "",
  );
  const memberRename = await as(client, MEMBER, "select public.rename_thesis($1, 'Andet')", [copy]);
  record("Medlem kan ikke omdøbe", memberRename.message !== null);

  // Arkivér standardtesen: den ældste anden aktive bliver standard, og intet slettes.
  const casesBefore = Number(
    (await one(client, "select count(*) as n from public.cases where fund_id = $1", [TEAM])).n,
  );
  const archived = await as(client, LEAD, "select public.archive_thesis($1) as new_default", [
    copy,
  ]);
  const archivedRow = await thesis(client, copy);
  record(
    "Arkivér standardtesen: den ældste anden aktive bliver standard",
    archived.rows[0]?.new_default === first.id && (await thesis(client, first.id)).is_default,
    archived.message ?? "",
  );
  record(
    "Den arkiverede tese er skjult, ikke slettet, og har sin version",
    archivedRow?.status === "archived" &&
      archivedRow?.archived_at !== null &&
      archivedRow?.archived_by === LEAD &&
      Number(
        (
          await one(
            client,
            "select count(*) as n from public.fund_config_versions where thesis_id = $1",
            [copy],
          )
        ).n,
      ) === 1,
  );
  record(
    "Arkiveringen står i auditloggen, og ingen case er slettet",
    (await audits(client, "fund_thesis_archived", copy)) === 1 &&
      Number(
        (await one(client, "select count(*) as n from public.cases where fund_id = $1", [TEAM])).n,
      ) === casesBefore,
  );
  const again = await as(client, ADMIN, "select public.archive_thesis($1)", [copy]);
  record(
    "En arkiveret tese kan ikke arkiveres igen",
    /allerede arkiveret/.test(again.message ?? ""),
  );
  const last = await as(client, ADMIN, "select public.archive_thesis($1)", [first.id]);
  record("Den sidste aktive tese kan ikke arkiveres", /mindst én aktiv/.test(last.message ?? ""));
  const caseUnderArchived = await as(
    client,
    ADMIN,
    "select public.create_manual_case_for_fund($1, 'Ny ApS', '', 'seed', '', '', '', '[]'::jsonb, $2)",
    [TEAM, copy],
  );
  record("En case kan ikke oprettes under en arkiveret tese", caseUnderArchived.message !== null);
  const draftArchived = await as(client, ADMIN, "select public.archive_thesis($1)", [klima]);
  record(
    "En kladde-tese kan arkiveres; standarden er uændret",
    draftArchived.message === null &&
      (await thesis(client, klima)).status === "archived" &&
      (await thesis(client, first.id)).is_default,
    draftArchived.message ?? "",
  );
  const renameArchived = await as(client, ADMIN, "select public.rename_thesis($1, 'Nyt navn')", [
    copy,
  ]);
  record(
    "En arkiveret tese omdøbes først ved genaktivering",
    /Genaktivér/.test(renameArchived.message ?? ""),
  );

  // Genaktivér: navnet er taget imens, så et nyt navn kræves.
  await as(client, ADMIN, "select public.create_thesis($1, 'Nordisk vækst')", [TEAM]);
  const taken = await as(client, ADMIN, "select public.reactivate_thesis($1)", [copy]);
  record(
    "Genaktivering med et navn, der er taget imens, afvises",
    /med det navn/.test(taken.message ?? ""),
  );
  const memberReactivate = await as(client, MEMBER, "select public.reactivate_thesis($1, 'X y')", [
    copy,
  ]);
  record("Medlem kan ikke genaktivere", memberReactivate.message !== null);
  const reactivated = await as(
    client,
    LEAD,
    "select public.reactivate_thesis($1, 'Nordisk vækst (2)')",
    [copy],
  );
  const back = await thesis(client, copy);
  record(
    "Genaktiveret med nyt navn: aktiv igen (har en udgivet version), ikke standard",
    reactivated.message === null &&
      back.status === "active" &&
      back.name === "Nordisk vækst (2)" &&
      back.archived_at === null &&
      !back.is_default,
    reactivated.message ?? "",
  );
  const draftBack = await as(client, ADMIN, "select public.reactivate_thesis($1)", [klima]);
  record(
    "En genaktiveret kladde-tese er kladde igen",
    draftBack.message === null && (await thesis(client, klima)).status === "draft",
    draftBack.message ?? "",
  );
  record(
    "Genaktiveringen står i auditloggen",
    (await audits(client, "fund_thesis_reactivated", copy)) === 1,
  );
  const notArchived = await as(client, ADMIN, "select public.reactivate_thesis($1)", [copy]);
  record("En aktiv tese kan ikke genaktiveres", /ikke arkiveret/.test(notArchived.message ?? ""));

  // Samme selskab under to teser, og Cases-listen sender hver cases tese og aktive version med.
  const secondCase = await as(
    client,
    ADMIN,
    "select public.create_manual_case_for_fund($1, 'Alfa ApS', '', 'seed', '', '', '', '[]'::jsonb, $2) as id",
    [TEAM, copy],
  );
  const payload = await as(
    client,
    ADMIN,
    "select public.case_list_payload($1, $2, null) as p",
    [TEAM, V1],
    false,
  );
  const listed = payload.rows[0]?.p?.cases ?? [];
  const byId = new Map(listed.map((row) => [row.id, row]));
  record(
    "Cases-listen sender casens tese og dens aktive version med",
    byId.get(CASE_ALFA)?.thesis_id === first.id &&
      byId.get(CASE_ALFA)?.active_config_id === V1 &&
      byId.get(secondCase.rows[0]?.id)?.thesis_id === copy &&
      byId.get(secondCase.rows[0]?.id)?.active_config_id === copyVersion?.id,
    payload.message ?? secondCase.message ?? "",
  );

  // Ingen direkte skrivning i tabellen og intet på tværs af teams.
  const direct = await as(
    client,
    ADMIN,
    "update public.fund_theses set name = 'Hack' where id = $1 returning id",
    [first.id],
  );
  record(
    "En bruger kan ikke skrive direkte i fund_theses",
    direct.message !== null || direct.rows.length === 0,
  );
  const crossTeam = await as(client, OUTSIDER, "select public.archive_thesis($1)", [copy]);
  record("Et andet teams Admin kan ikke arkivere teamets tese", crossTeam.message !== null);
  const onlyDraft = await as(
    client,
    OUTSIDER,
    "select public.create_thesis($1, 'Første tese') as id",
    [OTHER_TEAM],
  );
  const lastDraft = await as(client, OUTSIDER, "select public.archive_thesis($1)", [
    onlyDraft.rows[0]?.id,
  ]);
  record(
    "Et team, der aldrig har udgivet, kan ikke arkivere sin sidste tese",
    /mindst én aktiv/.test(lastDraft.message ?? ""),
    onlyDraft.message ?? "",
  );
  const anon = await client
    .query("select has_function_privilege('anon', 'public.archive_thesis(uuid)', 'execute') as yes")
    .then((result) => result.rows[0].yes);
  record("anon kan ikke kalde tese-funktionerne", anon === false);
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
    `\n${results.passed} tjek af tese-funktionerne som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
