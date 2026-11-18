#!/usr/bin/env node
/**
 * "Glem person" i databasen: hvert lager, som findes nu, er testet.
 *
 *   npm run db:local -- fresh && npm run test:forget-person-db
 *
 * Kører kun mod den lokale testdatabase (scripts/local-db.mjs). Alt kører i én transaktion, der
 * rulles tilbage. Testen har to personer: Anders (glemmes) og Bente (må ikke røres), og en anden
 * fond, hvor et navn med samme ord ikke må røres.
 */
import pg from "pg";
import { exportFundData } from "./lib/export-fund.ts";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND = "f3000000-0000-4000-8000-00000000000a";
const OTHER_FUND = "f3000000-0000-4000-8000-00000000000b";
const USER = "f3000000-0000-4000-8000-000000000001";
const OTHER_USER = "f3000000-0000-4000-8000-000000000002";
const COMPANY = "f3000000-0000-4000-8000-0000000000c1";
const CASE = "f3000000-0000-4000-8000-0000000000c2";
const CONFIG = "f3000000-0000-4000-8000-0000000000c3";
const RUN = "f3000000-0000-4000-8000-0000000000d1";
const ANDERS = "f3000000-0000-4000-8000-0000000000a1";
const BENTE = "f3000000-0000-4000-8000-0000000000a2";
const E_ANDERS = "f3000000-0000-4000-8000-0000000000e1";
const E_BENTE = "f3000000-0000-4000-8000-0000000000e2";
const E_COMPANY = "f3000000-0000-4000-8000-0000000000e3";
const NAME = "Anders Nørregaard Jensen";
const HOLDING = "f3000000-0000-4000-8000-0000000000c6";
const HOLDING_CASE = "f3000000-0000-4000-8000-0000000000c7";
const E_METHOD = "f3000000-0000-4000-8000-0000000000ea";
const E_OLD_METHOD = "f3000000-0000-4000-8000-0000000000eb";
const EMAIL = "anders.jensen@pleo-test.dk";

const VECTOR = "(select array_fill(0.1::real, array[1536])::vector)";

const results = { passed: 0, failures: [] };

function record(name, ok, detail = "") {
  console.log(`${name.padEnd(86)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function one(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

async function count(client, sql, params = []) {
  return Number((await one(client, sql, params)).n);
}

async function asService(client, sql, params = []) {
  await client.query("set local role service_role");
  try {
    return await client.query(sql, params);
  } finally {
    await client.query("reset role").catch(() => {});
  }
}

async function expectError(client, sql, pattern, params = []) {
  await client.query("savepoint forget_err");
  try {
    await client.query(sql, params);
    return "ingen fejl";
  } catch (cause) {
    return pattern.test(cause.message) ? true : cause.message;
  } finally {
    await client.query("rollback to savepoint forget_err");
  }
}

async function seed(client) {
  const q = (sql, params = []) => client.query(sql, params);
  await q(`insert into auth.users (id, email) values
    ('${USER}', 'forget-a@interlect.test'), ('${OTHER_USER}', 'forget-b@interlect.test')`);
  await q(`insert into public.funds (id, name, slug) values
    ('${FUND}', 'Glem fond', 'glem-fond'), ('${OTHER_FUND}', 'Anden fond', 'anden-fond')`);
  await q(`insert into public.fund_memberships (fund_id, user_id) values
    ('${FUND}', '${USER}'), ('${OTHER_FUND}', '${OTHER_USER}')`);
  await q(`insert into public.companies (id, fund_id, name, sector, geography, stage, description)
    values ('${COMPANY}', '${FUND}', 'Pleo Test ApS', 'fintech', 'DK', 'seed',
            'Grundlagt af ${NAME}. Bente Holm er CFO.')`);
  await q(`insert into public.people (id, fund_id, full_name, email, linkedin_url) values
    ('${ANDERS}', '${FUND}', '${NAME}', '${EMAIL}', 'https://linkedin.com/in/anders-jensen-test'),
    ('${BENTE}', '${FUND}', 'Bente Holm', 'bente@pleo-test.dk', null)`);
  await q(`insert into public.company_people (fund_id, company_id, person_id, role_title) values
    ('${FUND}', '${COMPANY}', '${ANDERS}', 'CEO'), ('${FUND}', '${COMPANY}', '${BENTE}', 'CFO')`);
  await q(`insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
    values ('${CASE}', '${FUND}', '${COMPANY}', 'manual', '${USER}')`);
  await q(`insert into public.fund_config_versions (id, fund_id, version, profile_key, status, source_basis, created_by)
    values ('${CONFIG}', '${FUND}', 99, 'forget-test', 'draft', 'forget-test', '${USER}')`);
  await q(`insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status,
      workflow_version, prompt_template_name, prompt_template_version, requested_by, raw_response)
    values ('${RUN}', '${FUND}', '${CASE}', '${CONFIG}', 'screening', 'complete', 'v1', 't', '1', '${USER}',
      '{"summary": "Teamet: ${NAME} (CEO) og \\"Bente Holm\\"."}'::jsonb)`);
  await q(`insert into public.analysis_run_steps (fund_id, run_id, step_key, step_order, output_json, error_message)
    values ('${FUND}', '${RUN}', 'screening_research', 1,
      '{"founders": ["${NAME}", "Bente Holm"], "note": "kontakt ${EMAIL}"}'::jsonb, null)`);
  await q(`insert into public.evidence_items (fund_id, case_id, claim, value_text, stated_by, excerpt, status, confidence, created_by)
    values ('${FUND}', '${CASE}', 'CEO er ${NAME}', 'stor erfaring', 'Deck', 'Citat: ${NAME} grundlagde firmaet', 'company_stated', 0.8, '${USER}'),
           ('${FUND}', '${CASE}', 'CFO er Bente Holm', '1 mio.', 'Deck', null, 'company_stated', 0.8, '${USER}')`);
  await q(`insert into public.case_notes (fund_id, case_id, author_id, body)
    values ('${FUND}', '${CASE}', '${USER}', 'Mødte ${NAME.toUpperCase()} og Bente Holm i dag.')`);
  await q(`insert into public.recommendations (fund_id, run_id, recommendation, rationale)
    select '${FUND}', '${RUN}', e.enumlabel::public.pap_recommendation, 'Stærkt hold med ${NAME}.'
    from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'pap_recommendation' limit 1`);
  await q(`insert into public.case_transition_events (fund_id, case_id, field, actor_type, new_value, movement_kind, reason)
    values ('${FUND}', '${CASE}', 'process_stage', 'user', 'lost', 'reject', 'Droppede, fordi ${NAME} forlod firmaet')`);

  // Brain: entiteter, fakta, episoder, tekststykker.
  await q(`insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key, ref_table, ref_id, summary, embedding)
    values ('${E_ANDERS}', '${FUND}', 'person', '${NAME}', array['Anders Jensen'], 'anders-noerregaard-jensen', 'people', '${ANDERS}', 'Grundlægger.', ${VECTOR}),
           ('${E_BENTE}', '${FUND}', 'person', 'Bente Holm', '{}', 'bente-holm', 'people', '${BENTE}', 'CFO.', ${VECTOR}),
           ('${E_COMPANY}', '${FUND}', 'company', 'Pleo Test ApS', '{}', 'pleo-test', 'companies', '${COMPANY}',
            'Selskabet blev stiftet af ${NAME} i 2019.', ${VECTOR})`);
  await q(`insert into public.brain_episodes (id, fund_id, kind, ref_table, ref_id, case_id, trust_tier, title, content, content_hash)
    values ('f3000000-0000-4000-8000-0000000000f1', '${FUND}', 'identity', 'people', '${ANDERS}', '${CASE}', 'official', '${NAME}', '${NAME}, CEO', 'hash-identity-anders'),
           ('f3000000-0000-4000-8000-0000000000f2', '${FUND}', 'case_note', 'case_notes', gen_random_uuid(), '${CASE}', 'user_note', 'Note', 'Mødte ${NAME} og Bente Holm.', 'hash-note-1'),
           ('f3000000-0000-4000-8000-0000000000f3', '${FUND}', 'evidence', 'evidence_items', gen_random_uuid(), '${CASE}', 'company_claim', 'Ingen navne', 'Bente Holm er CFO.', 'hash-bente-only')`);
  await q(`insert into public.brain_chunks (fund_id, episode_id, ordinal, content, token_count, embedding)
    values ('${FUND}', 'f3000000-0000-4000-8000-0000000000f2', 0, 'Mødte ${NAME} og Bente Holm.', 8, ${VECTOR}),
           ('${FUND}', 'f3000000-0000-4000-8000-0000000000f3', 0, 'Bente Holm er CFO.', 5, ${VECTOR})`);
  await q(`insert into public.brain_facts (id, fund_id, subject_id, predicate, object_id, statement, trust_tier, origin, status, embedding)
    values ('f3000000-0000-4000-8000-000000000a01', '${FUND}', '${E_COMPANY}', 'founded_by', '${E_ANDERS}', 'Pleo blev grundlagt af ${NAME}', 'official', 'extracted', 'active', ${VECTOR}),
           ('f3000000-0000-4000-8000-000000000a02', '${FUND}', '${E_ANDERS}', 'works_at', '${E_COMPANY}', '${NAME} er CEO', 'official', 'extracted', 'active', ${VECTOR}),
           ('f3000000-0000-4000-8000-000000000a03', '${FUND}', '${E_COMPANY}', 'claims', null, 'Selskabet siger, at ${NAME} har bygget produktet', 'company_claim', 'extracted', 'proposed', ${VECTOR}),
           ('f3000000-0000-4000-8000-000000000a04', '${FUND}', '${E_BENTE}', 'works_at', '${E_COMPANY}', 'Bente Holm er CFO', 'official', 'extracted', 'active', ${VECTOR})`);
  await q(`insert into public.brain_fact_episodes (fact_id, episode_id, fund_id, quote) values
    ('f3000000-0000-4000-8000-000000000a01', 'f3000000-0000-4000-8000-0000000000f2', '${FUND}', 'grundlagt af ${NAME}'),
    ('f3000000-0000-4000-8000-000000000a03', 'f3000000-0000-4000-8000-0000000000f2', '${FUND}', '${NAME} har bygget produktet'),
    ('f3000000-0000-4000-8000-000000000a04', 'f3000000-0000-4000-8000-0000000000f3', '${FUND}', 'Bente Holm er CFO')`);
  await q(`insert into public.brain_insights (fund_id, kind, title, body_md, created_by_loop)
    values ('${FUND}', 'pattern', 'Mønster: ${NAME}', 'Grundlæggere som ${NAME} lykkes.', 'L5_weekly'),
           ('${FUND}', 'pattern', 'Bente-mønster', 'Bente Holm som CFO.', 'L5_weekly')`);
  await q(`insert into public.brain_threads (id, fund_id, user_id, title)
    values ('f3000000-0000-4000-8000-000000000b01', '${FUND}', '${USER}', 'Hvem er ${NAME}?')`);
  await q(`insert into public.brain_messages (id, fund_id, thread_id, role, content, citations, tool_calls)
    values ('f3000000-0000-4000-8000-000000000b02', '${FUND}', 'f3000000-0000-4000-8000-000000000b01', 'user', 'Hvem er ${NAME}?', '[]'::jsonb, null),
           ('f3000000-0000-4000-8000-000000000b03', '${FUND}', 'f3000000-0000-4000-8000-000000000b01', 'assistant', 'Svar om ${NAME}',
            '[{"n": 1, "quote": "grundlagt af ${NAME}"}]'::jsonb, '[{"name": "find", "args": {"q": "${NAME}"}}]'::jsonb)`);
  await q(`insert into public.brain_retrieval_events (fund_id, message_id, query, candidates)
    values ('${FUND}', 'f3000000-0000-4000-8000-000000000b03', '${NAME}', '[{"text": "${NAME} er CEO"}]'::jsonb)`);
  await q(`insert into public.brain_feedback (fund_id, message_id, user_id, rating, comment)
    values ('${FUND}', 'f3000000-0000-4000-8000-000000000b03', '${USER}', 'wrong', '${NAME} er forkert')`);
  await q(`insert into public.companies (id, fund_id, name, sector, geography, stage)
    values ('f3000000-0000-4000-8000-0000000000c4', '${FUND}', 'Anden ApS', 'saas', 'DK', 'seed')`);
  await q(`insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
    values ('f3000000-0000-4000-8000-0000000000c5', '${FUND}', 'f3000000-0000-4000-8000-0000000000c4', 'manual', '${USER}')`);
  await q(`insert into public.fund_memory_entries (fund_id, case_id, company_name, decision, summary_text, embedding)
    values ('${FUND}', '${CASE}', 'Gammel ApS', 'closed_without_investment', 'Afvist; stifteren ${NAME} manglede erfaring.', ${VECTOR}),
           ('${FUND}', 'f3000000-0000-4000-8000-0000000000c5', 'Anden ApS', 'closed_without_investment', 'Afvist af anden grund.', ${VECTOR})`);
  await asService(
    client,
    `insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after, reason)
     values ('${FUND}', 'L1_extract', 'insert', 'fact', 'f3000000-0000-4000-8000-000000000a01', null,
             '{"statement": "Pleo blev grundlagt af ${NAME}"}'::jsonb, null),
            ('${FUND}', 'system', 'update', 'entity', gen_random_uuid(), null,
             '{"summary": "${NAME}"}'::jsonb, 'omtale af ${NAME}'),
            ('${FUND}', 'system', 'update', 'entity', gen_random_uuid(), null, '{"summary": "Bente Holm"}'::jsonb, null)`,
  );

  // Kilde og dokument, hvis titel og filnavn bærer navnet: capture læser dem (review: capture må ikke
  // genskabe navnet).
  await q(`insert into public.sources (id, fund_id, case_id, title, source_type, url)
    values ('f3000000-0000-4000-8000-000000000c01', '${FUND}', '${CASE}', '${NAME} – LinkedIn', 'official_registry',
            'https://linkedin.com/in/anders-jensen-test')`);
  await q(`insert into public.evidence_items (fund_id, case_id, source_id, claim, value_text, status, confidence, created_by)
    values ('${FUND}', '${CASE}', 'f3000000-0000-4000-8000-000000000c01', 'Erfaring fra tidligere roller', '10 år', 'verified', 0.9, '${USER}')`);
  await q(`insert into public.documents (fund_id, case_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by, extracted_text)
    values ('${FUND}', '${CASE}', 'other', 'CV ${NAME}.pdf', '${FUND}/cv.pdf', 'application/pdf', 10, '${USER}',
            'Anders' || E'\\n' || 'Nørregaard Jensen har bygget selskabet.')`);
  // En udtrukket dublet af personen (L1: ingen henvisning til people) og to personer med næsten samme navn.
  await q(`insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key)
    values ('f3000000-0000-4000-8000-0000000000e4', '${FUND}', 'person', '${NAME}', '{}', 'name:anders-noerregaard-jensen@pleo'),
           ('f3000000-0000-4000-8000-0000000000e5', '${FUND}', 'person', 'Anders Nørregaard Jensen-Berg', '{}', 'name:anders-jensen-berg@x')`);
  await q(`insert into public.brain_facts (id, fund_id, subject_id, predicate, statement, trust_tier, origin, status)
    values ('f3000000-0000-4000-8000-000000000a05', '${FUND}', 'f3000000-0000-4000-8000-0000000000e4', 'has_role', 'Er CEO', 'company_claim', 'extracted', 'proposed')`);
  // En anden fond med samme navn må ikke røres.
  await q(`insert into public.people (fund_id, full_name) values ('${OTHER_FUND}', '${NAME}')`);
  await q(`insert into public.brain_insights (fund_id, kind, title, body_md, created_by_loop)
    values ('${OTHER_FUND}', 'pattern', 'Anden fond om ${NAME}', 'Tekst om ${NAME}.', 'L5_weekly')`);
  await seedPagesAndLessons(q);
  // A company named after the person (its company and case entities come from the
  // projection), a product named after him, and an entity whose key the masked one would take.
  await q(`insert into public.companies (id, fund_id, name, legal_name, sector, geography, stage)
    values ('${HOLDING}', '${FUND}', '${NAME} Holding', '${NAME} Holding ApS', 'fintech', 'DK', 'seed')`);
  await q(`insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
    values ('${HOLDING_CASE}', '${FUND}', '${HOLDING}', 'manual', '${USER}')`);
  await asService(client, "select public.brain_project_db_entities($1, $2)", [FUND, HOLDING_CASE]);
  await q(`insert into public.brain_entities (id, fund_id, type, name, normalized_key, embedding)
    values ('${E_METHOD}', '${FUND}', 'product', '${NAME} Method', 'anders nørregaard jensen method', ${VECTOR}),
           ('${E_OLD_METHOD}', '${FUND}', 'product', 'Ældre metode', '[slettet person] method', null)`);
  generationBeforeForget = Number(
    (await one(client, "select public.brain_forget_generation($1) as n", [FUND])).n,
  );
}

let generationBeforeForget = -1;

/**
 * The name goes from other entities' names and keys and from the company's own name,
 * so L4 and the next capture do not write it back; the forgetting counts the fund's counter up.
 */
async function namesAfterForget(client, r) {
  console.log("  Navne i andre entiteter og selskabets navn (T-723)");
  const entityOf = (refTable, refId) =>
    one(
      client,
      `select id, name, normalized_key, dirty_at, embedding is null as no_vector
         from public.brain_entities where fund_id = $1 and ref_table = $2 and ref_id = $3`,
      [FUND, refTable, refId],
    );
  const company = await one(client, "select name, legal_name from public.companies where id = $1", [
    HOLDING,
  ]);
  record(
    "Selskabets navn og juridiske navn er maskeret (rå data), resten af navnet består",
    company.name === "[slettet person] Holding" &&
      company.legal_name === "[slettet person] Holding ApS" &&
      r.raw.rawMasked?.["companies.name"] === 1,
    JSON.stringify({ company, rawMasked: r.raw.rawMasked }),
  );
  const companyEntity = await entityOf("companies", HOLDING);
  const caseEntity = await entityOf("cases", HOLDING_CASE);
  record(
    "Selskabets og casens entitet har mistet navnet i navn og nøgle og er beskidte",
    companyEntity.name === "[slettet person] Holding" &&
      caseEntity.name === "[slettet person] Holding (case)" &&
      !/nørregaard/i.test(companyEntity.normalized_key + caseEntity.normalized_key) &&
      companyEntity.dirty_at !== null &&
      caseEntity.dirty_at !== null,
    JSON.stringify({ companyEntity, caseEntity }),
  );
  const method = await one(
    client,
    "select name, normalized_key, embedding is null as no_vector from public.brain_entities where id = $1",
    [E_METHOD],
  );
  const oldMethod = await one(
    client,
    "select name, normalized_key from public.brain_entities where id = $1",
    [E_OLD_METHOD],
  );
  record(
    "Et produkt opkaldt efter personen maskeres; en nøgle, der allerede findes, får id-præfikset bagpå",
    method.name === "[slettet person] Method" &&
      method.normalized_key === "[slettet person] method #f3000000" &&
      method.no_vector === true &&
      oldMethod.name === "Ældre metode" &&
      oldMethod.normalized_key === "[slettet person] method" &&
      Number(r.brain.entitiesRenamed) >= 3,
    JSON.stringify({ method, oldMethod, renamed: r.brain.entitiesRenamed }),
  );
  const pageData = (
    await asService(client, "select public.brain_page_data($1, 'company', $2) as d", [
      FUND,
      companyEntity.id,
    ])
  ).rows[0].d;
  record(
    "L4 tegner selskabets side med det maskerede navn som titel (T-723 b)",
    pageData?.entity?.name === "[slettet person] Holding" &&
      !/nørregaard/i.test(JSON.stringify(pageData)),
    JSON.stringify(pageData?.entity),
  );
  await asService(client, "select public.brain_project_db_entities($1, $2)", [FUND, HOLDING_CASE]);
  const leaked = await count(
    client,
    `select (select count(*) from public.brain_entities where fund_id = $1
              and (name ilike '%Nørregaard%' or normalized_key ilike '%nørregaard%')
              and name <> 'Anders Nørregaard Jensen-Berg')
          + (select count(*) from public.brain_facts where fund_id = $1 and statement ilike '%Nørregaard%') as n`,
    [FUND],
  );
  record(
    "En ny opsamling af casen skriver ikke navnet tilbage i entiteter eller fakta",
    leaked === 0,
    String(leaked),
  );
  const generation = Number(
    (await one(client, "select public.brain_forget_generation($1) as n", [FUND])).n,
  );
  record(
    "Glem person tæller fondens glemsels-tæller op, så L4 ikke gemmer en side læst før (T-723 a)",
    generationBeforeForget >= 0 && generation === generationBeforeForget + 1,
    `${generationBeforeForget} -> ${generation}`,
  );
}

const PAGE_ANDERS = "f3000000-0000-4000-8000-000000000d11";
const PAGE_COMPANY = "f3000000-0000-4000-8000-000000000d12";
const PAGE_BENTE = "f3000000-0000-4000-8000-000000000d13";
const PAGE_OTHER_FUND = "f3000000-0000-4000-8000-000000000d14";
const PAGE_THESIS = "f3000000-0000-4000-8000-000000000d15";
const LESSON_NAMED = "f3000000-0000-4000-8000-000000000d21";
const LESSON_EVIDENCE = "f3000000-0000-4000-8000-000000000d22";
const LESSON_BENTE = "f3000000-0000-4000-8000-000000000d23";

const sectionsJson = (...sections) =>
  JSON.stringify(
    sections.map(([key, body, extra = {}]) => ({
      key,
      heading: key,
      body_md: body,
      fact_ids: [],
      locked_by_user: false,
      ...extra,
    })),
  );

/**
 * Pages and lessons. The person's own page, a company page with two versions (a
 * locked section, a name across a line break, a change note with the name), Bente's page whose
 * old version names Anders, lessons with the name in the text or the evidence, and a count event.
 */
async function seedPagesAndLessons(q) {
  const page = (id, fund, kind, entity, title, sections) =>
    q(
      `insert into public.brain_pages (id, fund_id, kind, entity_id, title, sections, search_fts, updated_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, public.brain_page_fts($5, $6::jsonb), 'L4')`,
      [id, fund, kind, entity, title, sections],
    );
  await page(
    PAGE_ANDERS,
    FUND,
    "person",
    E_ANDERS,
    NAME,
    sectionsJson(["overview", `${NAME} er CEO.`]),
  );
  await page(
    PAGE_COMPANY,
    FUND,
    "company",
    E_COMPANY,
    "Pleo Test ApS",
    sectionsJson(
      ["overview", `Grundlagt af ${NAME}.`, { locked_by_user: true }],
      ["key_metrics", "- ARR 2 mio. kr."],
    ),
  );
  await q(
    "select set_config('brain.user_edit', 'on', true), set_config('brain.change_note', $1, true)",
    [`Rettet efter møde med ${NAME}`],
  );
  await q(
    `update public.brain_pages set updated_by = $2, sections = $3::jsonb,
       search_fts = public.brain_page_fts(title, $3::jsonb) where id = $1`,
    [
      PAGE_COMPANY,
      `user:${USER}`,
      sectionsJson(
        ["overview", `Grundlagt af ${NAME}. Bente Holm er CFO.`, { locked_by_user: true }],
        [
          "key_metrics",
          "- ARR 2 mio. kr.\n- Mødte Anders\nNørregaard Jensen i maj",
          { computed: true },
        ],
      ),
    ],
  );
  await q(
    "select set_config('brain.user_edit', 'off', true), set_config('brain.change_note', '', true)",
  );
  await page(
    PAGE_BENTE,
    FUND,
    "person",
    E_BENTE,
    "Bente Holm",
    sectionsJson(["overview", `Bente Holm arbejdede med ${NAME}.`]),
  );
  await q("update public.brain_pages set sections = $2::jsonb, updated_by = 'L4' where id = $1", [
    PAGE_BENTE,
    sectionsJson(["overview", "Bente Holm er CFO."]),
  ]);
  await page(
    PAGE_OTHER_FUND,
    OTHER_FUND,
    "thesis",
    null,
    "Tesen",
    sectionsJson(["stated", `Folk som ${NAME}.`]),
  );
  // A version whose only mention of the name is its change note.
  await q("select set_config('brain.change_note', $1, true)", [
    `Opdateret efter samtale med ${NAME}`,
  ]);
  await page(
    PAGE_THESIS,
    FUND,
    "thesis",
    null,
    "Tesen",
    sectionsJson(["stated", "Vi investerer i fintech."]),
  );
  await q("select set_config('brain.change_note', '', true)");

  await q(
    `insert into public.brain_playbook_bullets (id, fund_id, section, text, status, origin, evidence, scope, embedding)
     values ($1, $4, 'red_flags', 'Pas på stiftere som ${NAME}, der forlader firmaet', 'candidate', 'brain',
             '[{"kind": "decision", "id": "x"}]'::jsonb, '{}'::jsonb, ${VECTOR}),
            ($2, $4, 'strategies', 'Spørg til teamets erfaring', 'candidate', 'brain',
             '[{"kind": "episode", "id": "y", "label": "Note om ${NAME}"}]'::jsonb,
             '{"note": "${NAME}"}'::jsonb, ${VECTOR}),
            ($3, $4, 'green_flags', 'Bente Holm er en stærk CFO', 'candidate', 'brain', '[]'::jsonb, '{}'::jsonb, ${VECTOR})`,
    [LESSON_NAMED, LESSON_EVIDENCE, LESSON_BENTE, FUND],
  );
  await q(
    `insert into public.brain_bullet_events (fund_id, bullet_id, delta_helpful, reason, source_kind, source_id)
     values ($1, $2, 1, 'Brugt, da ${NAME} forlod firmaet', 'tag_decision', gen_random_uuid())`,
    [FUND, LESSON_BENTE],
  );
}

async function forgetPagesAndLessons(client, r) {
  console.log("  Sider og lektioner (T-313)");
  const n = (sql, params = []) => count(client, sql, params);
  record(
    "Personens egen side og dens versioner er slettet",
    (await n("select count(*) as n from public.brain_pages where id = $1", [PAGE_ANDERS])) === 0 &&
      (await n("select count(*) as n from public.brain_page_versions where page_id = $1", [
        PAGE_ANDERS,
      ])) === 0 &&
      r.brain.pagesDeleted === 1,
    JSON.stringify(r.brain),
  );
  const company = await one(
    client,
    `select version, sections, updated_by,
            search_fts @@ plainto_tsquery('danish', 'Nørregaard') as name_searchable,
            search_fts @@ plainto_tsquery('danish', 'Bente') as other_searchable
     from public.brain_pages where id = $1`,
    [PAGE_COMPANY],
  );
  const overview = company.sections.find((s) => s.key === "overview");
  record(
    "En anden side er maskeret, også en låst sektion og et navn over et linjeskift",
    !JSON.stringify(company.sections).includes("Nørregaard") &&
      overview?.body_md === "Grundlagt af [slettet person]. Bente Holm er CFO." &&
      overview.locked_by_user === true &&
      company.version === 3,
    JSON.stringify(company),
  );
  record(
    "Sidens søgetekst er bygget igen uden navnet",
    company.name_searchable === false && company.other_searchable === true,
    JSON.stringify(company),
  );
  const versions = (
    await client.query(
      "select version, changed_by, change_note, sections::text as s from public.brain_page_versions where page_id = $1 order by version",
      [PAGE_COMPANY],
    )
  ).rows;
  record(
    "Gamle versioner (og ændringsnoter) med navnet er slettet; den nye står som GDPR",
    versions.length === 1 &&
      versions[0].version === 3 &&
      versions[0].changed_by === "gdpr" &&
      !versions[0].s.includes("Nørregaard"),
    JSON.stringify(versions),
  );
  const bente = await one(
    client,
    "select version, sections from public.brain_pages where id = $1",
    [PAGE_BENTE],
  );
  const benteVersions = (
    await client.query(
      "select version from public.brain_page_versions where page_id = $1 order by version",
      [PAGE_BENTE],
    )
  ).rows.map((row) => row.version);
  record(
    "En side, hvis gamle version nævnte navnet, beholder sin nuværende version; den gamle slettes",
    bente.version === 2 &&
      JSON.stringify(benteVersions) === "[2]" &&
      bente.sections[0].body_md === "Bente Holm er CFO.",
    JSON.stringify([bente, benteVersions]),
  );
  const thesis = await one(
    client,
    `select p.version, p.sections::text as s,
            (select count(*) from public.brain_page_versions v where v.page_id = p.id)::int as versions
     from public.brain_pages p where p.id = $1`,
    [PAGE_THESIS],
  );
  record(
    "En version, hvor kun ændringsnoten nævner navnet, slettes; siden selv er urørt",
    thesis.version === 1 && thesis.versions === 0 && thesis.s.includes("Vi investerer i fintech."),
    JSON.stringify(thesis),
  );
  record(
    "Resultatet tæller maskerede sider og slettede versioner",
    r.brain.pagesMasked === 1 && r.brain.pageVersionsDeleted === 4,
    JSON.stringify(r.brain),
  );
  const l4Lock = await expectError(
    client,
    `update public.brain_pages set updated_by = 'L4',
       sections = (select jsonb_agg(s) from jsonb_array_elements(sections) s where s ->> 'key' <> 'overview')
     where id = '${PAGE_COMPANY}'`,
    /locked by a user/,
  );
  record(
    "Efter glemslen kan L4 stadig ikke ændre en låst sektion (GDPR-undtagelsen er slået fra igen)",
    l4Lock === true,
    String(l4Lock),
  );

  const lessons = (
    await client.query(
      "select id, text, evidence::text as evidence, scope::text as scope, embedding is null as no_vector from public.brain_playbook_bullets where id = any($1)",
      [[LESSON_NAMED, LESSON_EVIDENCE, LESSON_BENTE]],
    )
  ).rows;
  const lesson = (id) => lessons.find((row) => row.id === id);
  record(
    "En lektion med navnet i teksten er maskeret og mister sin vektor",
    lesson(LESSON_NAMED)?.text === "Pas på stiftere som [slettet person], der forlader firmaet" &&
      lesson(LESSON_NAMED).no_vector === true,
    JSON.stringify(lesson(LESSON_NAMED)),
  );
  record(
    "En lektion med navnet i beviser og scope er maskeret og beholder sin vektor",
    !lesson(LESSON_EVIDENCE)?.evidence.includes("Nørregaard") &&
      !lesson(LESSON_EVIDENCE).scope.includes("Nørregaard") &&
      lesson(LESSON_EVIDENCE).text === "Spørg til teamets erfaring" &&
      lesson(LESSON_EVIDENCE).no_vector === false,
    JSON.stringify(lesson(LESSON_EVIDENCE)),
  );
  record(
    "Den anden persons lektion er urørt",
    lesson(LESSON_BENTE)?.text === "Bente Holm er en stærk CFO" &&
      lesson(LESSON_BENTE).no_vector === false,
  );
  record(
    "Serveren får den maskerede lektionstekst at embedde igen",
    Array.isArray(r.brain.lessonsToEmbed) &&
      r.brain.lessonsToEmbed.length === 1 &&
      r.brain.lessonsToEmbed[0].id === LESSON_NAMED &&
      r.brain.lessonsToEmbed[0].text.includes("[slettet person]") &&
      r.brain.lessonsMasked === 2,
    JSON.stringify(r.brain),
  );
  const event = await one(
    client,
    `select e.reason, b.helpful from public.brain_bullet_events e
     join public.brain_playbook_bullets b on b.id = e.bullet_id where e.bullet_id = $1`,
    [LESSON_BENTE],
  );
  record(
    "Lektionens tæller-log er maskeret, og tælleren er uændret",
    event.reason === "Brugt, da [slettet person] forlod firmaet" &&
      event.helpful === 1 &&
      r.brain.lessonEventsMasked === 1,
    JSON.stringify(event),
  );
  record(
    "En side i en anden fond med samme navn er urørt",
    (await n(
      "select count(*) as n from public.brain_pages where id = $1 and sections::text like '%Nørregaard%'",
      [PAGE_OTHER_FUND],
    )) === 1,
  );
}

async function helpers(client) {
  console.log("\nHjælpefunktioner");
  const masked = await one(
    client,
    `select public.gdpr_replace_terms('Mødte ANDERS Jensen (a.b@x.dk) i dag', array['Anders Jensen', 'a.b@x.dk']) as t`,
  );
  record(
    "Maskering er uafhængig af store/små bogstaver, tager e-mail med og bliver aldrig længere",
    masked.t === "Mødte [slettet] ([x]) i dag",
    masked.t,
  );
  const special = await one(
    client,
    `select public.gdpr_replace_terms('Ring til A.+B (c) nu', array['A.+B (c)']) as t`,
  );
  record("Specialtegn i et navn tolkes ikke som regex", special.t === "Ring til [x] nu", special.t);
  const short = await one(
    client,
    `select public.gdpr_replace_terms('Al og Bo', array['Al', 'Bo']) as t`,
  );
  record(
    "Termer under 3 tegn maskeres ikke (ingen skade på almindelige ord)",
    short.t === "Al og Bo",
  );
  const json = await one(
    client,
    `select public.gdpr_replace_terms_jsonb('{"n": "Anders \\"Ando\\" Jensen"}'::jsonb, array['Anders "Ando" Jensen']) as j`,
  );
  record(
    "Et navn med anførselstegn maskeres også i jsonb",
    json.j?.n === "[slettet person]" || json.j?.n === "[slettet]",
    JSON.stringify(json.j),
  );
}

async function boundaries(client) {
  console.log("\nOrdgrænser, whitespace og længde");
  const r = (text, terms) =>
    one(client, "select public.gdpr_replace_terms($1, $2::text[]) as t", [text, terms]).then(
      (row) => row.t,
    );
  record(
    "Et navn med linjeskift og dobbelte mellemrum mellem for- og efternavn maskeres",
    (await r("Anna\nHansen og Anna   Hansen mødtes", ["Anna Hansen"])) ===
      "[slettet] og [slettet] mødtes",
  );
  record(
    "Et andet efternavn, der starter ens, røres ikke (Hansen-Berg, Hansens, Lundgren)",
    (await r("Anna Hansen-Berg, Anna Hansens bil og Lars Lundgren", [
      "Anna Hansen",
      "Lars Lund",
    ])) === "Anna Hansen-Berg, Anna Hansens bil og Lars Lundgren",
  );
  record(
    "Navnet maskeres i starten, midt i og i slutningen af en tekst og før tegnsætning",
    (await r("Anna Hansen, Anna Hansen. (Anna Hansen)", ["Anna Hansen"])) ===
      "[slettet], [slettet]. ([slettet])",
  );
  const long = "x".repeat(7990) + " Anna Hansen";
  const masked = await r(long, ["Anna Hansen"]);
  record(
    "Erstatningen gør aldrig en tekst længere (CHECK-grænser kan ikke sprænges)",
    masked.length <= long.length && !masked.includes("Anna"),
    `${long.length} -> ${masked.length}`,
  );
}

async function forget(client) {
  console.log("\nGlem person (0072)");
  // A saved demo snapshot holds the person's rows; forgetting must empty the team's.
  await client.query(
    `insert into private.demo_snapshots (fund_id, schema_version, row_counts, tables, files, ready)
     values ($1, '0120', '{"people": 1}', '{"people": [{"name": "Anders Nørregaard"}]}',
             '["pitch-decks/_demo-snapshot/1/anders.pdf"]', true),
            ($2, '0120', '{"people": 1}', '{"people": [{"name": "Bente"}]}', '[]', true)`,
    [FUND, OTHER_FUND],
  );
  const result = await asService(client, "select public.gdpr_forget_person($1, $2) as r", [
    FUND,
    ANDERS,
  ]);
  const r = result.rows[0].r;
  const hits = async (sql) => count(client, sql);
  const snapshots = await client.query(
    "select fund_id, ready, tables::text as tables, files::text as files, row_counts::text as counts from private.demo_snapshots where fund_id in ($1, $2)",
    [FUND, OTHER_FUND],
  );
  const own = snapshots.rows.find((row) => row.fund_id === FUND);
  const foreignSnapshot = snapshots.rows.find((row) => row.fund_id === OTHER_FUND);
  record(
    "Glem tømmer teamets demo-øjebliksbilleder, så Nulstil demo ikke genskaber personen (T-937)",
    own?.ready === false &&
      own.tables === "{}" &&
      own.files.includes("anders.pdf") &&
      own.counts === "{}" &&
      !own.tables.includes("Nørregaard"),
    JSON.stringify(own),
  );
  record(
    "Et andet teams øjebliksbillede er urørt",
    foreignSnapshot?.ready === true && foreignSnapshot.tables.includes("Bente"),
    JSON.stringify(foreignSnapshot),
  );
  const anywhere = (table, column, term = "Nørregaard") =>
    hits(
      `select count(*) as n from public.${table} where fund_id = '${FUND}' and ${column}::text ilike '%${term}%'`,
    );

  console.log("  Rå data (T-121)");
  record(
    "Personen er slettet (people og company_people)",
    (await hits(`select count(*) as n from public.people where id = '${ANDERS}'`)) === 0 &&
      (await hits(
        `select count(*) as n from public.company_people where person_id = '${ANDERS}'`,
      )) === 0 &&
      r.raw.peopleDeleted === 1,
    JSON.stringify(r.raw),
  );
  record(
    "Den anden person er urørt",
    (await hits(`select count(*) as n from public.people where id = '${BENTE}'`)) === 1 &&
      (await hits(
        `select count(*) as n from public.company_people where person_id = '${BENTE}'`,
      )) === 1,
  );
  record(
    "Navnet er væk fra evidens",
    (await anywhere("evidence_items", "claim || coalesce(excerpt, '')")) === 0,
  );
  record(
    "Navnet er væk fra noter (også med store bogstaver)",
    (await anywhere("case_notes", "body")) === 0,
  );
  record("Navnet er væk fra anbefalinger", (await anywhere("recommendations", "rationale")) === 0);
  record(
    "Navnet er væk fra analysekørslens svar (jsonb med anførselstegn)",
    (await anywhere("analysis_runs", "raw_response")) === 0,
  );
  record(
    "Navnet og e-mailen er væk fra analyse-trinnenes output_json",
    (await anywhere("analysis_run_steps", "output_json")) === 0 &&
      (await anywhere("analysis_run_steps", "output_json", "anders.jensen")) === 0,
  );
  record(
    "Navnet er væk fra overgangsloggens begrundelse",
    (await anywhere("case_transition_events", "reason")) === 0,
  );
  record(
    "Navnet er væk fra selskabets beskrivelse",
    (await anywhere("companies", "description")) === 0,
  );
  const bente = await one(
    client,
    `select (select count(*) from public.evidence_items where claim ilike '%Bente Holm%') as a,
    (select count(*) from public.case_notes where body ilike '%Bente Holm%') as b`,
  );
  record(
    "Den anden persons navn står stadig i de samme rækker",
    Number(bente.a) === 1 && Number(bente.b) === 1,
  );
  const stepLeft = await one(
    client,
    `select output_json from public.analysis_run_steps where run_id = '${RUN}'`,
  );
  record(
    "Trin-outputtet er stadig gyldig JSON med den anden person",
    JSON.stringify(stepLeft.output_json).includes("Bente Holm") &&
      JSON.stringify(stepLeft.output_json).includes("[slettet person]"),
    JSON.stringify(stepLeft.output_json),
  );

  console.log("  Brain (T-122)");
  record(
    "Personens entitet er slettet, den anden er urørt",
    (await hits(`select count(*) as n from public.brain_entities where id = '${E_ANDERS}'`)) ===
      0 &&
      (await hits(`select count(*) as n from public.brain_entities where id = '${E_BENTE}'`)) === 1,
  );
  record(
    "Fakta med personen (og dens udtrukne dublet) som subject eller object er slettet (3 stk.)",
    r.brain.factsDeleted === 3 &&
      (await hits(
        `select count(*) as n from public.brain_facts where id in ('f3000000-0000-4000-8000-000000000a01','f3000000-0000-4000-8000-000000000a02')`,
      )) === 0,
    JSON.stringify(r.brain),
  );
  const maskedFact = await one(
    client,
    `select statement, embedding is null as no_vector from public.brain_facts where id = 'f3000000-0000-4000-8000-000000000a03'`,
  );
  record(
    "Et andet faktum, der nævner navnet, er maskeret og har mistet sin vektor",
    !maskedFact.statement.includes("Nørregaard") &&
      maskedFact.statement.includes("[slettet person]") &&
      maskedFact.no_vector,
    maskedFact.statement,
  );
  const bentesFact = await one(
    client,
    `select statement, embedding is not null as has_vector from public.brain_facts where id = 'f3000000-0000-4000-8000-000000000a04'`,
  );
  record(
    "Den anden persons faktum er urørt",
    bentesFact.statement === "Bente Holm er CFO" && bentesFact.has_vector,
  );
  record(
    "Citater med navnet er væk (fact_episodes.quote)",
    (await anywhere("brain_fact_episodes", "quote")) === 0,
  );
  record(
    "Personens identitets-episode er slettet",
    (await hits(
      `select count(*) as n from public.brain_episodes where ref_table = 'people' and ref_id = '${ANDERS}'`,
    )) === 0,
  );
  const episode = await one(
    client,
    `select content, title, content_hash, extraction_status from public.brain_episodes where id = 'f3000000-0000-4000-8000-0000000000f2'`,
  );
  record(
    "En episode med flere emner er maskeret, og hashen passer til den nye tekst",
    episode.content === "Mødte [slettet person] og Bente Holm." &&
      (
        await one(client, `select encode(sha256(convert_to($1, 'UTF8')), 'hex') = $2 as ok`, [
          episode.content,
          episode.content_hash,
        ])
      ).ok,
    JSON.stringify(episode),
  );
  record(
    "Episoden læses igen af L1 (extraction_status er pending)",
    episode.extraction_status === "pending",
  );
  const untouched = await one(
    client,
    `select content_hash from public.brain_episodes where id = 'f3000000-0000-4000-8000-0000000000f3'`,
  );
  record("En episode uden navnet er urørt", untouched.content_hash === "hash-bente-only");
  const chunks = await one(
    client,
    `select
    (select count(*) from public.brain_chunks where content ilike '%Nørregaard%') as leaked,
    (select count(*) from public.brain_chunks where content like '%[slettet person]%' and embedding is null) as masked,
    (select count(*) from public.brain_chunks where content = 'Bente Holm er CFO.' and embedding is not null) as untouched`,
  );
  record(
    "Tekststykker er maskeret og mangler vektor, urørte beholder deres",
    Number(chunks.leaked) === 0 && Number(chunks.masked) === 1 && Number(chunks.untouched) === 1,
    JSON.stringify(chunks),
  );
  record(
    "Casen er lagt i capture-køen, så L0 embedder igen",
    (await hits(
      `select count(*) as n from public.brain_capture_queue where case_id = '${CASE}'`,
    )) === 1,
  );
  const entity = await one(
    client,
    `select summary, embedding is null as no_vector, dirty_at is not null as dirty from public.brain_entities where id = '${E_COMPANY}'`,
  );
  record(
    "En entitet, der nævner personen, er maskeret og beskidt (skrives om i nat)",
    !entity.summary.includes("Nørregaard") && entity.no_vector && entity.dirty,
    JSON.stringify(entity),
  );
  const insights = await one(
    client,
    `select count(*) filter (where title ilike '%Nørregaard%' or body_md ilike '%Nørregaard%') as leaked,
    count(*) filter (where title like 'Bente%') as untouched from public.brain_insights where fund_id = '${FUND}'`,
  );
  record(
    "Indsigter er maskeret",
    Number(insights.leaked) === 0 && Number(insights.untouched) === 1,
  );
  record(
    "Chat: beskeder, citater og værktøjskald er maskeret",
    (await anywhere("brain_messages", "content")) === 0 &&
      (await anywhere("brain_messages", "citations")) === 0 &&
      (await anywhere("brain_messages", "tool_calls")) === 0,
  );
  record(
    "Chat: trådtitel, søgelog og feedback er maskeret",
    (await anywhere("brain_threads", "title")) === 0 &&
      (await anywhere("brain_retrieval_events", "query")) === 0 &&
      (await anywhere("brain_retrieval_events", "candidates")) === 0 &&
      (await anywhere("brain_feedback", "comment")) === 0,
  );
  record(
    "brain_log er maskeret (før/efter/årsag), den anden persons række er urørt",
    (await anywhere(
      "brain_log",
      "coalesce(before::text, '') || coalesce(after::text, '') || coalesce(reason, '')",
    )) === 0 &&
      (await hits(
        `select count(*) as n from public.brain_log where after::text like '%Bente Holm%'`,
      )) === 1,
  );
  const memory = r.brain.memoryEntries;
  record(
    "Fondens gamle hukommelse er maskeret, og serveren får at vide, hvad der skal embeddes igen",
    (await anywhere("fund_memory_entries", "summary_text")) === 0 &&
      Array.isArray(memory) &&
      memory.length === 1 &&
      memory[0].text.includes("[slettet person]"),
    JSON.stringify(memory),
  );

  console.log("  Review-fund");
  record(
    "Kilde og dokument er maskeret (titel, url, filnavn og udtrukket tekst med linjeskift)",
    (await anywhere("sources", "title || coalesce(url, '')")) === 0 &&
      (await anywhere("documents", "file_name || coalesce(extracted_text, '')")) === 0 &&
      (await anywhere("documents", "extracted_text", "Anders")) === 0,
  );
  record(
    "Udtrukne dubletter uden henvisning (samme navn) er slettet med deres fakta",
    (await hits(
      `select count(*) as n from public.brain_entities where id = 'f3000000-0000-4000-8000-0000000000e4'`,
    )) === 0 &&
      (await hits(
        `select count(*) as n from public.brain_facts where id = 'f3000000-0000-4000-8000-000000000a05'`,
      )) === 0,
  );
  record(
    "En anden person med sammensat efternavn (…-Berg) er urørt",
    (await hits(
      `select count(*) as n from public.brain_entities where id = 'f3000000-0000-4000-8000-0000000000e5' and name = 'Anders Nørregaard Jensen-Berg'`,
    )) === 1,
  );
  await asService(client, "select public.brain_capture_case($1, $2)", [FUND, CASE]);
  const recaptured = await one(
    client,
    `select count(*) filter (where title ilike '%Nørregaard%' or content ilike '%Nørregaard%') as leaked,
    count(*) as total from public.brain_episodes where fund_id = '${FUND}' and case_id = '${CASE}' and kind <> 'identity'`,
  );
  const recapturedIdentity = await hits(
    `select count(*) as n from public.brain_episodes where fund_id = '${FUND}' and ref_table = 'people' and ref_id = '${ANDERS}'`,
  );
  record(
    "Efter en ny capture af casen genskabes navnet ikke i Brains episoder",
    Number(recaptured.leaked) === 0 && recapturedIdentity === 0 && Number(recaptured.total) > 0,
    JSON.stringify(recaptured),
  );

  await forgetPagesAndLessons(client, r);
  await namesAfterForget(client, r);

  console.log("  Isolation og rest");
  const other = await one(
    client,
    `select (select count(*) from public.people where fund_id = '${OTHER_FUND}') as p,
    (select count(*) from public.brain_insights where fund_id = '${OTHER_FUND}' and body_md like '%Nørregaard%') as i`,
  );
  record("En anden fond med samme navn er urørt", Number(other.p) === 1 && Number(other.i) === 1);
  record(
    "Resultatet siger, hvad der ikke er dækket (fornavn alene, filer valgt fra)",
    JSON.stringify(r.notCovered) === JSON.stringify(["first_name_alone", "files_kept"]) &&
      r.filesKept === 1 &&
      r.filesToRemove.length === 0,
    JSON.stringify([r.notCovered, r.filesKept]),
  );
  const again = await expectError(
    client,
    `select public.gdpr_forget_person('${FUND}', '${ANDERS}')`,
    /unknown person/,
  );
  record(
    "Den samme person kan ikke glemmes to gange (ukendt person)",
    again === true,
    String(again),
  );
  const foreign = await expectError(
    client,
    `select public.gdpr_forget_person('${OTHER_FUND}', '${BENTE}')`,
    /unknown person/,
  );
  record("En person fra en anden fond kan ikke glemmes herfra", foreign === true, String(foreign));
  const short = await expectError(
    client,
    `select public.gdpr_forget_person('${FUND}', null, null)`,
    /required/,
  );
  record("Uden person eller entitet afvises kaldet", short === true, String(short));
}

/** The export reads the live data, so a forgotten person is not in it (export-fund). */
async function exportAfterForget(client) {
  console.log("\nEksport efter glemt person");
  const { tables, tablesWithoutFundId } = await exportFundData(client, FUND, { snapshot: false });
  const text = JSON.stringify(tables.map((table) => table.rows));
  record(
    "Eksporten af fonden indeholder hverken navn, e-mail eller LinkedIn-adresse",
    !/Nørregaard(?! Jensen-Berg)|anders\.jensen|anders-jensen-test/i.test(text),
  );
  record(
    "Eksporten har den anden person og tabellerne (people, brain_facts, analysis_run_steps)",
    text.includes("Bente Holm") &&
      ["people", "brain_facts", "analysis_run_steps", "funds"].every((name) =>
        tables.some((table) => table.table === name && table.rows.length > 0),
      ),
  );
  record(
    "Vektorer og genererede søgekolonner er udeladt fra eksporten",
    tables.every((table) => table.rows.every((row) => !("embedding" in row) && !("fts" in row))) &&
      tables
        .find((table) => table.table === "brain_chunks")
        ?.omittedColumns.includes("embedding") === true,
  );
  const other = await exportFundData(client, OTHER_FUND, { snapshot: false });
  record(
    "Eksporten af en anden fond indeholder ikke den første fonds rækker",
    !JSON.stringify(other.tables.map((table) => table.rows)).includes("Bente Holm"),
  );
  record(
    "Eksporten udelader hemmeligheder (token- og secret-kolonner) og nævner tabeller uden fund_id",
    tables.every((table) =>
      table.rows.every(
        (row) => !Object.keys(row).some((key) => /(^|_)(token|secret)(_|$)/.test(key)),
      ),
    ) && tablesWithoutFundId.length > 0,
    tablesWithoutFundId.join(","),
  );
  const parentScoped = [
    "financial_statement_line_items",
    "fund_membership_roles",
    "fund_mandates",
    "mandate_gates",
    "assessment_criteria",
    "fund_profile_sources",
  ];
  record(
    "Fondens tabeller uden fund_id eksporteres via deres forælder (T-806)",
    parentScoped.every(
      (name) =>
        !tablesWithoutFundId.includes(name) &&
        tables.some((table) => table.table === name && table.via?.length > 0),
    ),
    `ikke eksporteret: ${tablesWithoutFundId.join(",")}`,
  );
  const mine = new Map(
    tables.map((table) => [table.table, new Set(table.rows.map((row) => JSON.stringify(row)))]),
  );
  const overlap = other.tables.filter(
    (table) =>
      table.via && table.rows.some((row) => mine.get(table.table)?.has(JSON.stringify(row))),
  );
  record(
    "Ingen række fundet via en forælder står i begge fondes eksport (T-806)",
    overlap.length === 0,
    overlap.map((table) => table.table).join(","),
  );
}

async function entityLinksPerson(client) {
  console.log("\nBrain-entitet uden ref bindes til den rå person med samme navn");
  const person = "f3000000-0000-4000-8000-0000000000a9";
  const entity = "f3000000-0000-4000-8000-0000000000e8";
  await client.query(
    `insert into public.people (id, fund_id, full_name, email) values ($1, $2, 'Dorthe Vestergaard Nielsen', 'dorthe@x-test.dk')`,
    [person, FUND],
  );
  await client.query(
    `insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key)
     values ($1, $2, 'person', 'Dorthe Vestergaard Nielsen', '{}', 'name:dorthe@x')`,
    [entity, FUND],
  );
  const result = await asService(client, "select public.gdpr_forget_person($1, null, $2) as r", [
    FUND,
    entity,
  ]);
  record(
    "Glem via en udtrukket entitet sletter også den rå person med samme navn",
    result.rows[0].r.raw.peopleDeleted === 1 &&
      (await count(client, `select count(*) as n from public.people where id = '${person}'`)) === 0,
  );
  // To rå personer med samme navn: ingen bindes (tvetydigt), navnet maskeres stadig.
  await client.query(
    `insert into public.people (fund_id, full_name) values ($1, 'Erik Madsen Holst'), ($1, 'Erik Madsen Holst')`,
    [FUND],
  );
  await client.query(
    `insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key)
     values ('f3000000-0000-4000-8000-0000000000e7', $1, 'person', 'Erik Madsen Holst', '{}', 'name:erik@x')`,
    [FUND],
  );
  const ambiguous = await asService(client, "select public.gdpr_forget_person($1, null, $2) as r", [
    FUND,
    "f3000000-0000-4000-8000-0000000000e7",
  ]);
  record(
    "Er to rå personer ens, bindes ingen (de slettes ikke ved en fejl)",
    ambiguous.rows[0].r.raw.peopleDeleted === 0 &&
      (await count(
        client,
        `select count(*) as n from public.people where full_name = 'Erik Madsen Holst'`,
      )) === 2,
  );
}

async function entityOnly(client) {
  console.log("\nPerson, der kun findes i Brain (uden række i people)");
  const entity = "f3000000-0000-4000-8000-0000000000e9";
  await client.query(
    `insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key, summary)
     values ($1, $2, 'person', 'Carsten Skovgaard-Winther', array['C. Skovgaard-Winther'], 'carsten-skovgaard-winther', null)`,
    [entity, FUND],
  );
  await client.query(
    `insert into public.case_notes (fund_id, case_id, author_id, body)
     values ($1, $2, $3, 'Carsten Skovgaard-Winther er investor.')`,
    [FUND, CASE, USER],
  );
  const result = await asService(client, "select public.gdpr_forget_person($1, null, $2) as r", [
    FUND,
    entity,
  ]);
  record(
    "En Brain-person uden rå person kan glemmes via entiteten",
    (await count(
      client,
      `select count(*) as n from public.brain_entities where id = '${entity}'`,
    )) === 0 &&
      (await count(
        client,
        `select count(*) as n from public.case_notes where body ilike '%Skovgaard%'`,
      )) === 0 &&
      result.rows[0].r.raw.peopleDeleted === 0,
    JSON.stringify(result.rows[0].r.raw),
  );
}

// An alias or a first name alone is masked only where the full name is named too.
async function contextTerms(client) {
  console.log("\nKontekst-termer: aliaser og fornavne (T-805)");
  const replace = async (text, terms) =>
    (await one(client, "select public.gdpr_replace_terms($1, $2) as t", [text, terms])).t;
  const terms = ["Anna Hansen", "~Anna", "~Hansen", "~CEO"];
  record(
    "Fornavn og alias maskeres i en tekst, der nævner det fulde navn",
    (await replace("Anna Hansen kom. Anna sagde ja, og vores CEO talte.", terms)) ===
      "[slettet] kom. [x] sagde ja, og vores [x] talte.",
  );
  record(
    "Uden det fulde navn i teksten røres fornavn og alias ikke",
    (await replace("Anna sagde ja, og vores CEO talte.", terms)) ===
      "Anna sagde ja, og vores CEO talte.",
  );
  record(
    "Et andet navn med samme fornavn eller efternavn røres ikke",
    (await replace("Anna Hansen, Anna Berg og Peter Hansen.", terms)) ===
      "[slettet], Anna Berg og Peter Hansen.",
  );
  record(
    "Kontekst-termer vælger aldrig rækker (mønsteret er kun de fulde navne)",
    (await one(client, "select public.gdpr_term_pattern(array['~Anna', '~CEO']) is null as ok"))
      .ok === true,
  );
  record(
    "JSON-formen beholder kontekst-mærket",
    (
      await one(
        client,
        `select public.gdpr_json_terms(array['~Anna "A"']) @> array['~Anna "A"', '~Anna \\"A\\"'] as ok`,
      )
    ).ok === true,
  );
}

const DORTE = "f3000000-0000-4000-8000-0000000000d2";
const E_DORTE = "f3000000-0000-4000-8000-0000000000d3";
const E_OTHER_DORTE = "f3000000-0000-4000-8000-0000000000d4";
const E_CEO = "f3000000-0000-4000-8000-0000000000d5";
const EP_ONLY_DORTE = "f3000000-0000-4000-8000-0000000000d6";
const EP_MIXED = "f3000000-0000-4000-8000-0000000000d7";
const DOC_DORTE = "f3000000-0000-4000-8000-0000000000d8";
const SRC_DORTE = "f3000000-0000-4000-8000-0000000000d9";
const EP_SRC = "f3000000-0000-4000-8000-0000000000da";

// Aliases checked before deletion, files, and episodes only about the person.
async function completeForget(client) {
  console.log("\nGlem person gjort færdig: aliaser, filer, episoder (T-805)");
  const q = (sql, params = []) => client.query(sql, params);
  await q(
    `insert into public.people (id, fund_id, full_name) values ('${DORTE}', '${FUND}', 'Dorte Lund Kjær')`,
  );
  await q(`insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key, ref_table, ref_id)
    values ('${E_DORTE}', '${FUND}', 'person', 'Dorte Lund Kjær', array['CEO', 'Dorte', 'D. L. Kjær', 'Head of Product', 'CEO Ole'], 'dorte-lund-kjaer', 'people', '${DORTE}'),
           ('${E_OTHER_DORTE}', '${FUND}', 'person', 'Dorte', '{}', 'name:dorte@andet', null, null),
           ('${E_CEO}', '${FUND}', 'person', 'CEO', '{}', 'name:ceo@andet', null, null)`);
  await q(`insert into public.case_notes (fund_id, case_id, author_id, body) values
    ('${FUND}', '${CASE}', '${USER}', 'Dorte Lund Kjær (CEO) præsenterede. Dorte vil rejse 5 mio.'),
    ('${FUND}', '${CASE}', '${USER}', 'Vores CEO Ole og Dorte fra bestyrelsen kom.')`);
  await q(`insert into public.brain_episodes (id, fund_id, kind, ref_table, ref_id, case_id, trust_tier, title, content, content_hash)
    values ('${EP_ONLY_DORTE}', '${FUND}', 'case_note', 'case_notes', gen_random_uuid(), '${CASE}', 'user_note', 'Note',
            'Dorte Lund Kjær har 10 års erfaring fra fintech.', 'hash-only-dorte'),
           ('${EP_MIXED}', '${FUND}', 'case_note', 'case_notes', gen_random_uuid(), '${CASE}', 'user_note', 'Note',
            'Pleo Test ApS har ansat Dorte Lund Kjær som CEO.', 'hash-mixed-dorte')`);
  await q(`insert into public.brain_facts (id, fund_id, subject_id, predicate, object_id, statement, trust_tier, origin, status)
    values ('f3000000-0000-4000-8000-000000000d10', '${FUND}', '${E_DORTE}', 'has_strength', null, 'Har 10 års erfaring', 'official', 'extracted', 'active'),
           ('f3000000-0000-4000-8000-000000000d11', '${FUND}', '${E_COMPANY}', 'founded_by', '${E_DORTE}', 'Selskabet har ansat personen', 'official', 'extracted', 'active')`);
  await q(`insert into public.brain_fact_episodes (fact_id, episode_id, fund_id, quote) values
    ('f3000000-0000-4000-8000-000000000d10', '${EP_ONLY_DORTE}', '${FUND}', '10 års erfaring'),
    ('f3000000-0000-4000-8000-000000000d11', '${EP_MIXED}', '${FUND}', 'har ansat')`);
  await q(`insert into public.documents (id, fund_id, case_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by, extracted_text)
    values ('${DOC_DORTE}', '${FUND}', '${CASE}', 'pitch_deck', 'deck.pdf', '${FUND}/${CASE}/deck-dorte.pdf', 'application/pdf', 10, '${USER}',
            'Team: Dorte Lund Kjær, CEO.')`);
  await q(`insert into public.brain_sources (id, fund_id, kind, title, file_name, storage_path, trust_tier, status, created_by)
    values ('${SRC_DORTE}', '${FUND}', 'pdf', 'Kvartalsrapport', 'rapport.pdf', '${FUND}/rapport-dorte.pdf', 'customer_doc', 'ready', '${USER}')`);
  await q(`insert into public.brain_episodes (id, fund_id, kind, brain_source_id, trust_tier, title, content, content_hash)
    values ('${EP_SRC}', '${FUND}', 'source_chunk', '${SRC_DORTE}', 'customer_doc', 'Side 2', 'Bestyrelsen: Dorte Lund Kjær.', 'hash-src-dorte')`);

  const preview = (
    await asService(client, "select public.gdpr_person_preview($1, $2, null) as r", [FUND, DORTE])
  ).rows[0].r;
  record(
    "Forhåndsvisningen viser navnet og filerne, der nævner personen",
    preview.name === "Dorte Lund Kjær" &&
      preview.files.length === 2 &&
      preview.files.some((f) => f.kind === "document" && f.name === "deck.pdf") &&
      preview.files.some(
        (f) =>
          f.kind === "brain_source" &&
          f.name === "rapport.pdf" &&
          f.bucket === "brain-sources" &&
          f.path === `${FUND}/rapport-dorte.pdf`,
      ),
    JSON.stringify(preview),
  );
  const terms = (
    await asService(client, "select public.gdpr_person_terms($1, $2, null) as r", [FUND, DORTE])
  ).rows[0].r.terms;
  record(
    "Aliaser, der ikke er et navn, og fornavn/efternavn er kontekst-termer",
    terms.includes("Dorte Lund Kjær") &&
      terms.includes("D. L. Kjær") &&
      terms.includes("~CEO") &&
      terms.includes("~Dorte") &&
      terms.includes("~Kjær") &&
      terms.includes("~Head of Product") &&
      terms.includes("~CEO Ole") &&
      !terms.includes("CEO") &&
      !terms.includes("Dorte"),
    JSON.stringify(terms),
  );

  const r = (
    await asService(client, "select public.gdpr_forget_person($1, $2, null, true) as r", [
      FUND,
      DORTE,
    ])
  ).rows[0].r;
  const notes = (
    await q(
      `select body from public.case_notes where fund_id = '${FUND}' and (body like '%CEO Ole%' or body like '%præsenterede%') order by body`,
    )
  ).rows.map((row) => row.body);
  record(
    "Alias og fornavn maskeres kun i teksten, der nævner personen",
    notes.length === 2 &&
      notes[1] === "Vores CEO Ole og Dorte fra bestyrelsen kom." &&
      notes[0] === "[slettet person] ([x]) præsenterede. [x] vil rejse 5 mio.",
    JSON.stringify(notes),
  );
  record(
    "En anden entitet med samme navn som et alias slettes ikke",
    (await count(
      client,
      `select count(*) as n from public.brain_entities where id in ('${E_OTHER_DORTE}', '${E_CEO}')`,
    )) === 2 &&
      (await count(
        client,
        `select count(*) as n from public.brain_entities where id = '${E_DORTE}'`,
      )) === 0,
  );
  record(
    "En episode, hvor personen er eneste emne, slettes (med tekststykker)",
    (await count(
      client,
      `select count(*) as n from public.brain_episodes where id = '${EP_ONLY_DORTE}'`,
    )) === 0 && r.brain.episodesDeleted >= 1,
    JSON.stringify(r.brain.episodesDeleted),
  );
  const mixed = await one(
    client,
    `select content from public.brain_episodes where id = '${EP_MIXED}'`,
  );
  record(
    "En episode, der også handler om andet, maskeres og bliver",
    mixed?.content === "Pleo Test ApS har ansat [slettet person] som [x].",
    JSON.stringify(mixed),
  );
  const doc = await one(
    client,
    `select file_removed_at, extracted_text, storage_path from public.documents where id = '${DOC_DORTE}'`,
  );
  const src = await one(
    client,
    `select storage_path from public.brain_sources where id = '${SRC_DORTE}'`,
  );
  record(
    "Filerne mærkes fjernet, og teksten bliver maskeret",
    doc.file_removed_at !== null &&
      doc.extracted_text === "Team: [slettet person], [x]." &&
      doc.storage_path === `${FUND}/forgotten/${DOC_DORTE}` &&
      src.storage_path === null,
    JSON.stringify([doc, src]),
  );
  const paths = r.filesToRemove.map((f) => `${f.bucket}:${f.path}`).sort();
  const removedIds = r.filesToRemove.map((f) => `${f.kind}:${f.id}`).sort();
  record(
    "Svaret giver stierne til serveren, ingen navne, og intet er valgt fra",
    JSON.stringify(paths) ===
      JSON.stringify([
        `brain-sources:${FUND}/rapport-dorte.pdf`,
        `pitch-decks:${FUND}/${CASE}/deck-dorte.pdf`,
      ]) &&
      JSON.stringify(removedIds) ===
        JSON.stringify([`brain_source:${SRC_DORTE}`, `document:${DOC_DORTE}`]) &&
      r.filesKept === 0 &&
      JSON.stringify(r.notCovered) === JSON.stringify(["first_name_alone"]) &&
      !JSON.stringify(r).includes("Dorte Lund"),
    JSON.stringify([paths, r.notCovered]),
  );
  const previewAfter = await expectError(
    client,
    `select public.gdpr_person_preview('${FUND}', '${DORTE}', null)`,
    /unknown person/,
  );
  record(
    "En glemt person kan ikke forhåndsvises igen",
    previewAfter === true,
    String(previewAfter),
  );
}

const IDA = "f3000000-0000-4000-8000-0000000000f6";
const E_IDA = "f3000000-0000-4000-8000-0000000000f7";
const E_IDA_MERGED = "f3000000-0000-4000-8000-0000000000f8";
const SRC_IDA = "f3000000-0000-4000-8000-0000000000f9";
const EP_SRC_IDA = "f3000000-0000-4000-8000-0000000000fa";

// Review findings: a merged single word is no full term, "Hej Ida" is masked, and an
// upload's episode with only her fact is masked, not deleted.
async function reviewFindings(client) {
  console.log("\nReview-fund (T-805)");
  const q = (sql, params = []) => client.query(sql, params);
  await q(
    `insert into public.people (id, fund_id, full_name) values ('${IDA}', '${FUND}', 'Ida Marie Holm')`,
  );
  await q(`insert into public.brain_entities (id, fund_id, type, name, aliases, normalized_key, ref_table, ref_id, status, merged_into)
    values ('${E_IDA}', '${FUND}', 'person', 'Ida Marie Holm', '{}', 'ida-marie-holm', 'people', '${IDA}', 'active', null),
           ('${E_IDA_MERGED}', '${FUND}', 'person', 'Holm', '{}', 'name:holm@robo', null, null, 'merged', '${E_IDA}')`);
  await q(`insert into public.case_notes (fund_id, case_id, author_id, body) values
    ('${FUND}', '${CASE}', '${USER}', 'Holm Byg leverede lokalerne.'),
    ('${FUND}', '${CASE}', '${USER}', 'Ida Marie Holm kom. Hej Ida, velkommen.')`);
  await q(`insert into public.brain_sources (id, fund_id, kind, title, file_name, storage_path, trust_tier, status, created_by)
    values ('${SRC_IDA}', '${FUND}', 'pdf', 'Referat', 'referat.pdf', null, 'customer_doc', 'ready', '${USER}')`);
  await q(`insert into public.brain_episodes (id, fund_id, kind, brain_source_id, trust_tier, title, content, content_hash)
    values ('${EP_SRC_IDA}', '${FUND}', 'source_chunk', '${SRC_IDA}', 'customer_doc', 'Side 1', 'Bestyrelsen: Ida Marie Holm. Budget godkendt.', 'hash-src-ida')`);
  await q(`insert into public.brain_facts (id, fund_id, subject_id, predicate, object_id, statement, trust_tier, origin, status)
    values ('f3000000-0000-4000-8000-000000000f10', '${FUND}', '${E_IDA}', 'board_member_of', '${E_COMPANY}', 'Sidder i bestyrelsen', 'official', 'extracted', 'active')`);
  await q(`insert into public.brain_fact_episodes (fact_id, episode_id, fund_id, quote) values
    ('f3000000-0000-4000-8000-000000000f10', '${EP_SRC_IDA}', '${FUND}', 'Bestyrelsen')`);

  const terms = (
    await asService(client, "select public.gdpr_person_terms($1, $2, null) as r", [FUND, IDA])
  ).rows[0].r.terms;
  record(
    "Et sammenflettet enkeltnavn er en kontekst-term, ikke en fuld term",
    terms.includes("Ida Marie Holm") && terms.includes("~Holm") && !terms.includes("Holm"),
    JSON.stringify(terms),
  );
  await asService(client, "select public.gdpr_forget_person($1, $2) as r", [FUND, IDA]);
  const notes = (
    await q(
      `select body from public.case_notes where fund_id = '${FUND}' and (body like 'Holm Byg%' or body like '%velkommen%') order by body`,
    )
  ).rows.map((row) => row.body);
  record(
    'Det enkelte navn røres ikke i hele fonden, og "Hej Ida" maskeres',
    JSON.stringify(notes) ===
      JSON.stringify(["[slettet] kom. Hej [x], velkommen.", "Holm Byg leverede lokalerne."]),
    JSON.stringify(notes),
  );
  record(
    "Den sammenflettede entitet går med personen",
    (await count(
      client,
      `select count(*) as n from public.brain_entities where id = '${E_IDA_MERGED}'`,
    )) === 0,
  );
  const episode = await one(
    client,
    `select content from public.brain_episodes where id = '${EP_SRC_IDA}'`,
  );
  record(
    "En uploads episode med kun personens fakta maskeres i stedet for at slettes",
    episode?.content === "Bestyrelsen: [slettet]. Budget godkendt.",
    JSON.stringify(episode),
  );
}

// What L0/L1 read before a forgetting is not saved after it.
async function forgetLock(client) {
  console.log("\nLåsen for L0, L1 og indlæsningen (T-805)");
  const generation = Number(
    (await one(client, "select public.brain_forget_generation($1) as n", [FUND])).n,
  );
  const chunk = (
    await one(client, `select id from public.brain_chunks where fund_id = '${FUND}' limit 1`)
  ).id;
  await q0(client, `update public.brain_chunks set embedding = null where id = '${chunk}'`);
  const rows = JSON.stringify([
    { table: "chunk", id: chunk, embedding: `[${Array(1536).fill(0.2).join(",")}]`, model: "m" },
  ]);
  const stale = (
    await asService(client, "select public.brain_store_vectors($1, $2, $3::jsonb) as r", [
      FUND,
      generation - 1,
      rows,
    ])
  ).rows[0].r;
  record(
    "En vektor læst før en glemsel gemmes ikke",
    stale.skipped === "forgotten" &&
      (await count(
        client,
        `select count(*) as n from public.brain_chunks where id = '${chunk}' and embedding is null`,
      )) === 1,
    JSON.stringify(stale),
  );
  const fresh = (
    await asService(client, "select public.brain_store_vectors($1, $2, $3::jsonb) as r", [
      FUND,
      generation,
      rows,
    ])
  ).rows[0].r;
  record(
    "Med samme tæller gemmes vektoren",
    fresh.stored === 1 &&
      (await count(
        client,
        `select count(*) as n from public.brain_chunks where id = '${chunk}' and embedding_model = 'm'`,
      )) === 1,
    JSON.stringify(fresh),
  );
  const onlyIfNull = JSON.stringify([
    {
      table: "chunk",
      id: chunk,
      embedding: `[${Array(1536).fill(0.3).join(",")}]`,
      onlyIfNull: true,
    },
  ]);
  record(
    "onlyIfNull lader en eksisterende vektor stå",
    (
      await asService(client, "select public.brain_store_vectors($1, $2, $3::jsonb) as r", [
        FUND,
        generation,
        onlyIfNull,
      ])
    ).rows[0].r.stored === 0,
  );
  const apply = (
    await asService(
      client,
      "select public.brain_apply_extraction_checked($1, $2, gen_random_uuid(), '{}'::jsonb, $3) as r",
      [FUND, CASE, generation - 1],
    )
  ).rows[0].r;
  record(
    "L1's batch fra før en glemsel gemmes ikke (episoderne venter)",
    apply.skipped === "forgotten",
    JSON.stringify(apply),
  );
  const applySource = (
    await asService(
      client,
      "select public.brain_apply_extraction_source_checked($1, $2, gen_random_uuid(), '{}'::jsonb, $3) as r",
      [FUND, SRC_DORTE, generation - 1],
    )
  ).rows[0].r;
  record(
    "Det samme for en kildes batch",
    applySource.skipped === "forgotten",
    JSON.stringify(applySource),
  );
  const unknown = await expectError(
    client,
    `select public.brain_store_vectors('${FUND}', ${generation}, '[{"table": "brain_log", "id": "${chunk}", "embedding": "[1]"}]'::jsonb)`,
    /unknown table/,
  );
  record("Kun chunks, fakta og entiteter kan få vektorer", unknown === true, String(unknown));
  const noGeneration = await expectError(
    client,
    `select public.brain_store_vectors('${FUND}', null, '[]'::jsonb)`,
    /generation/,
  );
  record("Uden tæller afvises kaldet", noGeneration === true, String(noGeneration));
  const captured = (
    await asService(client, "select public.brain_capture_case_checked($1, $2) as r", [FUND, CASE])
  ).rows[0].r;
  const projected = (
    await asService(client, "select public.brain_project_db_entities_checked($1, $2) as r", [
      FUND,
      CASE,
    ])
  ).rows[0].r;
  record(
    "L0's opsamling og projektion kører med låsen",
    captured !== null && projected !== null,
    JSON.stringify([captured, projected]).slice(0, 200),
  );
}

async function q0(client, sql) {
  await client.query(sql);
}

async function rights(client) {
  console.log("\nRettigheder");
  for (const call of [
    `select public.gdpr_forget_person('${FUND}', '${BENTE}')`,
    `select public.gdpr_forget_person_raw('${FUND}', '${BENTE}', array['Bente Holm'])`,
    `select public.brain_forget_person('${FUND}', null, '{}', array['Bente Holm'])`,
    `select public.brain_forget_person_derived('${FUND}', array['Bente Holm'])`,
    `select public.brain_forget_person_names('${FUND}', array['Bente Holm'])`,
    `select public.gdpr_person_terms('${FUND}', '${BENTE}', null)`,
    `select public.gdpr_person_preview('${FUND}', '${BENTE}', null)`,
    `select public.brain_store_vectors('${FUND}', 0, '[]'::jsonb)`,
    `select public.brain_apply_extraction_checked('${FUND}', '${CASE}', gen_random_uuid(), '{}'::jsonb, 0)`,
    `select public.brain_apply_extraction_source_checked('${FUND}', gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 0)`,
    `select public.brain_capture_case_checked('${FUND}', '${CASE}')`,
    `select public.brain_project_db_entities_checked('${FUND}', '${CASE}')`,
    `select public.gdpr_unread_sources('${FUND}')`,
    `select public.gdpr_texts_name_person('{x}', '{x}')`,
  ]) {
    await client.query("savepoint forget_user");
    let code = null;
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USER]);
      await client.query(call);
    } catch (cause) {
      code = cause.code;
    } finally {
      await client.query("rollback to savepoint forget_user");
    }
    record(`Kun serveren: ${call.slice(7, 42)}…`, code === "42501", String(code));
  }
}

// Uploads not read in yet, and the "Find med Brain" quotes.
async function unreadSourcesAndProposals(client) {
  console.log("\nUlæste kilder og Find med Brain (T-786, T-787)");
  const q = (sql, params = []) => client.query(sql, params);
  const KAREN = "f3000000-0000-4000-8000-000000000701";
  const LARS = "f3000000-0000-4000-8000-000000000702";
  const WAITING = "f3000000-0000-4000-8000-000000000711";
  const RUNNING = "f3000000-0000-4000-8000-000000000712";
  const READY = "f3000000-0000-4000-8000-000000000713";
  const CHUNKED = "f3000000-0000-4000-8000-000000000714";
  const LARS_FILE = "f3000000-0000-4000-8000-000000000715";
  const NAMED = "f3000000-0000-4000-8000-000000000716";
  const LINKEDIN = "https://www.linkedin.com/in/karen-bjerg-olsen";
  await q(`insert into public.people (id, fund_id, full_name, linkedin_url) values
    ('${KAREN}', '${FUND}', 'Karen Bjerg Olsen', '${LINKEDIN}'),
    ('${LARS}', '${FUND}', 'Lars Ebbe Toft', null)`);
  await q(`insert into public.brain_sources (id, fund_id, kind, title, file_name, storage_path, trust_tier, status, approved_at, step, created_by) values
    ('${WAITING}', '${FUND}', 'pdf', 'Venter', 'venter.pdf', '${FUND}/venter.pdf', 'customer_doc', 'queued', null, null, '${USER}'),
    ('${RUNNING}', '${FUND}', 'pdf', 'I gang', 'i-gang.pdf', '${FUND}/i-gang.pdf', 'customer_doc', 'extracting', now(), 'extract', '${USER}'),
    ('${READY}', '${FUND}', 'pdf', 'Klar', 'klar.pdf', '${FUND}/klar.pdf', 'customer_doc', 'ready', now(), null, '${USER}'),
    ('${CHUNKED}', '${FUND}', 'pdf', 'Læst', 'laest.pdf', '${FUND}/laest.pdf', 'customer_doc', 'embedding', now(), 'embed', '${USER}'),
    ('${LARS_FILE}', '${FUND}', 'pdf', 'Lars', 'lars.pdf', '${FUND}/lars.pdf', 'customer_doc', 'queued', null, null, '${USER}'),
    ('${NAMED}', '${FUND}', 'pdf', 'CV', 'Karen Bjerg Olsen CV.pdf', '${FUND}/cv.pdf', 'customer_doc', 'queued', now(), null, '${USER}')`);
  await q(`insert into public.brain_episodes (fund_id, kind, brain_source_id, trust_tier, title, content, content_hash)
    values ('${FUND}', 'source_chunk', '${CHUNKED}', 'customer_doc', 'Side 1', 'Budget.', 'hash-unread-chunked')`);
  await q(`insert into public.case_field_proposals (fund_id, case_id, metric, fiscal_year, value, currency, certainty, source_kind, source_title, source_url, quote, created_by)
    values ('${FUND}', '${CASE}', 'cash', 2023, 100, 'DKK', 'likely', 'web', 'Interview med Karen Bjerg Olsen',
            '${LINKEDIN}', 'CEO Karen Bjerg Olsen said revenue grew.', '${USER}')`);
  await q(`insert into public.case_financial_inputs (fund_id, case_id, metric, fiscal_year, value, currency, source_note, source_url)
    values ('${FUND}', '${CASE}', 'cash', 2023, 100, 'DKK', 'Interview med Karen Bjerg Olsen: "CEO Karen Bjerg Olsen said revenue grew."', '${LINKEDIN}')`);

  const unread = (
    await asService(client, "select public.gdpr_unread_sources($1) as r", [FUND])
  ).rows[0].r.map((s) => s.id);
  record(
    "Kilder med fil og uden episoder er ulæste (venter og i gang), klar og læst er ikke",
    unread.includes(WAITING) &&
      unread.includes(RUNNING) &&
      !unread.includes(READY) &&
      !unread.includes(CHUNKED),
    JSON.stringify(unread),
  );
  const terms = (
    await asService(client, "select public.gdpr_person_terms($1, $2, null) as r", [FUND, KAREN])
  ).rows[0].r.terms;
  const matches = (
    await asService(client, "select public.gdpr_texts_name_person($1, $2) as r", [
      terms,
      ["Bestyrelse: Karen Bjerg Olsen, formand.", "Kvartalsrapport uden navne.", "Karen kom."],
    ])
  ).rows[0].r;
  record(
    "Serverens tekst tjekkes mod de fulde termer (et fornavn alene tæller ikke)",
    JSON.stringify(matches) === JSON.stringify([true, false, false]),
    JSON.stringify(matches),
  );

  // Kept: the file the server found the name in must be approved again; the others are untouched.
  const kept = (
    await asService(client, "select public.gdpr_forget_person($1, $2, null, false, $3) as r", [
      FUND,
      KAREN,
      [RUNNING, READY],
    ])
  ).rows[0].r;
  const sources = Object.fromEntries(
    (
      await q(
        `select id, status, step, approved_at, storage_path from public.brain_sources where id in ('${WAITING}', '${RUNNING}', '${READY}', '${NAMED}')`,
      )
    ).rows.map((row) => [row.id, row]),
  );
  record(
    "Valgt fra: ulæste kilder med navnet (i filen eller filnavnet) skal godkendes igen",
    sources[RUNNING].approved_at === null &&
      sources[RUNNING].status === "queued" &&
      sources[RUNNING].step === null &&
      sources[RUNNING].storage_path === `${FUND}/i-gang.pdf` &&
      sources[WAITING].status === "queued" &&
      sources[READY].status === "ready" &&
      sources[READY].approved_at !== null &&
      sources[NAMED].approved_at === null &&
      kept.filesKept === 2 &&
      kept.notCovered.includes("files_kept") &&
      kept.filesToRemove.length === 0,
    JSON.stringify([sources, kept.filesKept]),
  );
  const proposal = await one(
    client,
    `select quote, source_title, source_url from public.case_field_proposals where case_id = '${CASE}' and fiscal_year = 2023`,
  );
  const input = await one(
    client,
    `select source_note, source_url from public.case_financial_inputs where case_id = '${CASE}' and fiscal_year = 2023`,
  );
  record(
    "Find med Brain: citat, kildetitel og noten på Økonomi maskeres, adressen tømmes",
    proposal.quote === "CEO [slettet person] said revenue grew." &&
      proposal.source_title === "Interview med [slettet person]" &&
      proposal.source_url === null &&
      input.source_note ===
        'Interview med [slettet person]: "CEO [slettet person] said revenue grew."' &&
      input.source_url === null &&
      kept.raw.rawMasked["case_field_proposals.quote"] === 1 &&
      kept.raw.rawMasked["case_financial_inputs.source_note"] === 1,
    JSON.stringify([proposal, input, kept.raw.rawMasked]),
  );

  // Removed: the unread file goes like the others (path emptied, in the reply for the server).
  const removed = (
    await asService(client, "select public.gdpr_forget_person($1, $2, null, true, $3) as r", [
      FUND,
      LARS,
      [LARS_FILE],
    ])
  ).rows[0].r;
  const larsFile = await one(
    client,
    `select storage_path from public.brain_sources where id = '${LARS_FILE}'`,
  );
  record(
    "Valgt til: den ulæste fil slettes som de andre (stien tømmes og står i svaret)",
    larsFile.storage_path === null &&
      removed.filesToRemove.some(
        (f) => f.kind === "brain_source" && f.id === LARS_FILE && f.path === `${FUND}/lars.pdf`,
      ),
    JSON.stringify([larsFile, removed.filesToRemove]),
  );
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await seed(client);
    await helpers(client);
    await boundaries(client);
    await rights(client);
    await forget(client);
    await exportAfterForget(client);
    await entityLinksPerson(client);
    await entityOnly(client);
    await contextTerms(client);
    await completeForget(client);
    await reviewFindings(client);
    await forgetLock(client);
    await unreadSourcesAndProposals(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(`\n${results.passed} tjek som forventet, ${results.failures.length} afvigelser.`);
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`FEJL: ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
