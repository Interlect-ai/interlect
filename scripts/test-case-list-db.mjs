#!/usr/bin/env node
/**
 * Cases-listen i ét kald: case_list_payload giver et medlem fondens cases med de
 * kørsler, listen viser, og intet fra andre fonde. Kørsler fra ældre versioner af opsætningen er
 * med og bærer deres version; en hængt kørsel på en ældre version er ikke "i gang". Kørslernes rå AI-svar
 * kommer ikke med (kun kravenes gateKey og passed), tællinger erstatter rækker, og den nyeste
 * genberegning og de aktive trin vælges i databasen. Andre end fondens medlemmer afvises.
 *
 *   npm run db:local -- fresh && npm run test:case-list-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (suffix) => `a9010000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const FUND = id("f1");
const OTHER_FUND = id("f2");
const ADMIN = id("a1");
const ASSIGNEE = id("a2");
const OUTSIDER = id("a3");
const PROFILE = id("c1");
const OLD_PROFILE = id("c2");
const OTHER_PROFILE = id("c3");
const CASE_A = id("d1");
const CASE_B = id("d2");
const CASE_C = id("d4");
const C_SCREENING = id("e7");
const C_STUCK = id("e8");
const OTHER_CASE = id("d3");
const SCREENING_OLD = id("e1");
const SCREENING = id("e2");
const DEEP = id("e3");
const RUNNING = id("e4");
const OLD_PROFILE_RUN = id("e5");
const OTHER_RUN = id("e6");
const LONG_TEXT = "Lang begrundelse fra AI-svaret, som listen ikke viser";

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN}', 'list-admin@interlect.test'),
    ('${ASSIGNEE}', 'list-assignee@interlect.test'),
    ('${OUTSIDER}', 'list-outsider@interlect.test');
  insert into public.profiles (id, full_name, email_normalized) values
    ('${ADMIN}', 'Ada Admin', 'list-admin@interlect.test'),
    ('${ASSIGNEE}', 'Bo Ansvarlig', 'list-assignee@interlect.test'),
    ('${OUTSIDER}', 'Otto Udenfor', 'list-outsider@interlect.test')
  on conflict (id) do update set full_name = excluded.full_name;
  insert into public.funds (id, name, slug) values
    ('${FUND}', 'Listefond', 'listefond-t901'),
    ('${OTHER_FUND}', 'Anden fond', 'anden-fond-t901');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${FUND}', '${ADMIN}'), ('${FUND}', '${ASSIGNEE}'), ('${OTHER_FUND}', '${OUTSIDER}');
  insert into public.fund_membership_roles (membership_id, role)
  select id, 'admin'::public.app_role from public.fund_memberships
  where user_id in ('${ADMIN}', '${ASSIGNEE}', '${OUTSIDER}');
  insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis) values
    ('${OLD_PROFILE}', '${FUND}', 1, 'liste', 'test'),
    ('${PROFILE}', '${FUND}', 2, 'liste', 'test'),
    ('${OTHER_PROFILE}', '${OTHER_FUND}', 1, 'anden', 'test');
  insert into public.companies (id, fund_id, name, website) values
    ('${id("b1")}', '${FUND}', 'Alfa ApS', 'https://alfa.test'),
    ('${id("b2")}', '${FUND}', 'Beta ApS', null),
    ('${id("b4")}', '${FUND}', 'Gamma ApS', null),
    ('${id("b3")}', '${OTHER_FUND}', 'Fremmed ApS', null);
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by, assigned_to) values
    ('${CASE_A}', '${FUND}', '${id("b1")}', 'manual', '${ADMIN}', null),
    ('${CASE_B}', '${FUND}', '${id("b2")}', 'manual', '${ADMIN}', '${ASSIGNEE}'),
    ('${CASE_C}', '${FUND}', '${id("b4")}', 'manual', '${ADMIN}', null),
    ('${OTHER_CASE}', '${OTHER_FUND}', '${id("b3")}', 'manual', '${OUTSIDER}', null);

  insert into public.assessment_criteria (config_version_id, criterion_key, label, description,
    score_category, weight, sort_order) values
    ('${OLD_PROFILE}', 'team', 'Team (v1)', 'x', 'team', 50, 1),
    ('${PROFILE}', 'team', 'Team (v2)', 'x', 'team', 50, 1);

  insert into public.evidence_items (id, fund_id, case_id, claim, status, created_by) values
    ('${id("71")}', '${FUND}', '${CASE_A}', 'Omsætning', 'verified', '${ADMIN}'),
    ('${id("72")}', '${FUND}', '${CASE_A}', 'Kunder', 'unknown', '${ADMIN}');

  insert into public.analysis_runs (id, fund_id, case_id, config_version_id, previous_run_id, kind,
    status, workflow_version, prompt_template_name, prompt_template_version, requested_by,
    raw_response, validation_result, input_evidence_ids, created_at) values
    ('${SCREENING_OLD}', '${FUND}', '${CASE_A}', '${PROFILE}', null, 'screening', 'complete',
      't', 't', 't', '${ADMIN}', '{"gates": [{"gateKey": "geo", "passed": true}]}', null, '{}',
      now() - interval '4 hours'),
    ('${SCREENING}', '${FUND}', '${CASE_A}', '${PROFILE}', null, 'screening', 'complete',
      't', 't', 't', '${ADMIN}',
      '{"gates": [{"gateKey": "geo", "passed": false, "rationale": "${LONG_TEXT}"},
                  {"gateKey": "size", "passed": true, "rationale": "${LONG_TEXT}"}],
        "summary": "${LONG_TEXT}"}',
      '{"teamGateAnswers": [{"gateKey": "geo", "passed": true, "rationale": "Teamet"}],
        "notes": "${LONG_TEXT}"}',
      '{${id("71")},${id("72")}}', now() - interval '3 hours'),
    ('${DEEP}', '${FUND}', '${CASE_A}', '${PROFILE}', '${SCREENING}', 'deep', 'complete',
      't', 't', 't', '${ADMIN}', '{"summary": "${LONG_TEXT}"}', null, '{}',
      now() - interval '2 hours'),
    ('${RUNNING}', '${FUND}', '${CASE_A}', '${PROFILE}', null, 'screening', 'running',
      't', 't', 't', '${ADMIN}', null, null, '{}', now() - interval '1 hour'),
    ('${OLD_PROFILE_RUN}', '${FUND}', '${CASE_A}', '${OLD_PROFILE}', null, 'screening', 'complete',
      't', 't', 't', '${ADMIN}', '{"gates": []}', null, '{}', now() - interval '270 minutes'),
    ('${C_SCREENING}', '${FUND}', '${CASE_C}', '${OLD_PROFILE}', null, 'screening', 'complete',
      't', 't', 't', '${ADMIN}', '{"gates": []}', null, '{}', now() - interval '6 hours'),
    ('${C_STUCK}', '${FUND}', '${CASE_C}', '${OLD_PROFILE}', null, 'screening', 'running',
      't', 't', 't', '${ADMIN}', null, null, '{}', now() - interval '5 hours'),
    ('${OTHER_RUN}', '${OTHER_FUND}', '${OTHER_CASE}', '${OTHER_PROFILE}', null, 'screening',
      'complete', 't', 't', 't', '${OUTSIDER}', '{"gates": []}', null, '{}', now());

  insert into public.recommendations (fund_id, run_id, recommendation, overall_score,
    evidence_confidence, rationale) values
    ('${FUND}', '${SCREENING_OLD}', 'follow', 70, 0.5, '${LONG_TEXT}'),
    ('${FUND}', '${SCREENING}', 'go_forward', 72, 0.8, '${LONG_TEXT}'),
    ('${FUND}', '${DEEP}', 'go_forward', 80, 0.9, '${LONG_TEXT}'),
    ('${FUND}', '${OLD_PROFILE_RUN}', 'reject', 10, 0.1, '${LONG_TEXT}'),
    ('${FUND}', '${C_SCREENING}', 'follow', 58, 0.6, '${LONG_TEXT}'),
    ('${OTHER_FUND}', '${OTHER_RUN}', 'reject', 20, 0.2, '${LONG_TEXT}');
  insert into public.category_scores (fund_id, run_id, category, validated_score, weight, rationale)
  values
    ('${FUND}', '${SCREENING_OLD}', 'team', 30, 50, 'x'),
    ('${FUND}', '${SCREENING}', 'team', 60, 50, 'x'),
    ('${FUND}', '${SCREENING}', 'market', 40, 50, 'x'),
    ('${FUND}', '${DEEP}', 'team', 85, 100, 'x'),
    ('${FUND}', '${C_SCREENING}', 'team', 58, 100, 'x');
  insert into public.risks (fund_id, run_id, category, level, statement) values
    ('${FUND}', '${DEEP}', 'market', 'medium', 'x'),
    ('${FUND}', '${DEEP}', 'team', 'critical', 'x'),
    ('${FUND}', '${DEEP}', 'tech', 'low', 'x');
  insert into public.case_score_recalculations (fund_id, case_id, run_id, overall_score, outcome,
    failed_gate_keys, formula_version, result, created_by, created_at) values
    ('${FUND}', '${CASE_A}', '${SCREENING}', 55, 'blocked', '{geo}', 't', '{}', '${ADMIN}',
      now() - interval '30 minutes'),
    ('${FUND}', '${CASE_A}', '${SCREENING}', 65, 'awaiting_approval', '{}', 't', '{}', '${ADMIN}',
      now() - interval '10 minutes');
  insert into public.analysis_run_steps (fund_id, run_id, step_key, step_order, status) values
    ('${FUND}', '${RUNNING}', 'research', 2, 'running'),
    ('${FUND}', '${RUNNING}', 'cvr_financials', 1, 'complete'),
    ('${FUND}', '${RUNNING}', 'score', 3, 'queued'),
    ('${FUND}', '${DEEP}', 'old_step', 1, 'complete'),
    ('${FUND}', '${C_STUCK}', 'research', 1, 'running');
  insert into public.sources (fund_id, case_id, title, source_type) values
    ('${FUND}', '${CASE_A}', 'Kilde 1', 'web'),
    ('${FUND}', '${CASE_A}', 'Kilde 2', 'web'),
    ('${FUND}', '${CASE_A}', 'Kilde 3', 'registry'),
    ('${OTHER_FUND}', '${OTHER_CASE}', 'Fremmed kilde', 'web');
  insert into public.case_tasks (fund_id, case_id, kind, title, origin, created_by, status,
    resolved_at, deleted_at) values
    ('${FUND}', '${CASE_A}', 'task', 'Åben', 'user', '${ADMIN}', 'open', null, null),
    ('${FUND}', '${CASE_A}', 'task', 'Slettet', 'user', '${ADMIN}', 'open', null, now()),
    ('${FUND}', '${CASE_A}', 'task', 'Løst', 'user', '${ADMIN}', 'resolved', now(), null);
`;

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(80)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user (like PostgREST) inside a savepoint that is rolled back. */
async function asUser(client, userId, sql, params = [], role = "authenticated") {
  await client.query("savepoint list_user");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId ?? "", role }),
    ]);
    const result = await client.query(sql, params);
    return { rows: result.rows, code: null };
  } catch (cause) {
    return { rows: [], code: cause.code, message: cause.message };
  } finally {
    await client.query("rollback to savepoint list_user");
  }
}

const PAYLOAD = "select public.case_list_payload($1, $2) as payload";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function run(client) {
  await client.query(SEED);
  const expectedOrder = (
    await client.query(
      "select id from public.cases where fund_id = $1 order by updated_at desc, id",
      [FUND],
    )
  ).rows.map((row) => row.id);

  const answer = await asUser(client, ADMIN, PAYLOAD, [FUND, PROFILE]);
  const payload = answer.rows[0]?.payload;
  record(
    "Et medlem får listen i ét kald",
    answer.code === null && Boolean(payload),
    answer.message,
  );
  if (!payload) return;

  const caseIds = payload.cases.map((row) => row.id);
  record(
    "Kun fondens egne cases, i listens rækkefølge (nyeste ændring først)",
    same(caseIds, expectedOrder) && !caseIds.includes(OTHER_CASE),
    caseIds.join(", "),
  );
  const a = payload.cases.find((row) => row.id === CASE_A);
  const b = payload.cases.find((row) => row.id === CASE_B);
  record(
    "Selskabets navn og hjemmeside følger med casen",
    a?.company_name === "Alfa ApS" && a?.website === "https://alfa.test",
  );
  record(
    "Seneste kørsel, seneste færdige screening og dybe analyse vælges i databasen",
    a?.latest_run_id === RUNNING && a?.screening_run_id === SCREENING && a?.deep_run_id === DEEP,
    `${a?.latest_run_id} / ${a?.screening_run_id} / ${a?.deep_run_id}`,
  );
  record(
    "Screeningens krav har kun gateKey og passed (intet fra AI-svarets tekst)",
    // jsonb stores keys in its own order, so the gates are compared key by key.
    same(
      a?.screening_gates?.map((gate) => [
        Object.keys(gate).sort().join(","),
        gate.gateKey,
        gate.passed,
      ]),
      [
        ["gateKey,passed", "geo", false],
        ["gateKey,passed", "size", true],
      ],
    ),
    JSON.stringify(a?.screening_gates),
  );
  record(
    "Teamets svar på kravene følger med screeningen",
    a?.screening_team_gate_answers?.[0]?.gateKey === "geo" &&
      a?.screening_team_gate_answers?.[0]?.passed === true,
  );
  record("Højeste risiko i den dybe analyse", a?.top_risk_level === "critical", a?.top_risk_level);
  record(
    "Kilder og åbne opgaver tælles (slettede og løste opgaver tæller ikke)",
    a?.source_count === 3 && a?.open_tasks === 1,
    `${a?.source_count} kilder, ${a?.open_tasks} opgaver`,
  );
  record(
    "En case uden kørsler har ingen kørsler og tællinger på 0; ansvarlig er den tildelte",
    b?.latest_run_id === null &&
      b?.screening_run_id === null &&
      b?.screening_gates === null &&
      b?.source_count === 0 &&
      b?.open_tasks === 0 &&
      b?.assignee_id === ASSIGNEE,
  );
  record("Uden tildelt ansvarlig er det den, der oprettede casen", a?.assignee_id === ADMIN);

  const runIds = payload.runs.map((run) => run.id);
  record(
    "Kørslerne er fondens egne fra alle versioner, nyeste først (ikke en anden fonds)",
    same(runIds, [RUNNING, DEEP, SCREENING, SCREENING_OLD, OLD_PROFILE_RUN, C_STUCK, C_SCREENING]),
    runIds.join(", "),
  );
  const c = payload.cases.find((row) => row.id === CASE_C);
  record(
    "En case screenet mod en ældre version viser den screening (T-957)",
    c?.screening_run_id === C_SCREENING,
    c?.screening_run_id,
  );
  record(
    "En hængt kørsel på en ældre version er ikke casens seneste kørsel",
    c?.latest_run_id === C_SCREENING && !payload.steps.some((row) => row.run_id === C_STUCK),
    c?.latest_run_id,
  );
  const cRun = payload.runs.find((run) => run.id === C_SCREENING);
  record(
    "Kørslen bærer sin version (id og nummer)",
    cRun?.config_version_id === OLD_PROFILE &&
      cRun?.setup_version === 1 &&
      payload.runs.find((run) => run.id === SCREENING)?.setup_version === 2,
    JSON.stringify(cRun),
  );
  const screeningRun = payload.runs.find((run) => run.id === SCREENING);
  record(
    "En kørsel har kun art, status, version og anbefalingens tal",
    same(Object.keys(screeningRun ?? {}).sort(), [
      "case_id",
      "config_version_id",
      "evidence_confidence",
      "id",
      "kind",
      "overall_score",
      "previous_run_id",
      "recommendation",
      "setup_version",
      "status",
    ]) && Number(screeningRun?.overall_score) === 72,
    JSON.stringify(screeningRun),
  );
  const deepRun = payload.runs.find((run) => run.id === DEEP);
  record("Den dybe analyse peger på sin screening", deepRun?.previous_run_id === SCREENING);
  record(
    "Ingen rå AI-svar eller begrundelser i svaret",
    !JSON.stringify(payload).includes(LONG_TEXT),
  );

  const scoreRuns = [...new Set(payload.scores.map((row) => row.run_id))].sort();
  record(
    "Kriteriescorer kun for den viste screening og dybe analyse",
    same(scoreRuns, [SCREENING, DEEP, C_SCREENING].sort()) && payload.scores.length === 4,
    scoreRuns.join(", "),
  );
  const label = (runId) => payload.scores.find((row) => row.run_id === runId)?.label;
  record(
    "Kriteriet hedder det, det hed i kørslens egen version",
    label(C_SCREENING) === "Team (v1)" && label(DEEP) === "Team (v2)",
    `${label(C_SCREENING)} / ${label(DEEP)}`,
  );
  const trust = payload.trust.find((row) => row.run_id === SCREENING);
  record(
    "Datatillid for den viste screening (kun dens egen evidens)",
    Number(trust?.verified) === 1 &&
      Number(trust?.unknown) === 1 &&
      payload.trust.every((row) => [SCREENING, DEEP, C_SCREENING].includes(row.run_id)),
    JSON.stringify(payload.trust),
  );
  record(
    "Kun den nyeste genberegning af screeningen",
    payload.recalcs.length === 1 &&
      Number(payload.recalcs[0]?.overall_score) === 65 &&
      same(payload.recalcs[0]?.failed_gate_keys, []),
    JSON.stringify(payload.recalcs),
  );
  record(
    "Trin kun for kørslen, der er i gang, i trinrækkefølge",
    same(
      payload.steps.map((row) => `${row.run_id === RUNNING ? "aktiv" : "anden"}:${row.step_key}`),
      ["aktiv:cvr_financials", "aktiv:research", "aktiv:score"],
    ),
    JSON.stringify(payload.steps),
  );
  const names = Object.fromEntries(payload.assignees.map((row) => [row.id, row.full_name]));
  record(
    "Navnene på de ansvarlige",
    names[ADMIN] === "Ada Admin" && names[ASSIGNEE] === "Bo Ansvarlig" && !names[OUTSIDER],
    JSON.stringify(names),
  );

  const outsider = await asUser(client, OUTSIDER, PAYLOAD, [FUND, PROFILE]);
  record("Et medlem af en anden fond afvises", outsider.code === "42501", outsider.code);
  const anon = await asUser(client, null, PAYLOAD, [FUND, PROFILE], "anon");
  record("Uden login kan funktionen ikke kaldes", anon.code === "42501", anon.code);
  const missing = await asUser(client, ADMIN, PAYLOAD, [FUND, null]);
  record("Uden profil afvises kaldet", missing.code === "22004", missing.code);
  const otherProfile = await asUser(client, ADMIN, PAYLOAD, [FUND, OLD_PROFILE]);
  const otherC = otherProfile.rows[0]?.payload?.cases.find((row) => row.id === CASE_C);
  record(
    "Med den ældre version som aktiv er dens kørsel i gang den seneste",
    otherC?.latest_run_id === C_STUCK,
    otherProfile.message ?? otherC?.latest_run_id,
  );
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await run(client);
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
