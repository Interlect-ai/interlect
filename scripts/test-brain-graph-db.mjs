#!/usr/bin/env node
/**
 * Hjernekortets data i databasen: brain_graph_payload med 5.000 punkter, 20.000
 * koblinger og 3.000 tidligere beslutninger, hvad der er med og ikke med, beslutninger med årsag,
 * noter, lofterne, og at kun fondens egne medlemmer får data.
 *
 *   npm run db:local -- fresh && npm run test:brain-graph-db
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything runs in one transaction that is rolled
 * back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND_A = "a4000000-0000-4000-8000-00000000000a";
const FUND_B = "b4000000-0000-4000-8000-00000000000b";
const ADMIN_A = "a4000000-0000-4000-8000-000000000001";
const ADMIN_B = "b4000000-0000-4000-8000-000000000001";
const COMPANY_A = "a4000000-0000-4000-8000-0000000000c1";
const CASE_A = "a4000000-0000-4000-8000-0000000000c2";
const NOTE_A = "a4000000-0000-4000-8000-0000000000e2";
const SOURCE_A = "a4000000-0000-4000-8000-0000000000f1";

const E = {
  company: "a4000000-0000-4000-8000-000000000101",
  caseEntity: "a4000000-0000-4000-8000-000000000102",
  person: "a4000000-0000-4000-8000-000000000103",
  sector: "a4000000-0000-4000-8000-000000000104",
  reason: "a4000000-0000-4000-8000-000000000105",
  metric: "a4000000-0000-4000-8000-000000000106",
  merged: "a4000000-0000-4000-8000-000000000107",
  rival: "a4000000-0000-4000-8000-000000000108",
  portfolio: "a4000000-0000-4000-8000-000000000109",
  reason2: "a4000000-0000-4000-8000-00000000010a",
  case2: "a4000000-0000-4000-8000-00000000010b",
  mergedCo: "a4000000-0000-4000-8000-00000000010c",
  otherFund: "b4000000-0000-4000-8000-000000000101",
};
const BULK = 5_000;
const BULK_FACTS = 20_000;
const HISTORY = 3_000;

const SEED = `
  insert into auth.users (id, email) values
    ('${ADMIN_A}', 'graph-admin-a@interlect.test'), ('${ADMIN_B}', 'graph-admin-b@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${FUND_A}', 'Graf fond A', 'graf-fond-a'), ('${FUND_B}', 'Graf fond B', 'graf-fond-b');
  insert into public.fund_memberships (fund_id, user_id) values
    ('${FUND_A}', '${ADMIN_A}'), ('${FUND_B}', '${ADMIN_B}');
  insert into public.companies (id, fund_id, name) values ('${COMPANY_A}', '${FUND_A}', 'Nordlys ApS');
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by) values
    ('${CASE_A}', '${FUND_A}', '${COMPANY_A}', 'manual', '${ADMIN_A}');
  insert into public.case_notes (id, fund_id, case_id, author_id, body, created_at)
  values ('${NOTE_A}', '${FUND_A}', '${CASE_A}', '${ADMIN_A}', 'Fortrolig note om teamet.',
    '2026-03-01T10:00:00Z');

  insert into public.brain_entities (id, fund_id, type, name, normalized_key, ref_table, ref_id,
    status, first_seen_at, last_seen_at)
  values
    ('${E.company}', '${FUND_A}', 'company', 'Nordlys ApS', 'name:nordlys', 'companies', '${COMPANY_A}', 'active', '2026-01-01', now()),
    ('${E.caseEntity}', '${FUND_A}', 'case', 'Nordlys (case)', 'case:${CASE_A}', 'cases', '${CASE_A}', 'active', '2026-01-02', now()),
    ('${E.person}', '${FUND_A}', 'person', 'Mette Holm', 'name:mette holm', null, null, 'active', '2026-01-03', now()),
    ('${E.sector}', '${FUND_A}', 'sector', 'Klima', 'sector:klima', null, null, 'active', '2026-01-04', now()),
    ('${E.reason}', '${FUND_A}', 'reason', 'For tidligt', 'reason:for_tidligt', null, null, 'active', '2026-01-05', now()),
    ('${E.metric}', '${FUND_A}', 'metric', 'revenue', 'metric:revenue', null, null, 'active', '2026-01-06', now()),
    ('${E.merged}', '${FUND_A}', 'company', 'Nordlys gammel', 'name:nordlys gammel', null, null, 'merged', '2026-01-07', now()),
    ('${E.rival}', '${FUND_A}', 'company', 'Solvind', 'name:solvind', null, null, 'active', '2026-01-08', now()),
    ('${E.portfolio}', '${FUND_A}', 'company', 'Vivino', 'domain:vivino.com', null, null, 'active', '2026-01-09', now()),
    ('${E.reason2}', '${FUND_A}', 'reason', 'Svagt team', 'reason:svagt_team', null, null, 'active', '2026-01-10', now()),
    ('${E.case2}', '${FUND_A}', 'case', 'Solvind (case)', 'case:solvind', null, null, 'active', '2026-01-11', now()),
    ('${E.otherFund}', '${FUND_B}', 'company', 'Hemmelig B', 'name:hemmelig b', null, null, 'active', '2026-01-01', now());
  -- A company merged into Solvind after the decision file was imported.
  insert into public.brain_entities (id, fund_id, type, name, normalized_key, status, merged_into)
  values ('${E.mergedCo}', '${FUND_A}', 'company', 'Solvind A/S', 'name:solvind as', 'merged', '${E.rival}');

  insert into public.brain_facts (fund_id, subject_id, predicate, object_id, value_text, statement,
    trust_tier, status, origin, expired_at, valid_from, valid_to, recorded_at)
  values
    ('${FUND_A}', '${E.company}', 'has_case', '${E.caseEntity}', null, 'Nordlys har en case.', 'partner', 'active', 'db', null, null, null, '2026-01-02'),
    ('${FUND_A}', '${E.company}', 'founded_by', '${E.person}', null, 'Nordlys er grundlagt af Mette Holm.', 'partner', 'active', 'db', null, null, null, '2026-01-03'),
    ('${FUND_A}', '${E.company}', 'in_sector', '${E.sector}', null, 'Nordlys er i klima.', 'partner', 'active', 'db', null, null, null, '2026-01-04'),
    ('${FUND_A}', '${E.company}', 'metric', '${E.metric}', 'revenue', 'Omsætning 10.', 'official', 'active', 'db', null, null, null, '2026-01-06'),
    ('${FUND_A}', '${E.company}', 'competes_with', '${E.rival}', null, 'Nordlys konkurrerer med Solvind.', 'public_web', 'proposed', 'extracted', null, null, null, '2026-01-08'),
    ('${FUND_A}', '${E.company}', 'partner_of', '${E.rival}', null, 'Afvist påstand.', 'analysis', 'rejected', 'extracted', null, null, null, '2026-01-08'),
    ('${FUND_A}', '${E.company}', 'customer_of', '${E.rival}', null, 'Udløbet.', 'analysis', 'active', 'extracted', now(), null, null, '2026-01-08'),
    -- One decision with two reasons, one without a reason, and one that was reopened later.
    ('${FUND_A}', '${E.caseEntity}', 'decided', '${E.reason}', 'reject', 'Kasseret 2026-03-02 (Nordlys). Årsag: For tidligt.', 'partner', 'active', 'db', null, '2026-03-02', null, '2026-03-02'),
    ('${FUND_A}', '${E.caseEntity}', 'decided', '${E.reason2}', 'reject', 'Kasseret 2026-03-02 (Nordlys). Årsag: Svagt team.', 'partner', 'active', 'db', null, '2026-03-02', null, '2026-03-02'),
    ('${FUND_A}', '${E.case2}', 'decided', null, 'decline_ic', 'Afvist i komitéen 2026-04-01 (Solvind).', 'partner', 'active', 'db', null, '2026-04-01', null, '2026-04-01'),
    ('${FUND_A}', '${E.caseEntity}', 'decided', null, 'invest', 'Investeret, men genåbnet.', 'partner', 'active', 'db', null, '2025-01-01', '2025-06-01', '2025-01-01');

  insert into public.brain_sources (id, fund_id, kind, title, trust_tier, created_by)
  values ('${SOURCE_A}', '${FUND_A}', 'csv', 'Tidligere beslutninger', 'customer_doc', '${ADMIN_A}');
  insert into public.brain_historical_decisions (fund_id, brain_source_id, company_name,
    company_entity_id, decided_on, movement_kind, reason_codes, row_hash, imported_by)
  values
    ('${FUND_A}', '${SOURCE_A}', 'Vivino', '${E.portfolio}', '2024-05-01', 'invest',
      '{for_tidligt}', 'hash-vivino-1', '${ADMIN_A}'),
    ('${FUND_A}', '${SOURCE_A}', 'Solvind A/S', '${E.mergedCo}', '2023-02-01', 'reject',
      '{ukendt_kode}', 'hash-solvind-1', '${ADMIN_A}');

  -- 5.000 points and 20.000 links in the same fund (a fund that has used Interlect for a while).
  insert into public.brain_entities (fund_id, type, name, normalized_key, status, first_seen_at)
  select '${FUND_A}', (array['company','person','sector','theme'])[1 + (i % 4)], 'Punkt ' || i,
    'bulk:' || i, 'active', timestamptz '2025-01-01' + make_interval(hours => i)
  from generate_series(1, ${BULK}) as i;
  insert into public.brain_facts (fund_id, subject_id, predicate, object_id, statement, trust_tier,
    status, origin)
  select '${FUND_A}', s.id, 'similar_to', o.id, 'Ligner.', 'analysis', 'active', 'derived'
  from generate_series(0, ${BULK_FACTS} - 1) as k
  join public.brain_entities s on s.fund_id = '${FUND_A}'
    and s.normalized_key = 'bulk:' || (1 + k % ${BULK})
  join public.brain_entities o on o.fund_id = '${FUND_A}'
    and o.normalized_key = 'bulk:' || (1 + (k % ${BULK} + 1 + (k / ${BULK}) * 101) % ${BULK});

  -- 3.000 earlier decisions from a decision file, each with a reason (a past performance trap).
  insert into public.brain_historical_decisions (fund_id, brain_source_id, company_name,
    company_entity_id, decided_on, movement_kind, reason_codes, row_hash, imported_by)
  select '${FUND_A}', '${SOURCE_A}', 'Punkt ' || i, e.id, date '2020-01-01' + i, 'reject',
    '{for_tidligt}', 'hash-bulk-' || i, '${ADMIN_A}'
  from generate_series(1, ${HISTORY}) as i
  join public.brain_entities e on e.fund_id = '${FUND_A}' and e.normalized_key = 'bulk:' || i;
`;

const results = { passed: 0, failures: [] };

function record(name, ok, detail = "") {
  console.log(`${name.padEnd(80)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs sql as a signed-in user (like PostgREST) inside a savepoint that is rolled back. */
async function asUser(client, userId, sql, params = [], role = "authenticated") {
  await client.query("savepoint graph_user");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    const result = await client.query(sql, params);
    return { rows: result.rows, code: null };
  } catch (cause) {
    return { rows: [], code: cause.code, message: cause.message };
  } finally {
    await client.query("rollback to savepoint graph_user");
  }
}

const PAYLOAD = "select public.brain_graph_payload($1) as payload";

async function run(client) {
  await client.query(SEED);
  const { rows: expected } = await client.query(
    `select count(*)::int as n from public.brain_entities
     where fund_id = $1 and status = 'active' and type <> 'metric'`,
    [FUND_A],
  );
  // The dates must not depend on the session's time zone.
  await client.query("set timezone = 'Europe/Copenhagen'");

  const started = Date.now();
  const answer = await asUser(client, ADMIN_A, PAYLOAD, [FUND_A]);
  const ms = Date.now() - started;
  const payload = answer.rows[0]?.payload;
  record("a member gets the payload", answer.code === null && payload, answer.message);
  if (!payload) return;
  const { nodes, edges, preds } = payload;
  const n = nodes.ids.length;
  const m = edges.src.length;
  const size = JSON.stringify(payload).length;
  console.log(`    ${n} punkter, ${m} koblinger, ${size} tegn, ${ms} ms`);
  record("all points come back whole, in one call", n >= BULK && payload.truncated === false);
  record("in under 3 s, also with 3.000 earlier decisions", ms < 3_000, `${ms} ms`);
  record("well under Vercel's 4,5 MB response limit", size < 2_000_000, `${size}`);
  record(
    "every node column has one value per point",
    ["types", "labels", "first_seen", "decision", "ref"].every((key) => nodes[key].length === n),
  );
  record(
    "every edge column has one value per link",
    ["dst", "pred", "proposed", "recorded"].every((key) => edges[key].length === m),
  );
  record(
    "edges are indexes into the points and the predicates",
    edges.src.every((i, k) => i >= 0 && i < n && edges.dst[k] >= 0 && edges.dst[k] < n) &&
      edges.pred.every((p) => p >= 0 && p < preds.length),
  );
  record("no point id comes twice", new Set(nodes.ids).size === n);
  record("all 20.000 bulk links are there", m >= BULK_FACTS, `${m}`);
  record(
    "points are ordered by when Brain first saw them (growth replay)",
    nodes.first_seen.every((t, i) => i === 0 || nodes.first_seen[i - 1] <= t),
  );

  const decisionCount = 2 + 2 + HISTORY;
  record(
    `points = active entities (no key figures) + ${decisionCount} decisions + 1 note`,
    n === expected[0].n + decisionCount + 1,
    `${n} vs ${expected[0].n + decisionCount + 1}`,
  );
  const at = (id) => nodes.ids.indexOf(id);
  record(
    "key figures, merged entities and other funds are not points",
    [E.metric, E.merged, E.mergedCo, E.otherFund].every((id) => at(id) === -1),
  );

  const edge = (src, dst, pred) =>
    edges.src.findIndex(
      (s, k) => s === src && edges.dst[k] === dst && preds[edges.pred[k]] === pred,
    );
  const linksFrom = (i, pred) =>
    edges.src.flatMap((s, k) => (s === i && preds[edges.pred[k]] === pred ? [edges.dst[k]] : []));
  const company = at(E.company);
  const rival = at(E.rival);
  record("a confirmed fact is a link", edge(company, at(E.person), "founded_by") >= 0);
  const proposed = edge(company, rival, "competes_with");
  record(
    "a proposed fact is a link marked as not confirmed",
    proposed >= 0 && edges.proposed[proposed] === true,
  );
  record(
    "rejected and expired facts are no links",
    edge(company, rival, "partner_of") === -1 && edge(company, rival, "customer_of") === -1,
  );
  record("key-figure facts are no links", !preds.includes("metric"));

  const caseNode = at(E.caseEntity);
  record(
    "the case carries its standing decision and its case id",
    nodes.decision[caseNode] === "reject" && nodes.ref[caseNode] === CASE_A,
  );
  const decisionPoints = (kind) =>
    nodes.types.flatMap((t, i) => (t === "decision" && nodes.decision[i] === kind ? [i] : []));
  const caseDecisions = decisionPoints("reject").filter((i) =>
    linksFrom(i, "decided").includes(caseNode),
  );
  const decision = caseDecisions[0] ?? -1;
  record(
    "a decision with two reasons is one point, with kind, date and its case",
    caseDecisions.length === 1 &&
      nodes.labels[decision] === "Kasseret 02.03.2026" &&
      nodes.ref[decision] === CASE_A,
    nodes.labels[decision],
  );
  record(
    "decision → case and → both reasons",
    edge(decision, at(E.reason), "because_of") >= 0 &&
      edge(decision, at(E.reason2), "because_of") >= 0,
  );
  const declined = decisionPoints("decline_ic");
  record(
    "a decision without a reason is a point linked only to its case",
    declined.length === 1 &&
      edge(declined[0], at(E.case2), "decided") >= 0 &&
      linksFrom(declined[0], "because_of").length === 0,
  );
  record(
    "a reopened decision is no point",
    decisionPoints("invest").every((i) => !linksFrom(i, "decided").includes(caseNode)),
  );
  const merged = decisionPoints("reject").find((i) => linksFrom(i, "decided").includes(rival));
  record(
    "a decision on a company merged away is shown on the company it became",
    merged !== undefined && nodes.decision[rival] === "reject",
  );
  record(
    "a reason code without a reason point gives the decision no reason link",
    merged !== undefined && linksFrom(merged, "because_of").length === 0,
  );
  const historical =
    decisionPoints("invest").find((i) => linksFrom(i, "decided").includes(at(E.portfolio))) ?? -1;
  record(
    "a historical decision links to its company and reason, and colours the company",
    historical >= 0 &&
      edge(historical, at(E.reason), "because_of") >= 0 &&
      nodes.decision[at(E.portfolio)] === "invest",
  );
  record(
    "dates are read in UTC, whatever the session's time zone",
    nodes.labels[historical] === "Investeret 01.05.2024",
    nodes.labels[historical],
  );
  const note = at(NOTE_A);
  record(
    "a note is a point on its case, labelled by date without its text",
    note >= 0 &&
      nodes.labels[note] === "Note 01.03.2026" &&
      nodes.ref[note] === CASE_A &&
      edge(note, caseNode, "note_on") >= 0 &&
      !JSON.stringify(payload).includes("Fortrolig"),
  );
  record("no fact statements are sent", !JSON.stringify(payload).includes("grundlagt af"));

  const again = await asUser(client, ADMIN_A, PAYLOAD, [FUND_A]);
  record(
    "a decision keeps its id when the graph is built again",
    again.rows[0]?.payload?.nodes?.ids?.[decision] === nodes.ids[decision],
  );
  const small = await asUser(
    client,
    ADMIN_A,
    "select public.brain_graph_payload($1, 100, 50) as payload",
    [FUND_A],
  );
  const capped = small.rows[0]?.payload;
  record(
    "over the limits, points and links are cut, still consistent, and marked as cut",
    capped?.truncated === true &&
      capped.nodes.ids.length === 100 &&
      capped.edges.src.length <= 50 &&
      capped.edges.src.every((i, k) => i < 100 && capped.edges.dst[k] < 100),
  );
  const huge = await asUser(
    client,
    ADMIN_A,
    "select public.brain_graph_payload($1, 999999, 999999) as payload",
    [FUND_A],
  );
  record(
    "the limits cannot be raised by the caller",
    (huge.rows[0]?.payload?.nodes?.ids?.length ?? 0) <= 15_000,
  );

  const other = await asUser(client, ADMIN_B, PAYLOAD, [FUND_A]);
  record("a member of another fund is refused", other.code === "42501", other.code ?? "no error");
  const { rows: privilege } = await client.query(
    `select has_function_privilege('anon', 'public.brain_graph_payload(uuid, int, int)', 'execute') as anon_can,
            has_function_privilege('authenticated', 'public.brain_graph_payload(uuid, int, int)', 'execute') as user_can`,
  );
  record(
    "anon has no right to run it; signed-in users have",
    privilege[0].anon_can === false && privilege[0].user_can === true,
  );
  const own = await asUser(client, ADMIN_B, PAYLOAD, [FUND_B]);
  const ownIds = own.rows[0]?.payload?.nodes?.ids ?? [];
  record("fund B sees only its own point", ownIds.length === 1 && ownIds[0] === E.otherFund);
  const service = await asUser(client, null, PAYLOAD, [FUND_A], "service_role");
  record(
    "the server's service role can build it",
    service.rows[0]?.payload?.nodes?.ids?.length === n,
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
  console.log(`\n${results.passed} bestået, ${results.failures.length} fejlet`);
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
