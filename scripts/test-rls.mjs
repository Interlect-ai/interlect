#!/usr/bin/env node
/**
 * Rettigheder i databasen: rolle × handling.
 *
 *   npm run db:local -- fresh && npm run test:rls
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything happens in one transaction that is
 * rolled back, so the database is unchanged afterwards.
 *
 * Five test users: Admin, Lead, Medlem and Læser in fund A and an Admin in fund B ("other").
 * Each check runs as one user exactly like PostgREST does it (role authenticated plus the
 * JWT subject), inside a savepoint that is rolled back. Allowed means: no error and, for
 * reads and updates, at least one row. Fund B must never see or change anything in fund A.
 * Every check runs twice: with the fund's Medlem settings off (default) and on.
 *
 * The server functions add their own capability check on top (src/lib/domain/workflow.ts,
 * covered by workflow.test.ts). This script covers what a user could do directly with their
 * own session, which is what RLS must stop.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { movementKind, movementKindCases } from "../src/lib/brain/movement.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND_A = "a0000000-0000-4000-8000-00000000000a";
const FUND_B = "b0000000-0000-4000-8000-00000000000b";
const USERS = {
  admin: "a0000000-0000-4000-8000-000000000001",
  lead: "a0000000-0000-4000-8000-000000000002",
  member: "a0000000-0000-4000-8000-000000000003",
  reader: "a0000000-0000-4000-8000-000000000004",
  other: "b0000000-0000-4000-8000-000000000001",
};
const ROLE_OF = {
  admin: "admin",
  lead: "lead",
  member: "member",
  reader: "reader",
  other: "admin",
};
const IDS = {
  companyA: "a0000000-0000-4000-8000-0000000000c1",
  caseA: "a0000000-0000-4000-8000-0000000000c2",
  companyB: "b0000000-0000-4000-8000-0000000000c1",
  caseB: "b0000000-0000-4000-8000-0000000000c2",
  companyA2: "a0000000-0000-4000-8000-0000000000c3",
  caseA2: "a0000000-0000-4000-8000-0000000000c4",
};
const ACTORS = ["admin", "lead", "member", "reader", "other"];

/** Seed as postgres (bypasses RLS). Only fixed test ids; nothing here is read by the app. */
const SEED = `
  insert into auth.users (id, email) values
    ('${USERS.admin}', 'rls-admin@interlect.test'),
    ('${USERS.lead}', 'rls-lead@interlect.test'),
    ('${USERS.member}', 'rls-member@interlect.test'),
    ('${USERS.reader}', 'rls-reader@interlect.test'),
    ('${USERS.other}', 'rls-other@interlect.test');
  insert into public.funds (id, name, slug) values
    ('${FUND_A}', 'RLS fond A', 'rls-fond-a'),
    ('${FUND_B}', 'RLS fond B', 'rls-fond-b');
  insert into public.fund_memberships (fund_id, user_id)
  select case when key = 'other' then '${FUND_B}'::uuid else '${FUND_A}'::uuid end, id::uuid
  from (values
    ('admin', '${USERS.admin}'), ('lead', '${USERS.lead}'), ('member', '${USERS.member}'),
    ('reader', '${USERS.reader}'), ('other', '${USERS.other}')
  ) as u(key, id);
  insert into public.fund_membership_roles (membership_id, role)
  select m.id, r.role::public.app_role
  from public.fund_memberships m
  join (values
    ('${USERS.admin}', 'admin'), ('${USERS.lead}', 'lead'), ('${USERS.member}', 'member'),
    ('${USERS.reader}', 'reader'), ('${USERS.other}', 'admin')
  ) as r(user_id, role) on r.user_id::uuid = m.user_id;
  insert into public.companies (id, fund_id, name) values
    ('${IDS.companyA}', '${FUND_A}', 'Testselskab A'),
    ('${IDS.companyB}', '${FUND_B}', 'Testselskab B');
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by) values
    ('${IDS.caseA}', '${FUND_A}', '${IDS.companyA}', 'manual', '${USERS.admin}'),
    ('${IDS.caseB}', '${FUND_B}', '${IDS.companyB}', 'manual', '${USERS.other}');
  -- A figure someone entered on case A's Økonomi (0102, T-662).
  insert into public.case_financial_inputs (fund_id, case_id, metric, fiscal_year, value, entered_by)
  values ('${FUND_A}', '${IDS.caseA}', 'revenue', 2025, 1000000, '${USERS.member}');
  -- A figure Brain proposed for case A (0107, T-756).
  insert into public.case_field_proposals (fund_id, case_id, metric, fiscal_year, value, currency,
    certainty, source_kind, quote, created_by)
  values ('${FUND_A}', '${IDS.caseA}', 'cash', 2025, 500000, 'DKK', 'likely', 'web', 'Cash 500.000 kr.', '${USERS.member}');
  -- A decided case in fund A (0033), for the decisions view.
  insert into public.companies (id, fund_id, name) values ('${IDS.companyA2}', '${FUND_A}', 'Besluttet A');
  insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
  values ('${IDS.caseA2}', '${FUND_A}', '${IDS.companyA2}', 'manual', '${USERS.admin}');
  select public.transition_case('${FUND_A}', '${IDS.caseA2}', '${USERS.admin}', 'decided', 'closed', '{small_market}');
  -- A screening run and a score recalculation on case A (0034).
  insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
  values ('a0000000-0000-4000-8000-0000000000e1', '${FUND_A}', 1, 'rls', 'test');
  -- The fund's own prompt texts on that version (0012, 0016), read only by those who configure (0104).
  insert into public.prompt_module_overrides (config_version_id, module_id, mandate, evidence_tests, risk_areas)
  values ('a0000000-0000-4000-8000-0000000000e1', 'people_team', '{a}', '{b}', '{c}');
  insert into public.research_module_overrides (config_version_id, mode, module_id, questions)
  values ('a0000000-0000-4000-8000-0000000000e1', 'deep', 'founders_team', '{Hvem er grundlæggerne?}');
  -- An AI proposal against that draft (0051).
  insert into public.fund_config_proposals (id, fund_id, config_version_id, source, instruction,
    summary, changes, base_fingerprint, created_by)
  values ('a0000000-0000-4000-8000-0000000000f2', '${FUND_A}',
    'a0000000-0000-4000-8000-0000000000e1', 'ai_fix', 'Sænk tærsklen', 'Tærsklen sænkes til 65.',
    '[{"op":"set_threshold","number":65}]'::jsonb, 'rls-test-fingerprint-1', '${USERS.lead}');
  -- With the internals a finished run carries (T-915): price, model and tokens on the run, in
  -- validation_result next to the team's answers, and on its step.
  insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status,
    workflow_version, prompt_template_name, prompt_template_version, requested_by, model_name,
    token_usage, input_tokens, output_tokens, actual_cost, validation_result)
  values ('a0000000-0000-4000-8000-0000000000e2', '${FUND_A}', '${IDS.caseA}',
    'a0000000-0000-4000-8000-0000000000e1', 'screening', 'complete', 'test', 'test', 'test',
    '${USERS.lead}', 'openai/gpt-5.4', 900, 600, 300, 0.21,
    '{"teamGateAnswers": [{"gateKey": "geo", "passed": true}], "financeScore": null,
      "model": "openai/gpt-5.4", "costCurrency": "USD", "aiTier": "light",
      "budget": {"usd": 0.4, "actualUsd": 0.21}}'::jsonb);
  insert into public.analysis_run_steps (fund_id, run_id, step_key, step_order, status, model_name,
    prompt_version, input_tokens, output_tokens, total_tokens, actual_cost, output_json)
  values ('${FUND_A}', 'a0000000-0000-4000-8000-0000000000e2', 'screening_research', 1, 'complete',
    'openai/gpt-5.4', 'test', 600, 300, 900, 0.21, '{"callFailed": {"finishReason": "length"}}');
  insert into public.case_score_recalculations (fund_id, case_id, run_id, overall_score, outcome,
    formula_version, result, created_by)
  values ('${FUND_A}', '${IDS.caseA}', 'a0000000-0000-4000-8000-0000000000e2', 72,
    'awaiting_approval', 'test', '{}'::jsonb, '${USERS.lead}');
  -- A message and a searchable document on case A (0035).
  insert into public.case_messages (fund_id, case_id, author_id, body)
  values ('${FUND_A}', '${IDS.caseA}', '${USERS.lead}', 'Hvad siger I til runway?');
  insert into public.documents (fund_id, case_id, kind, file_name, storage_path, mime_type,
    size_bytes, uploaded_by, extracted_text)
  values ('${FUND_A}', '${IDS.caseA}', 'memo', 'Referat af møde.pdf', '${FUND_A}/${IDS.caseA}/referat.pdf',
    'application/pdf', 1000, '${USERS.lead}', 'Selskabet har intentionsaftaler med elleve opdrættere.');
  -- A private thread by the member and a team thread by the lead, with a message each (0047).
  insert into public.brain_threads (id, fund_id, user_id, title, visibility) values
    ('a0000000-0000-4000-8000-0000000000b1', '${FUND_A}', '${USERS.member}', 'Privat', 'private'),
    ('a0000000-0000-4000-8000-0000000000b2', '${FUND_A}', '${USERS.lead}', 'Team', 'team');
  insert into public.brain_messages (id, fund_id, thread_id, role, content) values
    ('a0000000-0000-4000-8000-0000000000b3', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b1', 'user', 'Hemmeligt'),
    ('a0000000-0000-4000-8000-0000000000b4', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b2', 'user', 'Til alle'),
    ('a0000000-0000-4000-8000-0000000000b5', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b2', 'assistant', 'Svar til alle');
  -- The lead's and the member's own rating, with a comment, on the team answer (0047, 0078).
  insert into public.brain_feedback (id, fund_id, message_id, user_id, rating, comment) values
    ('a0000000-0000-4000-8000-0000000000b6', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b5', '${USERS.lead}', 'wrong', 'Leads egen kommentar'),
    ('a0000000-0000-4000-8000-0000000000b7', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b5', '${USERS.member}', 'useful', null);
  -- The member's rating on an answer in the lead's thread that is private (again): the member
  -- can no longer see the answer, so not the rating either (0078).
  insert into public.brain_threads (id, fund_id, user_id, title, visibility) values
    ('a0000000-0000-4000-8000-0000000000b8', '${FUND_A}', '${USERS.lead}', 'Lukket igen', 'private');
  insert into public.brain_messages (id, fund_id, thread_id, role, content) values
    ('a0000000-0000-4000-8000-0000000000b9', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b8', 'assistant', 'Svar til lead');
  insert into public.brain_feedback (id, fund_id, message_id, user_id, rating, comment) values
    ('a0000000-0000-4000-8000-0000000000ba', '${FUND_A}', 'a0000000-0000-4000-8000-0000000000b9', '${USERS.member}', 'wrong', 'Medlemmets kommentar');
  -- A task on case A (0034).
  insert into public.case_tasks (id, fund_id, case_id, kind, title, origin, created_by)
  values ('a0000000-0000-4000-8000-0000000000d1', '${FUND_A}', '${IDS.caseA}', 'question',
          'Hvad er runway?', 'user', '${USERS.lead}');
  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, payload)
  values ('${FUND_A}', 'user', '${USERS.admin}', 'rls_test', 'funds', '{}'::jsonb);
  insert into public.invitations (fund_id, email_normalized, roles, token_hash, expires_at)
  values ('${FUND_A}', 'rls-ny@interlect.test', '{member}', 'rls-test-hash', now() + interval '1 day');
  -- Stored search topics (0099): only the service role reads them.
  insert into public.fund_search_topics (fund_id, brief_key, topics, model)
  values ('${FUND_A}', repeat('a', 64), '{tilbagevendende omsætning}', 'openai/gpt-5.4-mini');
`;

/**
 * Each check: the capability it guards, the SQL run as the user (:me is replaced by the
 * user's id), and the expected outcome per actor. "on" overrides the expectation when the
 * fund's Medlem settings are switched on.
 */
const CHECKS = [
  {
    name: "Læse kørslen og dens trin, som siderne gør (T-915)",
    capability: "view_case",
    sql: `select r.id from public.analysis_runs r
      join public.analysis_run_steps st on st.run_id = r.id
      where r.id = 'a0000000-0000-4000-8000-0000000000e2'
        and r.status = 'complete' and r.stop_reason is null
        and st.step_key = 'screening_research' and st.step_order = 1
        and st.started_at is null and st.completed_at is null`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Teamets gate-svar uden model og pris (validation_public, T-915)",
    capability: "view_case",
    sql: `select 1 from public.analysis_runs
      where id = 'a0000000-0000-4000-8000-0000000000e2'
        and validation_public -> 'teamGateAnswers' -> 0 ->> 'gateKey' = 'geo'
        and validation_public ? 'financeScore'
        and not (validation_public ?| array['model', 'costCurrency', 'aiTier', 'budget'])`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Læse en kørsels pris direkte (T-915)",
    capability: "view_case",
    sql: `select actual_cost from public.analysis_runs`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse en kørsels model direkte (T-915)",
    capability: "view_case",
    sql: `select model_name from public.analysis_runs`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Hente hele kørslen (REST select=*, T-915)",
    capability: "view_case",
    sql: `select * from public.analysis_runs`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Hente hele trinnet (REST select=*, T-915)",
    capability: "view_case",
    sql: `select * from public.analysis_run_steps`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    // One check per column would be 21; the privilege itself is what PostgREST asks.
    name: "Nogen kolonne med pris, model, version, tokens eller AI-svar (T-915, T-784)",
    capability: "view_case",
    sql: `select 1 from (values
        ('analysis_runs', 'model_provider'), ('analysis_runs', 'model_name'),
        ('analysis_runs', 'prompt_template_name'), ('analysis_runs', 'prompt_template_version'),
        ('analysis_runs', 'workflow_version'), ('analysis_runs', 'token_usage'),
        ('analysis_runs', 'input_tokens'), ('analysis_runs', 'output_tokens'),
        ('analysis_runs', 'estimated_cost'), ('analysis_runs', 'actual_cost'),
        ('analysis_runs', 'idempotency_key'), ('analysis_runs', 'validation_result'),
        ('analysis_run_steps', 'model_name'), ('analysis_run_steps', 'prompt_version'),
        ('analysis_run_steps', 'input_tokens'), ('analysis_run_steps', 'output_tokens'),
        ('analysis_run_steps', 'total_tokens'), ('analysis_run_steps', 'actual_cost'),
        ('analysis_run_steps', 'output_json'), ('analysis_run_steps', 'attempt_count'),
        ('analysis_run_steps', 'charged_cost'),
        -- 0123 (T-1075): the run's limit and rate in kroner are for Admin and Lead via the server.
        ('analysis_runs', 'cost_cap_dkk'), ('analysis_runs', 'usd_to_dkk'),
        -- One row per column: a grant on just one of the team's limits must fail on its own.
        ('funds', 'screening_cap_dkk'), ('funds', 'deep_cap_dkk'), ('funds', 'monthly_cap_dkk'),
        ('funds', 'analysis_limit_action'),
        -- T-1070: can hold the provider's or the database's own text; the server maps it.
        ('analysis_runs', 'error_message'), ('analysis_run_steps', 'error_message')
      ) as internal(table_name, column_name)
      where has_column_privilege('public.' || table_name, column_name, 'select')`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Nogen kolonne med model, pris, tokens eller værktøjskald i Brain og kreditter (T-932)",
    capability: "brain_chat",
    sql: `select 1 from (values
        ('brain_messages', 'model'), ('brain_messages', 'cost_usd'), ('brain_messages', 'tool_calls'),
        ('brain_usage', 'model'), ('brain_usage', 'cost_usd'), ('brain_usage', 'input_tokens'),
        ('brain_model_config', 'model'),
        ('brain_jobs', 'cost_usd'), ('brain_jobs', 'stats'),
        ('brain_eval_runs', 'cost_usd'), ('brain_eval_runs', 'results'),
        ('ai_credit_ledger', 'model'), ('ai_credit_ledger', 'loop'), ('ai_credit_ledger', 'user_id'),
        ('ai_credit_ledger', 'amount_dkk')
      ) as internal(table_name, column_name)
      where has_column_privilege('public.' || table_name, column_name, 'select')`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Hente hele Brain-beskeden (REST select=*, T-932)",
    capability: "brain_chat",
    sql: `select * from public.brain_messages`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse Brains forbrug direkte (REST, T-932)",
    capability: "brain_chat",
    sql: `select model, cost_usd from public.brain_usage`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse kreditposterne direkte (REST, T-932)",
    capability: "brain_chat",
    sql: `select model from public.ai_credit_ledger`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse adgangskodelinks direkte (kun serveren, T-929)",
    capability: "manage_users",
    sql: `select token_hash from public.password_resets`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Lave et adgangskodelink direkte (kun serveren, T-929)",
    capability: "manage_users",
    sql: `insert into public.password_resets (fund_id, user_id, email_normalized, token_hash, expires_at)
          values ('${FUND_A}', :me, 'x@example.com', repeat('a', 64), now() + interval '1 day') returning 1`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Skrive i en kørsel direkte (kun serveren, T-915)",
    capability: "view_case",
    sql: `update public.analysis_runs set status = 'failed' where id = 'a0000000-0000-4000-8000-0000000000e2' returning 1`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse fondens gemte søgeemner direkte (kun serveren, 0099)",
    capability: "configure_fund",
    sql: `select 1 from public.fund_search_topics where fund_id = '${FUND_A}'`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Skrive søgeemner direkte (kun serveren, 0099)",
    capability: "configure_fund",
    sql: `insert into public.fund_search_topics (fund_id, brief_key, topics, model) values ('${FUND_A}', repeat('b', 64), '{kunder}', 'x') returning 1`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Sætte kilde og ansvarlig direkte (kun serveren, 0056)",
    capability: "create_case",
    sql: `select public.set_case_origin('${IDS.caseA}', 'network', :me)`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Skrive kilde og ansvarlig direkte i cases (0056)",
    capability: "create_case",
    sql: `update public.cases set source_kind = 'event' where id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse en privat Brain-tråd (kun ejeren, 0047)",
    capability: "brain_chat",
    sql: `select id from public.brain_threads where id = 'a0000000-0000-4000-8000-0000000000b1'`,
    expect: { admin: false, lead: false, member: true, reader: false, other: false },
  },
  {
    name: "Læse en privat tråds beskeder (0047)",
    capability: "brain_chat",
    sql: `select id from public.brain_messages where id = 'a0000000-0000-4000-8000-0000000000b3'`,
    expect: { admin: false, lead: false, member: true, reader: false, other: false },
  },
  {
    name: "Læse en team-tråd og dens beskeder (hele fonden, 0047)",
    capability: "brain_chat",
    sql: `select m.id from public.brain_messages m
          join public.brain_threads t on t.id = m.thread_id
          where m.id = 'a0000000-0000-4000-8000-0000000000b4'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Læse egen vurdering af et svar i en team-tråd (0078)",
    capability: "brain_chat",
    sql: `select id from public.brain_feedback
          where message_id = 'a0000000-0000-4000-8000-0000000000b5' and user_id = :me`,
    expect: { admin: false, lead: true, member: true, reader: false, other: false },
  },
  {
    name: "Læse en kollegas vurdering og kommentar i en team-tråd (kun ejeren, 0078)",
    capability: "brain_chat",
    sql: `select id from public.brain_feedback where id = 'a0000000-0000-4000-8000-0000000000b6'`,
    expect: { admin: false, lead: true, member: false, reader: false, other: false },
  },
  {
    name: "Læse egen vurdering af et svar, man ikke længere kan se (privat tråd, 0078)",
    capability: "brain_chat",
    sql: `select id from public.brain_feedback where id = 'a0000000-0000-4000-8000-0000000000ba'`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Skrive en Brain-besked direkte (kun serveren, 0047)",
    capability: "brain_chat",
    sql: `insert into public.brain_messages (fund_id, thread_id, role, content)
          values ('${FUND_A}', 'a0000000-0000-4000-8000-0000000000b1', 'user', 'x') returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Se cases i fond A",
    capability: "view_case",
    sql: `select id from public.cases where id = '${IDS.caseA}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Se indtastede økonomital på casen (T-662)",
    capability: "view_case",
    sql: `select id from public.case_financial_inputs where case_id = '${IDS.caseA}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Skrive et økonomital direkte (kun serveren må)",
    capability: "correct_evidence",
    sql: `insert into public.case_financial_inputs (fund_id, case_id, metric, fiscal_year, value)
          values ('${FUND_A}', '${IDS.caseA}', 'cash', 2025, 5) returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Rette et økonomital direkte (kun serveren må)",
    capability: "correct_evidence",
    sql: `update public.case_financial_inputs set value = 1 where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Slette et økonomital direkte (kun serveren må)",
    capability: "correct_evidence",
    sql: `delete from public.case_financial_inputs where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Se Brains forslag til et tal på casen (T-756)",
    capability: "view_case",
    sql: `select id from public.case_field_proposals where case_id = '${IDS.caseA}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Skrive et forslag direkte (kun serveren må)",
    capability: "correct_evidence",
    sql: `insert into public.case_field_proposals (fund_id, case_id, metric, fiscal_year, value, currency,
            certainty, source_kind, quote)
          values ('${FUND_A}', '${IDS.caseA}', 'cash', 2024, 5, 'DKK', 'likely', 'web', 'x') returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Rette et forslag direkte (kun serveren må)",
    capability: "correct_evidence",
    sql: `update public.case_field_proposals set status = 'accepted' where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Slette et forslag direkte (kun serveren må)",
    capability: "correct_evidence",
    sql: `delete from public.case_field_proposals where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Skrive en note på casen",
    capability: "write_notes",
    sql: `insert into public.case_notes (fund_id, case_id, author_id, body)
          values ('${FUND_A}', '${IDS.caseA}', :me, 'Test') returning id`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Note i egen fond, men på en anden fonds case",
    capability: "write_notes",
    sql: `insert into public.case_notes (fund_id, case_id, author_id, body)
          values ('${FUND_B}', '${IDS.caseA}', :me, 'Test') returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Note i en andens navn",
    capability: "write_notes",
    // The author is the fund B user; for fund A users that is someone else.
    sql: `insert into public.case_notes (fund_id, case_id, author_id, body)
          values ('${FUND_A}', '${IDS.caseA}', '${USERS.other}', 'Test') returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Registrere evidens",
    capability: "upload_document",
    sql: `insert into public.evidence_items (fund_id, case_id, claim, created_by)
          values ('${FUND_A}', '${IDS.caseA}', 'Test', :me) returning id`,
    expect: { admin: true, lead: true, member: true, reader: false, other: false },
  },
  {
    name: "Oprette en case (RPC)",
    capability: "create_case",
    sql: `select public.create_manual_case_for_fund('${FUND_A}', 'Nyt selskab ' || gen_random_uuid(),
          null, 'unknown', null, null, '', '[]'::jsonb) as id`,
    expect: { admin: true, lead: true, member: true, reader: false, other: false },
  },
  {
    name: "Foreslå en ændring til fondsopsætningen",
    capability: "propose_fund_change",
    sql: `insert into public.fund_config_suggestions (fund_id, author_id, body)
          values ('${FUND_A}', :me, 'Hæv tærsklen') returning id`,
    expect: { admin: true, lead: true, member: true, reader: false, other: false },
  },
  {
    name: "Må udgive fondsopsætningen (can_publish_fund_config)",
    capability: "publish_fund_config",
    sql: `select 1 where private.can_publish_fund_config(:me, '${FUND_A}')`,
    expect: { admin: true, lead: true, member: false, reader: false, other: false },
    on: { member: true },
  },
  {
    name: "Må beslutte investeret/luk (can_decide_case)",
    capability: "decide_case",
    sql: `select 1 where private.can_decide_case(:me, '${FUND_A}')`,
    expect: { admin: true, lead: true, member: false, reader: false, other: false },
    on: { member: true },
  },
  {
    name: "Omdøbe fonden",
    capability: "manage_users",
    sql: `update public.funds set name = 'Nyt navn' where id = '${FUND_A}' returning id`,
    expect: { admin: true, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Slå Medlem-indstillinger til direkte (kun serveren må)",
    capability: "manage_users",
    sql: `update public.funds set member_can_decide = true where id = '${FUND_A}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  // 0036: AI-niveau og prisloft pr. fond. Alle roller i fonden læser, kun serveren skriver.
  {
    name: "Læse fondens AI-niveau og prisloft",
    capability: "view_case",
    sql: `select 1 from public.funds
          where id = '${FUND_A}' and screening_tier is not null and deep_tier is not null`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Ændre AI-niveau direkte (kun serveren må)",
    capability: "configure_fund",
    sql: `update public.funds set screening_tier = 'heavy', deep_tier = 'light'
          where id = '${FUND_A}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Ændre prisloft direkte (kun serveren må)",
    capability: "configure_fund",
    sql: `update public.funds set screening_cap_dkk = 99, deep_cap_dkk = 499
          where id = '${FUND_A}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  // 0123: kroner kun gennem serveren, for Admin og Lead. Direkte læsning afvises for alle.
  {
    name: "Læse fondens analysegrænser direkte (kun serveren må)",
    capability: "configure_fund",
    sql: `select screening_cap_dkk, deep_cap_dkk, monthly_cap_dkk, analysis_limit_action
          from public.funds where id = '${FUND_A}'`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse en kørsels prisloft direkte (kun serveren må)",
    capability: "configure_fund",
    sql: `select 1 from public.analysis_runs where fund_id = '${FUND_A}' and cost_cap_dkk is null`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse en kørsels kurs direkte (kun serveren må, T-1075)",
    capability: "configure_fund",
    sql: `select usd_to_dkk from public.analysis_runs where fund_id = '${FUND_A}'`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    // 0125: the month's used and reserved kroner; only the server calls it (for Admin and Lead).
    name: "Kalde fund_analysis_month direkte (kun serveren må, T-1075)",
    capability: "configure_fund",
    sql: `select * from public.fund_analysis_month('${FUND_A}')`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    // The positive side of the column grant in 0123: every role still reads what the pages need.
    name: "Læse fondens tilladte kolonner efter 0123 (T-1075)",
    capability: "view_case",
    sql: `select id, name, slug, created_at, updated_at, member_can_decide, member_can_publish,
            screening_tier, deep_tier, language, demo_view
          from public.funds where id = '${FUND_A}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Læse kørslens stopgrund, som casesiden gør (0124, T-1075)",
    capability: "view_case",
    sql: `select stop_reason from public.analysis_runs where fund_id = '${FUND_A}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Ændre analysegrænser direkte (kun serveren må)",
    capability: "configure_fund",
    sql: `update public.funds set monthly_cap_dkk = 1, analysis_limit_action = 'ask'
          where id = '${FUND_A}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  // 0051: AI-forslag til kladden. Alle roller i fonden læser, kun serveren skriver.
  {
    name: "Læse AI-forslag til kladden",
    capability: "view_case",
    sql: `select id from public.fund_config_proposals where fund_id = '${FUND_A}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Godkende et AI-forslag direkte (kun serveren må)",
    capability: "configure_fund",
    sql: `update public.fund_config_proposals set status = 'rejected', decided_at = now()
          where id = 'a0000000-0000-4000-8000-0000000000f2' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Tælle pladser direkte (kun serveren må)",
    capability: "manage_users",
    sql: `select * from public.seat_usage()`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  // 0033: fase, status, overgange og årsager
  {
    name: "Oprette en case direkte (uden om serveren)",
    capability: "create_case",
    sql: `insert into public.cases (fund_id, company_id, primary_origin, created_by)
          values ('${FUND_A}', '${IDS.companyA}', 'manual', :me) returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Ændre fase/status direkte",
    capability: "move_process_stage",
    sql: `update public.cases set status = 'on_hold' where id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Kalde transition_case direkte (kun serveren må)",
    capability: "move_process_stage",
    sql: `select * from public.transition_case('${FUND_A}', '${IDS.caseA}', :me, null, 'on_hold', '{too_early}')`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Kalde undo_case_transitions direkte (kun serveren må)",
    capability: "move_process_stage",
    sql: `select * from public.undo_case_transitions('${FUND_A}', :me, gen_random_uuid())`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Se overgangsloggen for fond A",
    capability: "view_case",
    sql: `select id from public.case_transition_events where case_id = '${IDS.caseA2}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Rette i overgangsloggen",
    capability: "move_process_stage",
    sql: `update public.case_transition_events set note = 'x' where case_id = '${IDS.caseA2}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Se årsagskoder for fond A",
    capability: "view_case",
    sql: `select id from public.brain_reason_codes where fund_id = '${FUND_A}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Tilføje en årsagskode direkte",
    capability: "configure_fund",
    sql: `insert into public.brain_reason_codes (fund_id, code, label, group_key, applies_to)
          values ('${FUND_A}', 'ny_kode', 'Ny', 'other', '{hold}') returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Se beslutninger (brain_case_decisions)",
    capability: "view_case",
    sql: `select case_id from public.brain_case_decisions where case_id = '${IDS.caseA2}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  // 0034: tasks og genberegninger (kun læsning for brugere; serveren skriver)
  {
    name: "Se tasks på casen",
    capability: "view_case",
    sql: `select id from public.case_tasks where case_id = '${IDS.caseA}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Oprette en task direkte (uden om serveren)",
    capability: "manage_tasks",
    sql: `insert into public.case_tasks (fund_id, case_id, kind, title, origin, created_by)
          values ('${FUND_A}', '${IDS.caseA}', 'task', 'Test', 'user', :me) returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Løse en task direkte (uden om serveren)",
    capability: "manage_tasks",
    sql: `update public.case_tasks set status = 'resolved', resolved_at = now()
          where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Se genberegninger af scoren",
    capability: "view_case",
    sql: `select id from public.case_score_recalculations where case_id = '${IDS.caseA}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  // 0035: beskeder og filer
  {
    name: "Læse beskeder på casen",
    capability: "view_case",
    sql: `select id from public.case_messages where case_id = '${IDS.caseA}'`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Skrive en besked direkte (uden om serveren)",
    capability: "write_messages",
    sql: `insert into public.case_messages (fund_id, case_id, author_id, body)
          values ('${FUND_A}', '${IDS.caseA}', :me, 'Hej') returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Rette en besked direkte",
    capability: "write_messages",
    sql: `update public.case_messages set body = 'x' where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Søge i fondens filer (search_case_documents)",
    capability: "view_case",
    sql: `select id from public.search_case_documents('${FUND_A}', 'opdrætter')`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Knytte en fil til en task direkte",
    capability: "manage_tasks",
    sql: `update public.documents set task_id = 'a0000000-0000-4000-8000-0000000000d1'
          where case_id = '${IDS.caseA}' returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Oprette et dokument direkte (uden om serveren)",
    capability: "upload_document",
    sql: `insert into public.documents (fund_id, case_id, kind, file_name, storage_path, mime_type,
            size_bytes, uploaded_by)
          values ('${FUND_A}', '${IDS.caseA}', 'other', 'x.pdf', '${FUND_A}/${IDS.caseA}/' || gen_random_uuid(),
            'application/pdf', 10, :me) returning id`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Slette en hel fond direkte (delete_fund, kun serveren)",
    capability: "manage_users",
    sql: `select public.delete_fund('${FUND_A}')`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Registrere et pitch deck (Læser har ikke upload, 0039)",
    capability: "upload_document",
    sql: `select public.register_pitch_deck('${IDS.caseA}', 'deck.pdf',
          '${FUND_A}/${IDS.caseA}/rls-deck.pdf', 'application/pdf', 1000)`,
    expect: { admin: true, lead: true, member: true, reader: false, other: false },
  },
  // A member of A must not register a path that the storage resolves into B's folder.
  ...[
    `${FUND_A}/${IDS.caseA}/../../${FUND_B}/${IDS.caseB}/rls-deck.pdf`,
    `${FUND_A}/${IDS.caseA}/%2e%2e/%2e%2e/${FUND_B}/${IDS.caseB}/rls-deck.pdf`,
    `${FUND_A}/${IDS.caseA}/..\\..\\${FUND_B}\\rls-deck.pdf`,
    `${FUND_A}/${IDS.caseA}//rls-deck.pdf`,
    `${FUND_A}/${IDS.caseA}/x/rls-deck.pdf`,
  ].map((path, index) => ({
    name: `Pitch deck med sti, der forlader casens mappe (${index + 1}, 0100)`,
    capability: "upload_document",
    sql: `select public.register_pitch_deck('${IDS.caseA}', 'deck.pdf', '${path}',
          'application/pdf', 1000)`,
    expect: { admin: false, lead: false, member: false, reader: false, other: false },
  })),
  {
    name: "Se revisionsloggen (kun Admin, 0039)",
    capability: "manage_users",
    sql: `select id from public.audit_events where fund_id = '${FUND_A}'`,
    expect: { admin: true, lead: false, member: false, reader: false, other: false },
  },
  {
    name: "Læse fondens egne prompttekster til specialisterne (kun dem, der redigerer opsætningen, 0104)",
    capability: "configure_fund",
    sql: `select id from public.prompt_module_overrides`,
    expect: { admin: true, lead: true, member: false, reader: false, other: false },
  },
  {
    name: "Læse fondens egne researchspørgsmål (kun dem, der redigerer opsætningen, 0104)",
    capability: "configure_fund",
    sql: `select id from public.research_module_overrides`,
    expect: { admin: true, lead: true, member: false, reader: false, other: false },
  },
  {
    name: "Spørge, om en kollega er medlem af ens eget team (0104)",
    capability: "view_case",
    sql: `select 1 where public.is_fund_member('${USERS.admin}', '${FUND_A}')`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Spørge om en andens rolle i et fremmed team giver ikke noget svar (0104)",
    capability: "view_case",
    sql: `select 1 where public.has_fund_role('${USERS.admin}', '${FUND_A}', 'admin')`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Spørge om roller i et fremmed team giver en tom liste (0104)",
    capability: "view_case",
    sql: `select 1 where cardinality(public.fund_roles('${USERS.admin}', '${FUND_A}')) > 0`,
    expect: { admin: true, lead: true, member: true, reader: true, other: false },
  },
  {
    name: "Se fondens invitationer",
    capability: "manage_users",
    sql: `select id from public.invitations where fund_id = '${FUND_A}'`,
    expect: { admin: true, lead: false, member: false, reader: false, other: false },
  },
];

/**
 * Errors that mean "the database refused": missing privilege or RLS (42501) and our own Danish
 * refusals (P0001). A check that is refused by a constraint names that code in `refusal`.
 * Anything else (a typo, a missing column or function) is a broken check, which must never count
 * as "refused" (harden F8/G20).
 */
const REFUSAL_CODES = new Set(["42501", "P0001"]);

async function runCheck(client, check, actor) {
  const sql = check.sql.replaceAll(":me", `'${USERS[actor]}'`);
  await client.query("savepoint rls_check");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USERS[actor]]);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USERS[actor], role: "authenticated" }),
    ]);
    const result = await client.query(sql);
    return { allowed: result.rowCount > 0, detail: `${result.rowCount} rækker` };
  } catch (cause) {
    if (REFUSAL_CODES.has(cause.code) || (check.refusal ?? []).includes(cause.code)) {
      return { allowed: false, detail: cause.message };
    }
    return { allowed: false, broken: true, detail: `${cause.code}: ${cause.message}` };
  } finally {
    await client.query("rollback to savepoint rls_check");
  }
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  const failures = [];
  let passed = 0;
  try {
    await client.query("begin");
    await client.query(SEED);

    for (const settings of ["off", "on"]) {
      await client.query(
        `update public.funds set member_can_decide = $1, member_can_publish = $1 where id = $2`,
        [settings === "on", FUND_A],
      );
      console.log(`\nMedlem-indstillinger ${settings === "on" ? "slået til" : "slået fra"}`);
      console.log(`${"Handling".padEnd(58)} admin lead member reader other`);
      for (const check of CHECKS) {
        const expected = { ...check.expect, ...(settings === "on" ? (check.on ?? {}) : {}) };
        const cells = [];
        for (const actor of ACTORS) {
          const outcome = await runCheck(client, check, actor);
          const ok = !outcome.broken && outcome.allowed === expected[actor];
          cells.push(`${outcome.allowed ? "✓" : "–"}${ok ? " " : "!"}`.padEnd(actor.length + 1));
          if (ok) passed += 1;
          else {
            failures.push(
              `${check.name} · ${actor} (${ROLE_OF[actor]}) · indstillinger ${settings}: ` +
                `forventede ${expected[actor] ? "tilladt" : "afvist"}, fik ${
                  outcome.broken
                    ? "en fejl i selve tjekket"
                    : outcome.allowed
                      ? "tilladt"
                      : "afvist"
                } (${outcome.detail})`,
            );
          }
        }
        console.log(`${check.name.slice(0, 57).padEnd(58)} ${cells.join("")}`);
      }
    }
    // transition_case's own role check, the server's second gate (harden F8): the same
    // call the server makes, once per actor, with the Medlem settings off and on.
    const actorMoves = [
      {
        name: "transition_case som aktør: sæt på hold",
        to: "null, 'on_hold'",
        expect: { admin: true, lead: true, member: true, reader: false, other: false },
      },
      {
        name: "transition_case som aktør: luk (beslutning)",
        to: "'decided', 'closed'",
        expect: { admin: true, lead: true, member: false, reader: false, other: false },
        on: { member: true },
      },
      {
        // "Genåbn i dyb analyse": leaving Besluttet is a decision too (harden Z).
        name: "transition_case som aktør: genåbn besluttet i dyb analyse",
        to: "'deep_analysis', 'active'",
        caseId: IDS.caseA2,
        reasons: "'{}'",
        expect: { admin: true, lead: true, member: false, reader: false, other: false },
        on: { member: true },
      },
    ];
    for (const settings of ["off", "on"]) {
      await client.query(`update public.funds set member_can_decide = $1 where id = $2`, [
        settings === "on",
        FUND_A,
      ]);
      for (const move of actorMoves) {
        const expected = { ...move.expect, ...(settings === "on" ? (move.on ?? {}) : {}) };
        for (const actor of ACTORS) {
          await client.query("savepoint rls_actor");
          let allowed = false;
          let detail = "";
          try {
            // As the server calls it: the service role (the only role with EXECUTE).
            await client.query("set local role service_role");
            const { rows } = await client.query(
              `select changed from public.transition_case($1, $2, $3, ${move.to}, ${move.reasons ?? "'{too_early}'"})`,
              [FUND_A, move.caseId ?? IDS.caseA, USERS[actor]],
            );
            allowed = rows[0]?.changed === true;
            detail = `changed ${rows[0]?.changed}`;
          } catch (cause) {
            detail = /Din rolle kan ikke/.test(cause.message)
              ? "afvist"
              : `fejl i tjekket: ${cause.message}`;
          } finally {
            await client.query("rollback to savepoint rls_actor");
          }
          const ok = allowed === expected[actor] && !detail.startsWith("fejl");
          if (ok) passed += 1;
          else
            failures.push(
              `${move.name} · ${actor} · indstillinger ${settings}: forventede ${
                expected[actor] ? "tilladt" : "afvist"
              }, fik ${detail}`,
            );
        }
      }
    }
    await client.query(`update public.funds set member_can_decide = false where id = $1`, [FUND_A]);
    console.log(
      `\ntransition_case pr. aktør (hold, luk og genåbn, Medlem-indstilling fra og til) kørt.`,
    );

    // A page that saw an older state cannot move the case (0039, harden F5).
    await client.query("savepoint rls_stale");
    const stale = await client.query(
      `select event_id, changed from public.transition_case($1, $2, $3, 'decided', 'closed',
         '{too_early}', _expected_status => 'on_hold')`,
      [FUND_A, IDS.caseA, USERS.lead],
    );
    const staleCase = await client.query("select phase, status from public.cases where id = $1", [
      IDS.caseA,
    ]);
    const fresh = await client.query(
      `select changed from public.transition_case($1, $2, $3, null, 'on_hold', '{too_early}',
         _expected_phase => 'screening', _expected_status => 'active')`,
      [FUND_A, IDS.caseA, USERS.lead],
    );
    await client.query("rollback to savepoint rls_stale");
    const staleOk =
      stale.rows[0]?.changed === false &&
      stale.rows[0]?.event_id === null &&
      staleCase.rows[0]?.status === "active" &&
      fresh.rows[0]?.changed === true;
    console.log(`Forældet side kan ikke flytte casen (_expected_status) ${staleOk ? "✓" : "!"}`);
    if (staleOk) passed += 1;
    else failures.push("transition_case flyttede en case, der ikke stod som forventet.");

    // Migration 0130 cleans an old deep run's research to the answer's own keys (the
    // statement is read from the migration, so the test runs the shipped SQL), and leaves a
    // screening's raw_response alone.
    await client.query("savepoint rls_run_internals");
    const cleanup = readFileSync(
      join(ROOT, "db", "migrations", "0130_run_ai_internals_cleanup.sql"),
      "utf8",
    ).match(/update public\.analysis_runs[\s\S]*?;/)?.[0];
    const internalsRuns = await client.query(
      `insert into public.analysis_runs (fund_id, case_id, config_version_id, kind, status,
         workflow_version, prompt_template_name, prompt_template_version, requested_by,
         raw_response)
       values
         ($1, $2, 'a0000000-0000-4000-8000-0000000000e1', 'deep', 'complete', 'test', 'test',
          'test', $3, $4::jsonb),
         ($1, $2, 'a0000000-0000-4000-8000-0000000000e1', 'screening', 'complete', 'test',
          'test', 'test', $3, $5::jsonb)
       returning id, kind`,
      [
        FUND_A,
        IDS.caseA,
        USERS.lead,
        JSON.stringify({
          schemaVersion: "interlect-deep-orchestrated-v1",
          publicResearch: {
            schemaVersion: "interlect-public-research-v1",
            companyName: "Veo",
            findings: [],
            gaps: ["g"],
            identityAmbiguity: null,
            companyProfile: null,
            researchPlan: { model: "openai/gpt-5.4-mini" },
            researchFollowUp: { model: "perplexity/sonar-pro" },
            researchLog: [{ error: "openai: rate limited" }],
            questionNeutralizer: { model: "openai/gpt-5.4-mini" },
          },
          synthesis: { keep: true },
        }),
        JSON.stringify({ gates: [], researchPlan: { model: "kept-in-screening" } }),
      ],
    );
    if (cleanup) await client.query(cleanup);
    const cleaned = await client.query(
      "select kind, raw_response from public.analysis_runs where id = any($1::uuid[])",
      [internalsRuns.rows.map((row) => row.id)],
    );
    await client.query("rollback to savepoint rls_run_internals");
    const deepRow = cleaned.rows.find((row) => row.kind === "deep")?.raw_response;
    const screeningRow = cleaned.rows.find((row) => row.kind === "screening")?.raw_response;
    const internalsOk =
      Boolean(cleanup) &&
      JSON.stringify(Object.keys(deepRow?.publicResearch ?? {}).sort()) ===
        JSON.stringify([
          "companyName",
          "companyProfile",
          "findings",
          "gaps",
          "identityAmbiguity",
          "schemaVersion",
        ]) &&
      deepRow?.synthesis?.keep === true &&
      !/openai|perplexity|model/.test(JSON.stringify(deepRow)) &&
      screeningRow?.researchPlan?.model === "kept-in-screening";
    console.log(
      `0130 renser den dybe analyses research til selve svaret ${internalsOk ? "✓" : "!"}`,
    );
    if (internalsOk) passed += 1;
    else failures.push("0130 efterlod modelnavne i raw_response eller rørte en screening.");

    // The decision snapshot stores the latest code recalculation of the latest finished
    // screening and that screening's own setup version (0039, harden).
    await client.query("savepoint rls_snapshot");
    // The run's own recommendation (60) and an active newer setup version must lose to the
    // recalculation (72) and the run's version; a newer failed screening must not count.
    const snapshotRun = "a0000000-0000-4000-8000-0000000000e2";
    await client.query(
      "update public.analysis_runs set completed_at = now() - interval '1 minute' where id = $1",
      [snapshotRun],
    );
    await client.query(
      `insert into public.recommendations (fund_id, run_id, recommendation, overall_score, rationale)
       values ($1, $2, 'follow', 60, 'test')`,
      [FUND_A, snapshotRun],
    );
    await client.query(
      `insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
       values ('a0000000-0000-4000-8000-0000000000e9', $1, 2, 'rls', 'test')`,
      [FUND_A],
    );
    await client.query(
      `insert into public.analysis_runs (fund_id, case_id, config_version_id, kind, status,
         workflow_version, prompt_template_name, prompt_template_version, requested_by, completed_at)
       values ($1, $2, 'a0000000-0000-4000-8000-0000000000e9', 'screening', 'failed', 'test',
         'test', 'test', $3, now())`,
      [FUND_A, IDS.caseA, USERS.lead],
    );
    // Two statements: a row inserted inside a function is not visible to the statement that
    // called it.
    const moved = await client.query(
      `select event_id from public.transition_case($1, $2, $3, null, 'on_hold', '{too_early}')`,
      [FUND_A, IDS.caseA, USERS.lead],
    );
    const snapshot = await client.query(
      "select screening_score, config_version_id from public.case_transition_events where id = $1",
      [moved.rows[0]?.event_id],
    );
    await client.query("rollback to savepoint rls_snapshot");
    const snapshotOk =
      Number(snapshot.rows[0]?.screening_score) === 72 &&
      snapshot.rows[0]?.config_version_id === "a0000000-0000-4000-8000-0000000000e1";
    console.log(
      `Øjebliksbillede: score ${snapshot.rows[0]?.screening_score ?? "ingen"} fra genberegningen og screeningens version ${snapshotOk ? "✓" : "!"}`,
    );
    if (snapshotOk) passed += 1;
    else
      failures.push(
        "Beslutningens øjebliksbillede bruger ikke genberegningen og kørslens version.",
      );

    // Not even the server can store a path that leaves the fund's folder.
    const storagePaths = [
      [`${FUND_A}/${IDS.caseA}/../../${FUND_B}/${IDS.caseB}/x.pdf`, false],
      [`${FUND_A}/${IDS.caseA}/%2e%2e/x.pdf`, false],
      [`${FUND_B}/${IDS.caseB}/x.pdf`, false],
      [`${FUND_A}/forgotten/a0000000-0000-4000-8000-0000000000f1`, true],
    ];
    for (const [path, allowed] of storagePaths) {
      await client.query("savepoint rls_path");
      let outcome;
      try {
        await client.query("set local role service_role");
        await client.query(
          `insert into public.documents (fund_id, case_id, kind, file_name, storage_path, mime_type,
             size_bytes, uploaded_by)
           values ($1, $2, 'other', 'x.pdf', $3, 'application/pdf', 10, $4)`,
          [FUND_A, IDS.caseA, path, USERS.lead],
        );
        outcome = true;
      } catch (cause) {
        outcome = cause.code === "23514" ? false : `fejl i tjekket: ${cause.message}`;
      } finally {
        await client.query("rollback to savepoint rls_path");
      }
      if (outcome === allowed) passed += 1;
      else
        failures.push(
          `documents.storage_path ${path}: forventede ${allowed ? "tilladt" : "afvist"}, fik ${outcome}`,
        );
    }
    console.log("Filstier, der forlader fondens mappe, afvises af databasen (0100) kørt.");

    // Only the server writes in these relations (0039, harden): no write privilege at all for
    // signed-in users, not just missing policies.
    const { rows: writable } = await client.query(`
      select t.name, p.privilege
      from unnest(array['case_tasks', 'case_score_recalculations', 'case_messages',
                        'brain_reason_codes', 'case_transition_events', 'brain_case_decisions',
                        'fund_config_proposals', 'brain_historical_decisions', 'brain_threads',
                        'brain_messages', 'brain_feedback', 'case_memo_inputs',
                        'case_memo_gap_answers', 'case_memo_versions'])
             as t(name)
      cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) as p(privilege)
      where has_table_privilege('authenticated', 'public.' || t.name, p.privilege)`);
    console.log(
      `Ingen skriveret for brugere på serverens tabeller ${writable.length === 0 ? "✓" : "!"}`,
    );
    if (writable.length === 0) passed += 1;
    else
      failures.push(
        `authenticated kan skrive i: ${writable.map((row) => `${row.name} (${row.privilege})`).join(", ")}`,
      );

    // Database rules that hold for the server too (0033/0034), run with owner rights.
    const rules = [
      {
        name: "Ansvarlig uden for fonden afvises (IL001)",
        sql: `update public.case_tasks set assignee_id = '${USERS.other}'
              where id = 'a0000000-0000-4000-8000-0000000000d1'`,
        error: /ikke medlem/,
        code: "IL001",
      },
      {
        name: "Ansvarlig på en case uden for fonden afvises (IL001, 0056)",
        sql: `update public.cases set assigned_to = '${USERS.other}' where id = '${IDS.caseA}'`,
        error: /ikke medlem/,
        code: "IL001",
      },
      {
        name: "Ukendt kilde på en case afvises (0056)",
        sql: `update public.cases set source_kind = 'tilfaeldig' where id = '${IDS.caseA}'`,
        error: /source_kind/,
      },
      {
        name: "Ansvarlig, der er medlem, og en kendt kilde kan sættes af serveren (0056)",
        sql: `select public.set_case_origin('${IDS.caseA}', 'network', '${USERS.lead}')`,
        error: /ingen fejl/,
      },
      {
        name: "Task på en anden fonds case afvises (sammensat nøgle)",
        sql: `insert into public.case_tasks (fund_id, case_id, kind, title, origin, created_by)
              values ('${FUND_B}', '${IDS.caseA}', 'task', 'Test', 'user', '${USERS.other}')`,
        error: /case_tasks_case_same_fund/,
      },
      {
        name: "Samme AI-hul kan ikke oprettes to gange",
        sql: `insert into public.case_tasks (fund_id, case_id, kind, title, origin, dedupe_key, created_by)
              values ('${FUND_A}', '${IDS.caseA}', 'question', 'X', 'ai', 'none::x', '${USERS.lead}'),
                     ('${FUND_A}', '${IDS.caseA}', 'question', 'X', 'ai', 'none::x', '${USERS.lead}')`,
        error: /case_tasks_dedupe_key/,
      },
      {
        name: "En AI-task skal have en dedupe-nøgle",
        sql: `insert into public.case_tasks (fund_id, case_id, kind, title, origin, created_by)
              values ('${FUND_A}', '${IDS.caseA}', 'question', 'X', 'ai', '${USERS.lead}')`,
        error: /case_tasks_ai_has_dedupe/,
      },
      {
        name: "Fase og status kan ikke ændres uden om transition_case",
        sql: `update public.cases set phase = 'committee' where id = '${IDS.caseA}'`,
        error: /logget overgang/,
      },
      {
        // 0051: a version can only become active when every criterion weighs 5-40 %.
        name: "Et kriterie over 40 % kan ikke blive aktivt (0051)",
        sql: `do $$ begin
                insert into public.assessment_criteria (config_version_id, criterion_key, label,
                  description, score_category, weight, sort_order)
                values ('a0000000-0000-4000-8000-0000000000e1', 'team', 'Team', 'Team', 'team', 100, 1);
                update public.fund_config_versions set status = 'active'
                where id = 'a0000000-0000-4000-8000-0000000000e1';
              end $$`,
        error: /mellem 5 og 40/,
        code: "P0001",
      },
      {
        name: "Et kriterie under 5 % kan ikke blive aktivt (0051)",
        sql: `do $$ begin
                insert into public.assessment_criteria (config_version_id, criterion_key, label,
                  description, score_category, weight, sort_order)
                values ('a0000000-0000-4000-8000-0000000000e1', 'team', 'Team', 'Team', 'team', 96, 1),
                       ('a0000000-0000-4000-8000-0000000000e1', 'lille', 'Lille', 'Lille', 'team', 4, 2);
                update public.fund_config_versions set status = 'active'
                where id = 'a0000000-0000-4000-8000-0000000000e1';
              end $$`,
        error: /mellem 5 og 40/,
        code: "P0001",
      },
      {
        name: "Vægte mellem 5 og 40 % kan blive aktive (0051)",
        sql: `do $$ begin
                insert into public.assessment_criteria (config_version_id, criterion_key, label,
                  description, score_category, weight, sort_order)
                values ('a0000000-0000-4000-8000-0000000000e1', 'a', 'A', 'A', 'team', 40, 1),
                       ('a0000000-0000-4000-8000-0000000000e1', 'b', 'B', 'B', 'team', 35, 2),
                       ('a0000000-0000-4000-8000-0000000000e1', 'c', 'C', 'C', 'team', 25, 3);
                update public.fund_config_versions set status = 'active'
                where id = 'a0000000-0000-4000-8000-0000000000e1';
              end $$`,
        error: /ingen fejl/,
      },
      {
        name: "Besked på en anden fonds case afvises (sammensat nøgle)",
        sql: `insert into public.case_messages (fund_id, case_id, author_id, body)
              values ('${FUND_B}', '${IDS.caseA}', '${USERS.other}', 'x')`,
        error: /case_messages_case_same_fund/,
      },
      {
        name: "Fil kan ikke knyttes til en task i en anden fond",
        sql: `update public.documents set task_id = 'a0000000-0000-4000-8000-0000000000d1',
              fund_id = '${FUND_B}', storage_path = '${FUND_B}/' || id
              where case_id = '${IDS.caseA}'`,
        error: /same_fund|violates foreign key/,
      },
      {
        name: "En genberegning kan ikke rettes",
        sql: `update public.case_score_recalculations set overall_score = 99
              where case_id = '${IDS.caseA}'`,
        error: /kan ikke ændres eller slettes/,
      },
      {
        name: "Overgangsloggen kan ikke slettes",
        sql: `delete from public.case_transition_events where case_id = '${IDS.caseA2}'`,
        error: /kan ikke slettes/,
      },
      {
        // Only a foreign key (ON DELETE SET NULL) may clear a reference (0038).
        name: "En henvisning i loggen kan ikke nulstilles direkte",
        sql: `select public.transition_case('${FUND_A}', '${IDS.caseA}', '${USERS.lead}', null,
                'on_hold', '{too_early}', _analysis_run_id => 'a0000000-0000-4000-8000-0000000000e2');
              update public.case_transition_events set analysis_run_id = null
              where case_id = '${IDS.caseA}' and analysis_run_id is not null`,
        error: /kan ikke ændres/,
      },
    ];
    for (const rule of rules) {
      await client.query("savepoint rls_rule");
      let message = "ingen fejl";
      let code = null;
      try {
        await client.query(rule.sql);
      } catch (cause) {
        message = cause.message;
        code = cause.code;
      } finally {
        await client.query("rollback to savepoint rls_rule");
      }
      const ok = rule.error.test(message) && (!rule.code || rule.code === code);
      console.log(`${rule.name.padEnd(58)} ${ok ? "✓" : "!"}`);
      if (ok) passed += 1;
      else failures.push(`${rule.name}: forventede en fejl, fik "${message}"`);
    }

    // Deleting a whole fund (0037): with an Admin, a published configuration and rows in every
    // table that could block it. A direct delete still meets the last-Admin rule.
    await client.query("savepoint rls_delete_fund");
    await client.query(readFileSync(join(ROOT, "db", "test", "full-fund-seed.sql"), "utf8"));
    let directDelete = "ingen fejl";
    await client.query("savepoint rls_direct");
    try {
      await client.query(
        "delete from public.funds where id = 'd0000000-0000-4000-8000-0000000000f1'",
      );
    } catch (cause) {
      directDelete = cause.message;
    }
    await client.query("rollback to savepoint rls_direct");
    const directOk = /mindst én aktiv Admin/.test(directDelete);
    await client.query("select public.delete_fund('d0000000-0000-4000-8000-0000000000f1')");
    const leftover = await client.query(
      `
      select (select count(*) from public.cases where fund_id = $1)
           + (select count(*) from public.case_transition_events where fund_id = $1)
           + (select count(*) from public.fund_config_versions where fund_id = $1)
           + (select count(*) from public.fund_memberships where fund_id = $1)
           + (select count(*) from public.case_messages where fund_id = $1)
           + (select count(*) from public.scanner_runs where fund_id = $1) as n`,
      ["d0000000-0000-4000-8000-0000000000f1"],
    );
    await client.query("rollback to savepoint rls_delete_fund");
    const deleteOk = directOk && Number(leftover.rows[0].n) === 0;
    console.log(
      `\nSlet hele fonden (delete_fund): ${Number(leftover.rows[0].n)} rækker tilbage; direkte sletning stoppes af Admin-reglen ${deleteOk ? "✓" : "!"}`,
    );
    if (deleteOk) passed += 1;
    else
      failures.push(
        `delete_fund: ${leftover.rows[0].n} rækker tilbage, direkte sletning gav "${directDelete}"`,
      );

    // Accept test from 01-datamodel §0033: bulk on 5 cases + undo gives 10 log rows and the
    // same final state as before (run as the server does it, with service_role rights).
    const bulk = await client.query(`
      with created as (
        insert into public.companies (fund_id, name)
        select '${FUND_A}', 'Bulk ' || n from generate_series(1, 5) as n
        returning id
      )
      insert into public.cases (fund_id, company_id, primary_origin, created_by)
      select '${FUND_A}', id, 'manual', '${USERS.lead}' from created
      returning id`);
    const bulkIds = bulk.rows.map((row) => row.id);
    const batch = "c0000000-0000-4000-8000-00000000ba7c";
    for (const id of bulkIds) {
      await client.query(
        `select * from public.transition_case($1, $2, $3, null, 'on_hold', '{too_early}', null, $4)`,
        [FUND_A, id, USERS.lead, batch],
      );
    }
    const undone = await client.query(
      "select count(*)::int as n from public.undo_case_transitions($1, $2, $3) where undone",
      [FUND_A, USERS.lead, batch],
    );
    const after = await client.query(
      `select
         (select count(*)::int from public.case_transition_events where case_id = any($1)) as log_rows,
         (select count(*)::int from public.cases where id = any($1) and phase = 'screening' and status = 'active') as back`,
      [bulkIds],
    );
    const flowOk =
      undone.rows[0].n === 5 && after.rows[0].log_rows === 10 && after.rows[0].back === 5;
    console.log(
      `\nBulk 5 + fortryd: ${undone.rows[0].n} fortrudt, ${after.rows[0].log_rows} logrækker, ${after.rows[0].back} tilbage som før ${flowOk ? "✓" : "!"}`,
    );
    if (flowOk) passed += 1;
    else failures.push("Bulk 5 + fortryd gav ikke 10 logrækker og samme slutstatus.");

    // brain_case_decisions (0038): undoing a later move restores the decision; undoing the
    // decision itself removes it.
    const decided = bulkIds[0];
    const [rejectBatch, reopenBatch] = [
      "c0000000-0000-4000-8000-0000000de1a1",
      "c0000000-0000-4000-8000-0000000de1a2",
    ];
    await client.query(
      `select * from public.transition_case($1, $2, $3, 'decided', 'closed', '{too_early}', null, $4)`,
      [FUND_A, decided, USERS.lead, rejectBatch],
    );
    await client.query(
      `select * from public.transition_case($1, $2, $3, 'screening', 'active', '{}', null, $4)`,
      [FUND_A, decided, USERS.lead, reopenBatch],
    );
    await client.query("select * from public.undo_case_transitions($1, $2, $3)", [
      FUND_A,
      USERS.lead,
      reopenBatch,
    ]);
    const afterReopenUndo = await client.query(
      "select decision_kind from public.brain_case_decisions where case_id = $1",
      [decided],
    );
    await client.query("select * from public.undo_case_transitions($1, $2, $3)", [
      FUND_A,
      USERS.lead,
      rejectBatch,
    ]);
    const afterRejectUndo = await client.query(
      "select count(*)::int as n from public.brain_case_decisions where case_id = $1",
      [decided],
    );
    const decisionsOk =
      afterReopenUndo.rows[0]?.decision_kind === "reject" && afterRejectUndo.rows[0].n === 0;
    console.log(
      `Afgørelser efter fortryd: genåbn fortrudt → ${afterReopenUndo.rows[0]?.decision_kind ?? "ingen"}, afgørelsen fortrudt → ${afterRejectUndo.rows[0].n} ${decisionsOk ? "✓" : "!"}`,
    );
    if (decisionsOk) passed += 1;
    else
      failures.push("brain_case_decisions følger ikke fortryd af genåbn og af selve afgørelsen.");

    // brain_movement_kind (SQL) and src/lib/brain/movement.ts must agree on every combination.
    let parityChecked = 0;
    for (const [field, previous, next, fromPhase] of movementKindCases()) {
      const { rows } = await client.query(
        "select public.brain_movement_kind($1, $2, $3, $4) as kind",
        [field, previous, next, fromPhase],
      );
      const expected = movementKind(field, previous, next, fromPhase);
      parityChecked += 1;
      if (rows[0].kind !== expected) {
        failures.push(
          `brain_movement_kind(${field}, ${previous}, ${next}, ${fromPhase}): SQL ${rows[0].kind}, TypeScript ${expected}`,
        );
      } else passed += 1;
    }
    console.log(
      `\nBevægelsestype: ${parityChecked} kombinationer sammenlignet (SQL og TypeScript).`,
    );

    // MFA: every table with RLS carries the restrictive policy, and a user with a
    // verified factor reads nothing with an aal1 session, directly or through the fund helpers.
    const unguarded = await client.query(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
          and not exists (
            select 1 from pg_policy p
             where p.polrelid = c.oid and p.polname = 'mfa_required' and not p.polpermissive
          )`,
    );
    if (unguarded.rowCount === 0) passed += 1;
    else
      failures.push(
        `Tabeller med RLS uden policyen mfa_required: ${unguarded.rows.map((r) => r.relname).join(", ")}`,
      );

    const mfaRead = async (aal, withFactor) => {
      await client.query("savepoint rls_mfa");
      try {
        if (withFactor) {
          await client.query(
            "insert into auth.mfa_factors (user_id, factor_type, status) values ($1, 'totp', 'verified')",
            [USERS.admin],
          );
        }
        await client.query("set local role authenticated");
        // As runCheck: the image's auth.uid() reads the subject from its own setting.
        await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USERS.admin]);
        await client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: USERS.admin, role: "authenticated", aal }),
        ]);
        const funds = await client.query("select id from public.funds where id = $1", [FUND_A]);
        const cases = await client.query("select id from public.cases where fund_id = $1", [
          FUND_A,
        ]);
        // PostgREST's pre-request check (0095), which also covers security definer functions.
        let preRequest = true;
        await client.query("savepoint rls_mfa_pre");
        try {
          await client.query("select public.mfa_pre_request()");
        } catch (cause) {
          if (cause.code !== "PT401") throw cause;
          preRequest = false;
        } finally {
          await client.query("rollback to savepoint rls_mfa_pre");
        }
        const reads = [funds.rowCount > 0, cases.rowCount > 0, preRequest];
        // All three agree, or the outcome is mixed (a broken check).
        return reads.every(Boolean) ? true : reads.some(Boolean) ? "mixed" : false;
      } finally {
        await client.query("rollback to savepoint rls_mfa");
      }
    };
    const preRequestSet = await client.query(
      `select exists (
         select 1 from pg_roles r, unnest(r.rolconfig) as setting
          where r.rolname = 'authenticator'
            and setting = 'pgrst.db_pre_request=public.mfa_pre_request'
       ) as set,
       exists (
         select 1 from pg_policy p
          where p.polrelid = 'storage.objects'::regclass and p.polname = 'mfa_required'
            and not p.polpermissive
       ) as storage`,
    );
    if (preRequestSet.rows[0].set && preRequestSet.rows[0].storage) passed += 1;
    else
      failures.push(
        "MFA: pgrst.db_pre_request på authenticator eller mfa_required på storage.objects mangler.",
      );

    const mfaCases = [
      { name: "uden faktor, aal1", aal: "aal1", withFactor: false, expect: true },
      { name: "med faktor, aal1", aal: "aal1", withFactor: true, expect: false },
      { name: "med faktor, aal2", aal: "aal2", withFactor: true, expect: true },
    ];
    for (const mfa of mfaCases) {
      const allowed = await mfaRead(mfa.aal, mfa.withFactor);
      console.log(
        `MFA ${mfa.name}: ${allowed === "mixed" ? "blandet" : allowed ? "læser" : "afvist"} ${allowed === mfa.expect ? "✓" : "!"}`,
      );
      if (allowed === mfa.expect) passed += 1;
      else
        failures.push(
          `MFA ${mfa.name}: forventede ${mfa.expect ? "adgang" : "afvist"}, fik ${allowed === "mixed" ? "blandet (tjekket er i stykker)" : allowed ? "adgang" : "afvist"}.`,
        );
    }

    // A listing of the deck bucket must not fail on a folder that is no fund id (the demo
    // snapshot's copies live in "_demo-snapshot/…"), and still shows only the member's own team.
    await client.query("savepoint rls_storage");
    try {
      await client.query(
        `insert into storage.objects (bucket_id, name) values
           ('pitch-decks', $1 || '/own.pdf'), ('pitch-decks', $2 || '/other.pdf'),
           ('pitch-decks', '_demo-snapshot/1/copy.pdf'), ('pitch-decks', 'loose.pdf')`,
        [FUND_A, FUND_B],
      );
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USERS.admin]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.admin, role: "authenticated", aal: "aal1" }),
      ]);
      const listed = await client.query(
        "select name from storage.objects where bucket_id = 'pitch-decks' order by name",
      );
      const names = listed.rows.map((row) => row.name);
      const ok = names.length === 1 && names[0] === `${FUND_A}/own.pdf`;
      console.log(`Deck-lageret: liste med fremmede mapper fejler ikke ${ok ? "✓" : "!"}`);
      if (ok) passed += 1;
      else failures.push(`Deck-lageret: forventede kun egen fil, fik ${JSON.stringify(names)}.`);
    } catch (cause) {
      failures.push(`Deck-lageret: listen fejlede (${cause.message}).`);
    } finally {
      await client.query("rollback to savepoint rls_storage");
    }
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }

  console.log(`\n${passed} udfald som forventet, ${failures.length} afvigelser.`);
  if (failures.length) {
    for (const failure of failures) console.error(`FEJL: ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
