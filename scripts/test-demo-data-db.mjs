#!/usr/bin/env node
/**
 * Self-host demo data (0900) against the database: a fund gets marked demo rows the way
 * `npm run seed:demo` writes them (company, case, person, evidence, a financial point, a finished
 * screening with scores and a finding linked to evidence, a note, an AI task, a decision through
 * transition_case) next to a case of the team's own, and a second fund has a case of its own.
 * `delete_demo_data` must delete exactly the marked rows, leave the team's own case and the other
 * fund alone, write one audit row, keep the demo user's marker for the server, and be callable
 * only by the server. A member sees the markers; someone else does not.
 *
 *   npm run db:local -- fresh && npm run test:demo-data-db
 *
 * Runs against the local test database only (scripts/local-db.mjs).
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const id = (n) => `d9000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FUND = id(1);
const OTHER_FUND = id(2);
const ADMIN = id(3);
const DEMO_USER = id(4);
const OUTSIDER = id(5);
const CONFIG = id(6);
const DEMO_COMPANY = id(7);
const DEMO_CASE = id(8);
const DEMO_PERSON = id(9);
const DEMO_EVIDENCE = id(10);
const DEMO_RUN = id(11);
const OWN_COMPANY = id(12);
const OWN_CASE = id(13);
const OWN_EVIDENCE = id(14);
const OTHER_COMPANY = id(15);
const OTHER_CASE = id(16);
const OTHER_CONFIG = id(17);

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(78)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];
const count = async (client, sql, params = []) => Number((await one(client, sql, params)).n);

async function asRole(client, role, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId ?? "", role }),
    ]);
    const result = await client.query(sql, params);
    await client.query("commit");
    return { rows: result.rows, code: null };
  } catch (cause) {
    await client.query("rollback");
    return { rows: [], code: cause.code, message: cause.message };
  }
}

async function seed(client) {
  const statements = [
    [
      `insert into auth.users (id, email) values
         ($1, 't900-admin@interlect.test'), ($2, 't900-demo@example.com'),
         ($3, 't900-outsider@interlect.test')
       on conflict do nothing`,
      [ADMIN, DEMO_USER, OUTSIDER],
    ],
    [
      `insert into public.funds (id, name, slug) values
         ($1, 'T-900 fond', 't900-fond'), ($2, 'T-900 andet team', 't900-andet')`,
      [FUND, OTHER_FUND],
    ],
    [`insert into public.fund_memberships (fund_id, user_id) values ($1, $2)`, [FUND, ADMIN]],
    [
      `insert into public.fund_membership_roles (membership_id, role)
       select id, 'admin'::public.app_role from public.fund_memberships where fund_id = $1`,
      [FUND],
    ],
    [
      `insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis, created_by)
       values ($1, $2, 1, 't900', 'draft', 'T-900-test', $3), ($4, $5, 1, 't900b', 'draft', 'T-900-test', $3)`,
      [CONFIG, FUND, ADMIN, OTHER_CONFIG, OTHER_FUND],
    ],
    [
      `insert into public.companies (id, fund_id, name, sector, geography, stage) values
         ($1, $2, 'Demo Fjordlight (fictional)', 'climate', 'NO', 'seed'),
         ($3, $2, 'Eget selskab ApS', 'fintech', 'DK', 'seed'),
         ($4, $5, 'Andet team ApS', 'fintech', 'SE', 'seed')`,
      [DEMO_COMPANY, FUND, OWN_COMPANY, OTHER_COMPANY, OTHER_FUND],
    ],
    [
      `insert into public.cases (id, fund_id, company_id, primary_origin, created_by) values
         ($1, $2, $3, 'manual', $4), ($5, $2, $6, 'manual', $7), ($8, $9, $10, 'manual', $7)`,
      [
        DEMO_CASE,
        FUND,
        DEMO_COMPANY,
        DEMO_USER,
        OWN_CASE,
        OWN_COMPANY,
        ADMIN,
        OTHER_CASE,
        OTHER_FUND,
        OTHER_COMPANY,
      ],
    ],
    [
      `insert into public.people (id, fund_id, full_name) values ($1, $2, 'Ingrid Demo (fictional)')`,
      [DEMO_PERSON, FUND],
    ],
    [
      `insert into public.company_people (fund_id, company_id, person_id, role_title, is_founder)
       values ($1, $2, $3, 'CEO', true)`,
      [FUND, DEMO_COMPANY, DEMO_PERSON],
    ],
    [
      `insert into public.evidence_items (id, fund_id, case_id, claim, value_text, stated_by, status, confidence, created_by)
       values ($1, $2, $3, 'ARR', '1.2 MEUR', 'Fictional deck', 'company_stated', 0.7, $4),
              ($5, $2, $6, 'ARR', '3 MDKK', 'Register', 'verified', 0.9, $7)`,
      [DEMO_EVIDENCE, FUND, DEMO_CASE, DEMO_USER, OWN_EVIDENCE, OWN_CASE, ADMIN],
    ],
    [
      `insert into public.financial_data_points (fund_id, case_id, metric, value, unit, period_end, evidence_id)
       values ($1, $2, 'arr', 1200000, 'EUR', '2026-06-30', $3), ($1, $4, 'arr', 3000000, 'DKK', '2026-06-30', $5)`,
      [FUND, DEMO_CASE, DEMO_EVIDENCE, OWN_CASE, OWN_EVIDENCE],
    ],
    [
      `insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status,
         workflow_version, prompt_template_name, prompt_template_version, requested_by, completed_at)
       values ($1, $2, $3, $4, 'screening', 'complete', 'demo-fictional', 'demo', '1', $5, now())`,
      [DEMO_RUN, FUND, DEMO_CASE, CONFIG, DEMO_USER],
    ],
    [
      `insert into public.category_scores (fund_id, run_id, category, validated_score, weight, confidence, rationale)
       values ($1, $2, 'team', 72, 0.25, 0.7, 'Fictional rationale.')`,
      [FUND, DEMO_RUN],
    ],
    [
      `with finding as (
         insert into public.analysis_findings (fund_id, run_id, category, finding_type, statement, confidence, nature, origin)
         values ($1, $2, 'traction_gtm', 'strength', 'Fictional finding.', 0.7, 'company_claim', 'model')
         returning id)
       insert into public.analysis_finding_evidence (fund_id, finding_id, evidence_id, supports)
       select $1, id, $3, true from finding`,
      [FUND, DEMO_RUN, DEMO_EVIDENCE],
    ],
    [
      `insert into public.case_notes (fund_id, case_id, author_id, body)
       values ($1, $2, $3, 'Fictional note.')`,
      [FUND, DEMO_CASE, DEMO_USER],
    ],
    [
      `insert into public.case_tasks (fund_id, case_id, kind, title, origin, dedupe_key, source_run_id, created_by)
       values ($1, $2, 'question', 'Fictional question', 'ai', 't900-task', $3, $4)`,
      [FUND, DEMO_CASE, DEMO_RUN, DEMO_USER],
    ],
    [
      `insert into public.demo_data_rows (fund_id, entity, entity_id) values
         ($1, 'company', $2), ($1, 'case', $3), ($1, 'person', $4), ($1, 'user', $5)`,
      [FUND, DEMO_COMPANY, DEMO_CASE, DEMO_PERSON, DEMO_USER],
    ],
  ];
  for (const [sql, params] of statements) await client.query(sql, params);
  // A decision, as the seed makes it (transition_case as a system move, service role).
  const moved = await asRole(
    client,
    "service_role",
    null,
    `select public.transition_case(
       _fund_id => $1, _case_id => $2, _actor_id => $3, _to_phase => 'decided', _to_status => 'closed',
       _reason_codes => array(select code from public.brain_reason_codes
                              where fund_id = $1 and 'reject' = any(applies_to) and code <> 'other'
                              order by sort_order limit 1),
       _note => 'Fictional decision.', _expected_phase => 'screening', _expected_status => 'active',
       _actor_type => 'system')`,
    [FUND, DEMO_CASE, DEMO_USER],
  );
  if (moved.code) throw new Error(`transition_case: ${moved.message}`);
}

async function cleanup(client) {
  await client.query("rollback").catch(() => {});
  // delete_fund (0037) clears what blocks a fund's deletion and lets the last admin go.
  for (const fund of [FUND, OTHER_FUND]) {
    await client
      .query(
        "select public.delete_fund($1) where exists (select 1 from public.funds where id = $1)",
        [fund],
      )
      .catch((error) => console.error(`cleanup ${fund}: ${error.message}`));
  }
  await client
    .query("delete from auth.users where id = any($1)", [[ADMIN, DEMO_USER, OUTSIDER]])
    .catch((error) => console.error(`cleanup users: ${error.message}`));
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await cleanup(client);
    await seed(client);

    const memberSees = await asRole(
      client,
      "authenticated",
      ADMIN,
      "select count(*)::int as n from public.demo_data_rows where fund_id = $1",
      [FUND],
    );
    record("A member sees the fund's demo markers", memberSees.rows[0]?.n === 4, memberSees);
    const outsiderSees = await asRole(
      client,
      "authenticated",
      OUTSIDER,
      "select count(*)::int as n from public.demo_data_rows where fund_id = $1",
      [FUND],
    );
    record("Someone outside the fund sees none", outsiderSees.rows[0]?.n === 0, outsiderSees);
    const memberWrites = await asRole(
      client,
      "authenticated",
      ADMIN,
      "insert into public.demo_data_rows (fund_id, entity, entity_id) values ($1, 'case', $2)",
      [FUND, OWN_CASE],
    );
    record("A member cannot mark a row as demo", memberWrites.code === "42501", memberWrites);
    const memberDeletes = await asRole(
      client,
      "authenticated",
      ADMIN,
      "select public.delete_demo_data($1, $2)",
      [FUND, ADMIN],
    );
    record(
      "Only the server can call delete_demo_data",
      memberDeletes.code === "42501",
      memberDeletes,
    );

    const deleted = await asRole(
      client,
      "service_role",
      null,
      "select public.delete_demo_data($1, $2) as result",
      [FUND, ADMIN],
    );
    record("delete_demo_data runs", deleted.code === null, deleted);
    const result = deleted.rows[0]?.result ?? {};
    record(
      "It reports what it deleted",
      result.cases === 1 &&
        result.companies === 1 &&
        result.people === 1 &&
        result.runs === 1 &&
        result.financialPoints === 1 &&
        JSON.stringify(result.users) === JSON.stringify([DEMO_USER]),
      result,
    );

    record(
      "The demo case, company and person are gone",
      (await count(client, "select count(*) as n from public.cases where id = $1", [DEMO_CASE])) ===
        0 &&
        (await count(client, "select count(*) as n from public.companies where id = $1", [
          DEMO_COMPANY,
        ])) === 0 &&
        (await count(client, "select count(*) as n from public.people where id = $1", [
          DEMO_PERSON,
        ])) === 0,
    );
    record(
      "Everything on the demo case is gone (evidence, run, scores, notes, tasks, history)",
      (await count(
        client,
        `select (select count(*) from public.evidence_items where case_id = $1)
              + (select count(*) from public.analysis_runs where id = $2)
              + (select count(*) from public.category_scores where run_id = $2)
              + (select count(*) from public.case_notes where case_id = $1)
              + (select count(*) from public.case_tasks where case_id = $1)
              + (select count(*) from public.case_transition_events where case_id = $1) as n`,
        [DEMO_CASE, DEMO_RUN],
      )) === 0,
    );
    record(
      "The team's own case, evidence and figures stay",
      (await count(client, "select count(*) as n from public.cases where id = $1", [OWN_CASE])) ===
        1 &&
        (await count(client, "select count(*) as n from public.evidence_items where id = $1", [
          OWN_EVIDENCE,
        ])) === 1 &&
        (await count(
          client,
          "select count(*) as n from public.financial_data_points where case_id = $1",
          [OWN_CASE],
        )) === 1,
    );
    record(
      "The other fund is untouched",
      (await count(client, "select count(*) as n from public.cases where id = $1", [
        OTHER_CASE,
      ])) === 1,
    );
    const markers = await client.query(
      "select entity from public.demo_data_rows where fund_id = $1 order by entity",
      [FUND],
    );
    record(
      "Only the demo user's marker is left (the server deletes the user)",
      JSON.stringify(markers.rows.map((row) => row.entity)) === JSON.stringify(["user"]),
      markers.rows,
    );
    const audit = await client.query(
      `select actor_id, entity_id, payload from public.audit_events
        where fund_id = $1 and action = 'demo_data.deleted'`,
      [FUND],
    );
    record(
      "One audit row names the admin and the counts",
      audit.rows.length === 1 &&
        audit.rows[0].actor_id === ADMIN &&
        audit.rows[0].payload.cases === 1 &&
        audit.rows[0].payload.users === 1,
      audit.rows,
    );

    const again = await asRole(
      client,
      "service_role",
      null,
      "select public.delete_demo_data($1, $2) as result",
      [FUND, ADMIN],
    );
    record(
      "A second run deletes nothing more",
      again.code === null &&
        again.rows[0]?.result?.cases === 0 &&
        (await count(client, "select count(*) as n from public.cases where id = $1", [
          OWN_CASE,
        ])) === 1,
      again,
    );
  } finally {
    // Never leave the connection open: a failed clean-up must not hang the CI job.
    try {
      await cleanup(client);
    } finally {
      await client.end();
    }
  }

  console.log(`\n${results.passed} passed, ${results.failures.length} failed`);
  if (results.failures.length > 0) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
