#!/usr/bin/env node
/**
 * Komitémemoens data (spec):
 * case_memo_inputs, case_memo_gap_answers og case_memo_versions med funktionerne
 * save_case_memo_input, answer_case_memo_gap, create_case_memo_draft og approve_case_memo_version.
 * Rettigheder (Admin, Lead og Medlem skriver; Læser og et andet team kan ikke), RLS pr. team,
 * ingen direkte skrivning, mangelsvar, versionsnumre (ny analyse giver ny version), og at en
 * godkendt version er frosset (også for serveren), mens sletning af casen, teamet eller en bruger
 * stadig virker.
 *
 *   npm run db:local -- fresh && npm run test:memo-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (suffix) => `a1082000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const TEAM = id("f1");
const OTHER_TEAM = id("f2");
const ADMIN = id("a1");
const LEAD = id("a2");
const MEMBER = id("a3");
const READER = id("a4");
const OUTSIDER = id("a5");
const APPROVER = id("a6");
const V1 = id("c1");
const ALFA = id("b1");
const BETA = id("b2");
const CASE_ALFA = id("d1");
const CASE_BETA = id("d2");
const RUN_DEEP = id("e1");
const RUN_DEEP_NEW = id("e2");
const RUN_SCREEN = id("e3");
const RUN_RUNNING = id("e4");
const RUN_BETA = id("e5");

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 't1082-admin@interlect.test'),
    ('${LEAD}', 't1082-lead@interlect.test'),
    ('${MEMBER}', 't1082-member@interlect.test'),
    ('${READER}', 't1082-reader@interlect.test'),
    ('${OUTSIDER}', 't1082-outsider@interlect.test'),
    ('${APPROVER}', 't1082-approver@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${TEAM}', 'Nordisk Kapital', 't1082-a'),
    ('${OTHER_TEAM}', 'Andet team', 't1082-b');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${TEAM}', '${ADMIN}'), ('${TEAM}', '${LEAD}'), ('${TEAM}', '${MEMBER}'),
    ('${TEAM}', '${READER}'), ('${TEAM}', '${APPROVER}'), ('${OTHER_TEAM}', '${OUTSIDER}');
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, case m.user_id
      when '${LEAD}' then 'lead' when '${MEMBER}' then 'member'
      when '${APPROVER}' then 'member' when '${READER}' then 'reader'
      else 'admin' end::public.app_role
  from public.fund_memberships m
  where m.user_id in ('${ADMIN}', '${LEAD}', '${MEMBER}', '${READER}', '${OUTSIDER}',
    '${APPROVER}');

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

  insert into public.companies (id, fund_id, name) values
    ('${ALFA}', '${TEAM}', 'Alfa ApS'), ('${BETA}', '${TEAM}', 'Beta ApS');
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by) values
    ('${CASE_ALFA}', '${TEAM}', '${ALFA}', 'manual', '${ADMIN}'),
    ('${CASE_BETA}', '${TEAM}', '${BETA}', 'manual', '${ADMIN}');

  insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status,
    workflow_version, prompt_template_name, prompt_template_version, requested_by) values
    ('${RUN_DEEP}', '${TEAM}', '${CASE_ALFA}', '${V1}', 'deep', 'complete', 'w', 'p', 'v', '${ADMIN}'),
    ('${RUN_DEEP_NEW}', '${TEAM}', '${CASE_ALFA}', '${V1}', 'deep', 'complete', 'w', 'p', 'v',
      '${ADMIN}'),
    ('${RUN_SCREEN}', '${TEAM}', '${CASE_ALFA}', '${V1}', 'screening', 'complete', 'w', 'p', 'v',
      '${ADMIN}'),
    ('${RUN_RUNNING}', '${TEAM}', '${CASE_ALFA}', '${V1}', 'deep', 'running', 'w', 'p', 'v',
      '${ADMIN}'),
    ('${RUN_BETA}', '${TEAM}', '${CASE_BETA}', '${V1}', 'deep', 'complete', 'w', 'p', 'v',
      '${ADMIN}');
`;

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(86)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user in a savepoint; keeps the change unless `keep` is false. */
async function as(client, userId, sql, params = [], keep = true) {
  await client.query("savepoint t1082");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query(sql, params);
    // set_config(..., true) lives to the end of the transaction, also after "release": clear the
    // person again, so the owner's calls below stand in for the server (auth.uid() null).
    await client.query(
      "select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)",
    );
    await client.query("reset role");
    await client.query(keep ? "release savepoint t1082" : "rollback to savepoint t1082");
    return { rows: result.rows, message: null };
  } catch (cause) {
    await client.query("rollback to savepoint t1082");
    return { rows: [], message: cause.message };
  }
}

/** Runs sql with the owner's rights (as the server's service role would) in a savepoint. */
async function asOwner(client, sql, params = [], keep = false) {
  await client.query("savepoint t1082_owner");
  try {
    const result = await client.query(sql, params);
    await client.query(
      keep ? "release savepoint t1082_owner" : "rollback to savepoint t1082_owner",
    );
    return { rows: result.rows, message: null };
  } catch (cause) {
    await client.query("rollback to savepoint t1082_owner");
    return { rows: [], message: cause.message };
  }
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];
const count = async (client, sql, params = []) => Number((await one(client, sql, params)).n);
const audits = (client, action) =>
  count(
    client,
    "select count(*) as n from public.audit_events where action = $1 and fund_id = $2",
    [action, TEAM],
  );

const SAVE = "select public.save_case_memo_input($1, $2, $3::jsonb) as id";
const GAP = "select public.answer_case_memo_gap($1, $2, $3, $4) as id";
const DRAFT = "select public.create_case_memo_draft($1, $2, $3::jsonb) as id";
const APPROVE = "select public.approve_case_memo_version($1)";
const version = (client, versionId) =>
  one(client, "select * from public.case_memo_versions where id = $1", [versionId]);

async function inputs(client) {
  // Forslaget: Admin, Lead og Medlem gemmer; Læser og et andet team kan ikke.
  const saved = await as(client, MEMBER, SAVE, [
    CASE_ALFA,
    "Stærkt team og klar traktion.",
    JSON.stringify({ "belief-1": "Enig", "belief-2": "Kræver flere kunder" }),
  ]);
  const row = await one(client, "select * from public.case_memo_inputs where case_id = $1", [
    CASE_ALFA,
  ]);
  record(
    "Medlem gemmer forslaget med begrundelse og kommentarer pr. tese",
    row?.id === saved.rows[0]?.id &&
      row?.author_id === MEMBER &&
      row?.rationale === "Stærkt team og klar traktion." &&
      row?.belief_comments?.["belief-2"] === "Kræver flere kunder",
    saved.message ?? "",
  );
  const again = await as(client, LEAD, SAVE, [CASE_ALFA, "Ny begrundelse", "{}"]);
  const row2 = await one(client, "select * from public.case_memo_inputs where case_id = $1", [
    CASE_ALFA,
  ]);
  record(
    "Lead gemmer igen: samme række, ny forfatter og tekst (én pr. case)",
    again.rows[0]?.id === row.id &&
      row2.author_id === LEAD &&
      row2.rationale === "Ny begrundelse" &&
      (await count(client, "select count(*) as n from public.case_memo_inputs where case_id = $1", [
        CASE_ALFA,
      ])) === 1,
    again.message ?? "",
  );
  const admin = await as(client, ADMIN, SAVE, [CASE_BETA, "Admin skriver også", null]);
  record(
    "Admin kan gemme et forslag",
    admin.message === null && !!admin.rows[0]?.id,
    admin.message ?? "",
  );

  const reader = await as(client, READER, SAVE, [CASE_ALFA, "Læser prøver", "{}"]);
  record("Læser kan ikke gemme et forslag", /kun Admin, Lead og Medlem/.test(reader.message ?? ""));
  const outsider = await as(client, OUTSIDER, SAVE, [CASE_ALFA, "Udefra", "{}"]);
  record(
    "Et andet teams Admin kan ikke gemme et forslag (casen findes ikke for dem)",
    /casen blev ikke fundet/.test(outsider.message ?? ""),
  );
  for (const [label, comments] of [
    ["en liste", "[]"],
    ["et tal som kommentar", JSON.stringify({ a: 3 })],
    ["en kommentar over 2.000 tegn", JSON.stringify({ a: "x".repeat(2001) })],
    ["en tom nøgle", JSON.stringify({ "": "x" })],
  ]) {
    const bad = await as(client, MEMBER, SAVE, [CASE_ALFA, "x", comments]);
    record(`Kommentarer som ${label} afvises`, /kommentarerne til teserne/.test(bad.message ?? ""));
  }
  const long = await as(client, MEMBER, SAVE, [CASE_ALFA, "x".repeat(8001), "{}"]);
  record(
    "En begrundelse over 8.000 tegn afvises",
    /begrundelsen er for lang/.test(long.message ?? ""),
  );

  // Læsning: alle i teamet (også Læser); intet for et andet team.
  const readerRead = await as(
    client,
    READER,
    "select id from public.case_memo_inputs where case_id = $1",
    [CASE_ALFA],
  );
  record("Læser kan læse forslaget", readerRead.rows.length === 1, readerRead.message ?? "");
  const outsiderRead = await as(
    client,
    OUTSIDER,
    "select id from public.case_memo_inputs union all select id from public.case_memo_gap_answers union all select id from public.case_memo_versions",
  );
  record(
    "Et andet team ser ingen af teamets memo-rækker",
    outsiderRead.message === null && outsiderRead.rows.length === 0,
    outsiderRead.message ?? "",
  );
}

async function gaps(client) {
  const filled = await as(client, MEMBER, GAP, [CASE_ALFA, "customer_references", "filled", null]);
  const first = await one(
    client,
    "select * from public.case_memo_gap_answers where case_id = $1 and gap_key = 'customer_references'",
    [CASE_ALFA],
  );
  record(
    "Medlem markerer en mangel som udfyldt",
    first?.id === filled.rows[0]?.id && first?.state === "filled" && first?.answered_by === MEMBER,
    filled.message ?? "",
  );
  const short = await as(client, MEMBER, GAP, [
    CASE_ALFA,
    "customer_references",
    "not_needed",
    "  kort  ",
  ]);
  record(
    "Ikke nødvendigt uden en begrundelse på 10 tegn afvises",
    /mindst 10 tegn/.test(short.message ?? ""),
  );
  const notNeeded = await as(client, LEAD, GAP, [
    CASE_ALFA,
    "customer_references",
    "not_needed",
    "  Vi har talt med tre kunder selv.  ",
  ]);
  const second = await one(client, "select * from public.case_memo_gap_answers where id = $1", [
    first.id,
  ]);
  record(
    "Et nyt svar erstatter det forrige (samme række, begrundelsen trimmet)",
    notNeeded.rows[0]?.id === first.id &&
      second.state === "not_needed" &&
      second.reason === "Vi har talt med tre kunder selv." &&
      second.answered_by === LEAD,
    notNeeded.message ?? "",
  );
  const later = await as(client, MEMBER, GAP, [CASE_ALFA, "legal_review", "later", null]);
  record("Kun filled og not_needed er gyldige svar", /ukendt svar/.test(later.message ?? ""));
  const badKey = await as(client, MEMBER, GAP, [CASE_ALFA, "Bad Key", "filled", null]);
  record("En ugyldig mangelnøgle afvises", /manglens nøgle/.test(badKey.message ?? ""));
  const reader = await as(client, READER, GAP, [CASE_ALFA, "legal_review", "filled", null]);
  record(
    "Læser kan ikke svare på en mangel",
    /kun Admin, Lead og Medlem/.test(reader.message ?? ""),
  );
  const outsider = await as(client, OUTSIDER, GAP, [CASE_ALFA, "legal_review", "filled", null]);
  record(
    "Et andet team kan ikke svare på en mangel",
    /casen blev ikke fundet/.test(outsider.message ?? ""),
  );
  record("Hvert svar står i auditloggen", (await audits(client, "case_memo_gap_answered")) === 2);
}

async function versions(client) {
  const sections = JSON.stringify({ recommendation: "Udkast 1", thesis: "Tese 1" });
  const draft = await as(client, MEMBER, DRAFT, [CASE_ALFA, RUN_DEEP, sections]);
  const v1 = draft.rows[0]?.id;
  const v1Row = v1 ? await version(client, v1) : null;
  record(
    "Medlem opretter en kladde til den dybe analyse: version 1",
    v1Row?.version === 1 && v1Row?.status === "draft" && v1Row?.created_by === MEMBER,
    draft.message ?? "",
  );
  const redraft = await as(client, LEAD, DRAFT, [
    CASE_ALFA,
    RUN_DEEP,
    JSON.stringify({ recommendation: "Udkast 2" }),
  ]);
  const v1Again = await version(client, v1);
  record(
    "Et nyt udkast til samme analyse retter kladden (ingen ny version)",
    redraft.rows[0]?.id === v1 &&
      v1Again.version === 1 &&
      v1Again.sections.recommendation === "Udkast 2" &&
      (await count(
        client,
        "select count(*) as n from public.case_memo_versions where case_id = $1",
        [CASE_ALFA],
      )) === 1,
    redraft.message ?? "",
  );
  for (const [label, run, pattern] of [
    ["en screening", RUN_SCREEN, /færdig dyb analyse/],
    ["en dyb analyse, der stadig kører", RUN_RUNNING, /færdig dyb analyse/],
    ["en anden cases analyse", RUN_BETA, /hører ikke til casen/],
    ["en analyse, der ikke findes", id("e9"), /hører ikke til casen/],
  ]) {
    const bad = await as(client, MEMBER, DRAFT, [CASE_ALFA, run, sections]);
    record(`En kladde til ${label} afvises`, pattern.test(bad.message ?? ""), bad.message ?? "");
  }
  for (const [label, value] of [
    ["en liste", "[]"],
    ["et tal", JSON.stringify({ recommendation: 42 })],
    ["et objekt", JSON.stringify({ recommendation: { score: 80 } })],
    ["en ugyldig nøgle", JSON.stringify({ "Bad key": "x" })],
  ]) {
    const bad = await as(client, MEMBER, DRAFT, [CASE_ALFA, RUN_DEEP, value]);
    record(
      `Afsnit som ${label} afvises (kun prosa)`,
      /afsnittene skal være tekst/.test(bad.message ?? ""),
    );
  }
  const reader = await as(client, READER, DRAFT, [CASE_ALFA, RUN_DEEP, sections]);
  record(
    "Læser kan ikke oprette en kladde",
    /kun Admin, Lead og Medlem/.test(reader.message ?? ""),
  );
  const outsider = await as(client, OUTSIDER, DRAFT, [CASE_ALFA, RUN_DEEP, sections]);
  record(
    "Et andet team kan ikke oprette en kladde",
    /casen blev ikke fundet/.test(outsider.message ?? ""),
  );

  // Godkend: fryser versionen.
  const readerApprove = await as(client, READER, APPROVE, [v1]);
  record("Læser kan ikke godkende", /kun Admin, Lead og Medlem/.test(readerApprove.message ?? ""));
  const outsiderApprove = await as(client, OUTSIDER, APPROVE, [v1]);
  record(
    "Et andet team kan ikke godkende (versionen findes ikke for dem)",
    /versionen blev ikke fundet/.test(outsiderApprove.message ?? ""),
  );
  const approve = await as(client, MEMBER, APPROVE, [v1]);
  const approved = await version(client, v1);
  record(
    "Medlem godkender kladden: status approved, af og tidspunkt sat",
    approve.message === null &&
      approved.status === "approved" &&
      approved.approved_by === MEMBER &&
      approved.approved_at !== null,
    approve.message ?? "",
  );
  record("Godkendelsen står i auditloggen", (await audits(client, "case_memo_approved")) === 1);
  const twice = await as(client, LEAD, APPROVE, [v1]);
  record(
    "En godkendt version kan ikke godkendes igen",
    /allerede godkendt/.test(twice.message ?? ""),
  );

  // Frosset: ingen ændring, heller ikke med serverens rettigheder.
  for (const [label, sql] of [
    ["afsnittene", "update public.case_memo_versions set sections = '{}'::jsonb where id = $1"],
    [
      "status",
      "update public.case_memo_versions set status = 'draft', approved_at = null where id = $1",
    ],
    ["godkender", `update public.case_memo_versions set approved_by = '${LEAD}' where id = $1`],
    ["sletning", "delete from public.case_memo_versions where id = $1"],
  ]) {
    const frozen = await asOwner(client, sql, [v1]);
    record(
      `En godkendt version kan ikke ændres, heller ikke af serveren (${label})`,
      /godkendt version kan ikke ændres/.test(frozen.message ?? ""),
      frozen.message ?? "",
    );
  }
  const draftAfter = await as(client, MEMBER, DRAFT, [
    CASE_ALFA,
    RUN_DEEP,
    JSON.stringify({ recommendation: "Efter godkendelsen" }),
  ]);
  const v2 = draftAfter.rows[0]?.id;
  record(
    "Et udkast efter godkendelsen bliver en ny version; den godkendte er uændret",
    v2 &&
      v2 !== v1 &&
      (await version(client, v2)).version === 2 &&
      (await version(client, v1)).sections.recommendation === "Udkast 2",
    draftAfter.message ?? "",
  );
  const newAnalysis = await as(client, MEMBER, DRAFT, [CASE_ALFA, RUN_DEEP_NEW, sections]);
  const v3 = newAnalysis.rows[0]?.id;
  record(
    "En ny dyb analyse giver en ny version; gamle versioner bliver",
    v3 &&
      (await version(client, v3)).version === 3 &&
      (await count(
        client,
        "select count(*) as n from public.case_memo_versions where case_id = $1",
        [CASE_ALFA],
      )) === 3,
    newAnalysis.message ?? "",
  );
  const otherCase = await as(client, ADMIN, DRAFT, [CASE_BETA, RUN_BETA, sections]);
  record(
    "Versionsnumre tælles pr. case",
    (await version(client, otherCase.rows[0]?.id))?.version === 1,
    otherCase.message ?? "",
  );

  // Databasens egne regler, også for serveren.
  const insertApproved = await asOwner(
    client,
    `insert into public.case_memo_versions (fund_id, case_id, analysis_run_id, version, status,
       approved_at) values ($1, $2, $3, 9, 'approved', now())`,
    [TEAM, CASE_ALFA, RUN_DEEP],
  );
  record(
    "En version kan ikke oprettes som godkendt (kun gennem godkendelsen)",
    /altid en kladde/.test(insertApproved.message ?? ""),
  );
  const moveDraft = await asOwner(
    client,
    "update public.case_memo_versions set version = 7 where id = $1",
    [v2],
  );
  record(
    "En kladdes nummer kan ikke ændres",
    /nøgle kan ikke ændres/.test(moveDraft.message ?? ""),
  );
  const otherFund = await asOwner(
    client,
    `insert into public.case_memo_versions (fund_id, case_id, analysis_run_id, version)
     values ($1, $2, $3, 9)`,
    // RUN_SCREEN: ingen kladde findes til den, så kun fremmednøglen kan afvise rækken.
    [OTHER_TEAM, CASE_ALFA, RUN_SCREEN],
  );
  record(
    "En version kan ikke pege på en case i et andet team (sammensat fremmednøgle)",
    /violates foreign key/.test(otherFund.message ?? ""),
    otherFund.message ?? "",
  );

  // Analysen alene kan ikke slettes under en godkendt version; under en kladde følger kladden med.
  const runUnderApproved = await afterOwnerChange(
    client,
    "delete from public.analysis_runs where id = $1",
    [RUN_DEEP],
    () => version(client, v1),
  );
  record(
    "Analysen bag en godkendt version kan ikke slettes alene",
    /godkendt version kan ikke ændres/.test(runUnderApproved.message ?? ""),
    runUnderApproved.message ?? "slettet",
  );
  const runUnderDraft = await afterOwnerChange(
    client,
    "delete from public.analysis_runs where id = $1",
    [RUN_DEEP_NEW],
    () => count(client, "select count(*) as n from public.case_memo_versions where id = $1", [v3]),
  );
  record(
    "Analysen bag en kladde kan slettes, og kladden følger med",
    runUnderDraft.message === null && runUnderDraft.value === 0,
    runUnderDraft.message ?? "",
  );

  // Sletning af en bruger, casen eller teamet virker stadig (alt rulles tilbage bagefter).
  const betaVersion = otherCase.rows[0]?.id;
  const approveBeta = await as(client, APPROVER, APPROVE, [betaVersion]);
  const forgotten = await afterOwnerChange(
    client,
    "delete from auth.users where id = $1",
    [APPROVER],
    () => version(client, betaVersion),
  );
  record(
    "En slettet bruger fjernes fra en godkendt version, som stadig er godkendt",
    approveBeta.message === null &&
      forgotten.message === null &&
      forgotten.value?.approved_by === null &&
      forgotten.value?.status === "approved",
    approveBeta.message ?? forgotten.message ?? JSON.stringify(forgotten.value ?? {}),
  );
  const caseGone = await afterOwnerChange(
    client,
    "delete from public.cases where id = $1",
    [CASE_ALFA],
    () =>
      count(client, "select count(*) as n from public.case_memo_versions where case_id = $1", [
        CASE_ALFA,
      ]),
  );
  record(
    "Casen kan slettes med en godkendt version (versionerne følger med)",
    caseGone.message === null && caseGone.value === 0,
    caseGone.message ?? "",
  );
  const teamGone = await afterOwnerChange(client, "select public.delete_fund($1)", [TEAM], () =>
    count(client, "select count(*) as n from public.case_memo_versions where fund_id = $1", [TEAM]),
  );
  record(
    "Teamet kan slettes med godkendte versioner (delete_fund)",
    teamGone.message === null && teamGone.value === 0,
    teamGone.message ?? "",
  );
}

/** Runs sql with the owner's rights, reads `after()`, then rolls both back. */
async function afterOwnerChange(client, sql, params, after) {
  await client.query("savepoint t1082_after");
  try {
    await client.query(sql, params);
    return { message: null, value: await after() };
  } catch (cause) {
    return { message: cause.message, value: null };
  } finally {
    await client.query("rollback to savepoint t1082_after");
  }
}

/** Reading, once all three tables have rows: everyone in the team, nobody outside it. */
async function reads(client) {
  for (const table of ["case_memo_inputs", "case_memo_gap_answers", "case_memo_versions"]) {
    const sql = `select id from public.${table} where fund_id = $1`;
    const owner = (await client.query(sql, [TEAM])).rows.length;
    const reader = await as(client, READER, sql, [TEAM]);
    const outsider = await as(client, OUTSIDER, sql, [TEAM]);
    record(
      `${table}: Læser ser teamets ${owner} rækker, et andet team ser 0`,
      owner > 0 &&
        reader.rows.length === owner &&
        outsider.message === null &&
        outsider.rows.length === 0,
      reader.message ?? outsider.message ?? "",
    );
  }
}

async function access(client) {
  for (const table of ["case_memo_inputs", "case_memo_gap_answers", "case_memo_versions"]) {
    const direct = await as(
      client,
      ADMIN,
      `insert into public.${table} (fund_id, case_id) values ($1, $2) returning id`,
      [TEAM, CASE_ALFA],
    );
    record(
      `En bruger kan ikke skrive direkte i ${table}`,
      /permission denied/.test(direct.message ?? ""),
    );
    const update = await as(
      client,
      ADMIN,
      `update public.${table} set fund_id = fund_id returning id`,
    );
    record(
      `En bruger kan ikke rette direkte i ${table}`,
      /permission denied/.test(update.message ?? ""),
    );
    const remove = await as(client, ADMIN, `delete from public.${table} returning id`);
    record(
      `En bruger kan ikke slette direkte i ${table}`,
      /permission denied/.test(remove.message ?? ""),
    );
    const mfa = await count(
      client,
      `select count(*) as n from pg_policy p
       where p.polrelid = 'public.${table}'::regclass and p.polname = 'mfa_required'
         and not p.polpermissive`,
    );
    record(`${table} har MFA-policyen`, mfa === 1);
  }
  for (const signature of [
    "public.save_case_memo_input(uuid, text, jsonb)",
    "public.answer_case_memo_gap(uuid, text, text, text)",
    "public.create_case_memo_draft(uuid, uuid, jsonb)",
    "public.approve_case_memo_version(uuid)",
  ]) {
    const rights = await one(
      client,
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as signed_in`,
      [signature],
    );
    record(`${signature}: kun logget ind`, rights.anon === false && rights.signed_in === true);
  }
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(SEED);
    await inputs(client);
    await gaps(client);
    await access(client);
    await versions(client);
    await reads(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(
    `\n${results.passed} tjek af komitémemoens data som forventet, ${results.failures.length} afvigelser.`,
  );
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
