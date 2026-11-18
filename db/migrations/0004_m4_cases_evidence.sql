-- PAP Intelligence - cases, entities, documents, evidence and fund-specific analyses.
-- Run after 0003_m3_fund_editor.sql.

begin;

create type public.intake_source as enum ('manual', 'pitch_deck', 'scanner');
create type public.company_stage as enum ('pre_seed', 'seed', 'series_a', 'series_b', 'later', 'unknown');
create type public.analysis_execution_status as enum (
  'queued', 'collecting_evidence', 'screening_in_progress', 'screening_complete',
  'awaiting_approval', 'deep_analysis_in_progress', 'quality_audit',
  'needs_information', 'complete', 'failed', 'cancelled'
);
create type public.investment_process_stage as enum (
  'new_case', 'initial_screening', 'preliminary_analysis', 'partner_review',
  'ready_for_contact', 'contacted', 'first_meeting', 'further_evaluation',
  'due_diligence', 'investment_memo', 'investment_committee', 'invested',
  'closed_without_investment'
);
create type public.pap_recommendation as enum ('go_forward', 'follow', 'reject', 'outside_thesis_interesting');
create type public.evidence_status as enum ('verified', 'corroborated', 'company_stated', 'contradictory', 'unknown');
create type public.document_status as enum ('uploaded', 'extracting', 'ready', 'failed');
create type public.analysis_kind as enum ('screening', 'deep');
create type public.analysis_run_status as enum ('queued', 'running', 'awaiting_approval', 'complete', 'failed', 'cancelled');
create type public.risk_level as enum ('low', 'medium', 'high', 'critical');
create type public.finding_nature as enum ('fact', 'company_claim', 'calculation', 'judgement');
create type public.finding_origin as enum ('model', 'deterministic');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  name text not null,
  website text,
  domain text,
  legal_name text,
  description text,
  stage public.company_stage not null default 'unknown',
  sector text,
  geography text,
  founded_year integer check (founded_year is null or founded_year between 1800 and 2200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (fund_id, domain)
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  full_name text not null,
  linkedin_url text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_people (
  fund_id uuid not null references public.funds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role_title text not null default 'Founder',
  is_founder boolean not null default true,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, person_id)
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary_origin public.intake_source not null,
  execution_status public.analysis_execution_status not null default 'queued',
  pap_recommendation public.pap_recommendation,
  process_stage public.investment_process_stage not null default 'new_case',
  source_note text not null default '',
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, company_id)
);

create table public.case_origins (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  source public.intake_source not null,
  is_primary boolean not null default false,
  source_reference text,
  received_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (case_id, source, source_reference)
);

create unique index case_origin_one_primary_idx on public.case_origins(case_id) where is_primary;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('pitch_deck', 'financials', 'memo', 'other')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  status public.document_status not null default 'uploaded',
  content_hash text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pitch_decks (
  document_id uuid primary key references public.documents(id) on delete cascade,
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  page_count integer check (page_count is null or page_count > 0),
  extraction_error text,
  extracted_at timestamptz
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  url text,
  title text not null,
  source_type text not null,
  content_hash text,
  source_date date,
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  claim text not null,
  value_text text,
  slide_ref integer check (slide_ref is null or slide_ref > 0),
  observation_date date,
  period_start date,
  period_end date,
  source_date date,
  collected_at timestamptz not null default now(),
  stated_by text,
  excerpt text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  status public.evidence_status not null default 'unknown',
  created_by uuid references auth.users(id) on delete set null,
  check (source_id is not null or document_id is not null or created_by is not null),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  config_version_id uuid not null references public.fund_config_versions(id) on delete restrict,
  previous_run_id uuid references public.analysis_runs(id) on delete set null,
  kind public.analysis_kind not null,
  status public.analysis_run_status not null default 'queued',
  workflow_version text not null,
  prompt_template_name text not null,
  prompt_template_version text not null,
  model_provider text,
  model_name text,
  raw_response jsonb,
  validation_result jsonb,
  input_evidence_ids uuid[] not null default '{}',
  token_usage integer check (token_usage is null or token_usage >= 0),
  estimated_cost numeric check (estimated_cost is null or estimated_cost >= 0),
  error_message text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index analysis_runs_case_profile_idx on public.analysis_runs(case_id, config_version_id, created_at desc);

create table public.category_scores (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  category text not null,
  proposed_score numeric check (proposed_score is null or proposed_score between 0 and 100),
  validated_score numeric check (validated_score is null or validated_score between 0 and 100),
  weight numeric not null check (weight > 0 and weight <= 100),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  rationale text not null,
  unique (run_id, category)
);

create table public.analysis_findings (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  category text not null,
  finding_type text not null,
  statement text not null,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  nature public.finding_nature not null,
  origin public.finding_origin not null,
  relevant_date date,
  created_at timestamptz not null default now()
);

create table public.analysis_finding_evidence (
  fund_id uuid not null references public.funds(id) on delete cascade,
  finding_id uuid not null references public.analysis_findings(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete cascade,
  supports boolean not null,
  primary key (finding_id, evidence_id)
);

create table public.risks (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  category text not null,
  level public.risk_level not null,
  statement text not null,
  mitigation text,
  evidence_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  recommendation public.pap_recommendation not null,
  overall_score numeric check (overall_score is null or overall_score between 0 and 100),
  evidence_confidence numeric check (evidence_confidence is null or evidence_confidence between 0 and 1),
  has_failed_gate boolean not null default false,
  has_critical_risk boolean not null default false,
  rationale text not null,
  created_at timestamptz not null default now(),
  unique (run_id)
);

create table public.financial_data_points (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  metric text not null,
  value numeric not null,
  unit text not null,
  period_start date,
  period_end date,
  evidence_id uuid not null references public.evidence_items(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.calculation_results (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  metric text not null,
  status text not null check (status in ('ok', 'kan_ikke_beregnes')),
  value numeric,
  unit text,
  formula_version text not null,
  input_ids uuid[] not null default '{}',
  missing_inputs text[] not null default '{}',
  warnings text[] not null default '{}',
  unique (run_id, metric)
);

create table public.case_transition_events (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  field text not null check (field in ('execution_status', 'pap_recommendation', 'process_stage', 'mandate_gate_override')),
  actor_type public.audit_actor_type not null,
  actor_id uuid,
  previous_value text,
  new_value text not null,
  reason text,
  evidence_ids uuid[] not null default '{}',
  analysis_run_id uuid references public.analysis_runs(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index companies_fund_name_idx on public.companies(fund_id, name);
create index cases_fund_updated_idx on public.cases(fund_id, updated_at desc);
create index documents_case_idx on public.documents(case_id, created_at desc);
create index evidence_case_idx on public.evidence_items(case_id, collected_at desc);

-- All business data is visible only inside the selected fund.
grant select, insert, update on public.companies, public.people, public.company_people,
  public.cases, public.case_origins, public.documents, public.pitch_decks,
  public.sources, public.evidence_items, public.financial_data_points to authenticated;
grant select on public.analysis_runs, public.category_scores, public.analysis_findings,
  public.analysis_finding_evidence, public.risks, public.recommendations,
  public.calculation_results, public.case_transition_events to authenticated;
grant all on public.companies, public.people, public.company_people, public.cases,
  public.case_origins, public.documents, public.pitch_decks, public.sources,
  public.evidence_items, public.analysis_runs, public.category_scores,
  public.analysis_findings, public.analysis_finding_evidence, public.risks,
  public.recommendations, public.financial_data_points, public.calculation_results,
  public.case_transition_events to service_role;

alter table public.companies enable row level security;
alter table public.people enable row level security;
alter table public.company_people enable row level security;
alter table public.cases enable row level security;
alter table public.case_origins enable row level security;
alter table public.documents enable row level security;
alter table public.pitch_decks enable row level security;
alter table public.sources enable row level security;
alter table public.evidence_items enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.category_scores enable row level security;
alter table public.analysis_findings enable row level security;
alter table public.analysis_finding_evidence enable row level security;
alter table public.risks enable row level security;
alter table public.recommendations enable row level security;
alter table public.financial_data_points enable row level security;
alter table public.calculation_results enable row level security;
alter table public.case_transition_events enable row level security;

-- Reusable fund-scoped policies. Tables with human intake permit analyst, partner or administrator writes.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies','people','company_people','cases','case_origins','documents','pitch_decks',
    'sources','evidence_items','financial_data_points'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_fund_member(auth.uid(), fund_id))', table_name || '_select_member', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_fund_member(auth.uid(), fund_id) and (public.has_fund_role(auth.uid(), fund_id, ''analyst'') or public.has_fund_role(auth.uid(), fund_id, ''partner'') or public.has_fund_role(auth.uid(), fund_id, ''administrator'')))', table_name || '_insert_team', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_fund_member(auth.uid(), fund_id)) with check (public.is_fund_member(auth.uid(), fund_id) and (public.has_fund_role(auth.uid(), fund_id, ''analyst'') or public.has_fund_role(auth.uid(), fund_id, ''partner'') or public.has_fund_role(auth.uid(), fund_id, ''administrator'')))', table_name || '_update_team', table_name);
  end loop;

  foreach table_name in array array[
    'analysis_runs','category_scores','analysis_findings','analysis_finding_evidence',
    'risks','recommendations','calculation_results','case_transition_events'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_fund_member(auth.uid(), fund_id))', table_name || '_select_member', table_name);
  end loop;
end $$;

-- Private deck storage. Paths are always fund_id/case_id/random.pdf.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pitch-decks', 'pitch-decks', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "pitch_decks_storage_select_member" on storage.objects
for select to authenticated
using (
  bucket_id = 'pitch-decks'
  and public.is_fund_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

create policy "pitch_decks_storage_insert_team" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pitch-decks'
  and (storage.extension(name)) = 'pdf'
  and public.is_fund_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  and (
    public.has_fund_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'analyst')
    or public.has_fund_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'partner')
    or public.has_fund_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'administrator')
  )
);

create or replace function public.create_manual_case(
  _profile_key text,
  _company_name text,
  _website text,
  _stage public.company_stage,
  _sector text,
  _geography text,
  _source_note text,
  _founders jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_company_id uuid;
  v_case_id uuid;
  v_domain text;
  founder jsonb;
  v_person_id uuid;
begin
  select fund_id into v_fund_id
  from public.fund_config_versions
  where profile_key = _profile_key and status = 'active'::public.fund_config_status;

  if v_fund_id is null or not public.is_fund_member(auth.uid(), v_fund_id) then
    raise exception 'Den valgte fondsprofil er ikke tilgængelig.';
  end if;
  if not (
    public.has_fund_role(auth.uid(), v_fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), v_fund_id, 'partner')
    or public.has_fund_role(auth.uid(), v_fund_id, 'administrator')
  ) then raise exception 'Din rolle kan ikke oprette cases.'; end if;
  if nullif(trim(_company_name), '') is null then raise exception 'Selskabsnavn mangler.'; end if;

  v_domain := nullif(lower(regexp_replace(coalesce(_website, ''), '^https?://(www\.)?|/.*$', '', 'g')), '');

  if v_domain is not null then
    select id into v_company_id from public.companies
    where fund_id = v_fund_id and domain = v_domain limit 1;
  end if;

  if v_company_id is null then
    insert into public.companies
      (fund_id, name, website, domain, stage, sector, geography)
    values
      (v_fund_id, trim(_company_name), nullif(trim(_website), ''), v_domain,
       coalesce(_stage, 'unknown'), nullif(trim(_sector), ''), nullif(trim(_geography), ''))
    returning id into v_company_id;
  end if;

  select id into v_case_id from public.cases
  where fund_id = v_fund_id and company_id = v_company_id limit 1;

  if v_case_id is null then
    insert into public.cases
      (fund_id, company_id, primary_origin, source_note, created_by)
    values (v_fund_id, v_company_id, 'manual', coalesce(_source_note, ''), auth.uid())
    returning id into v_case_id;
  end if;

  insert into public.case_origins
    (fund_id, case_id, source, is_primary, source_reference, created_by)
  values (v_fund_id, v_case_id, 'manual', true, nullif(trim(_source_note), ''), auth.uid())
  on conflict do nothing;

  if jsonb_typeof(coalesce(_founders, '[]'::jsonb)) = 'array' then
    for founder in select value from jsonb_array_elements(coalesce(_founders, '[]'::jsonb)) loop
      if nullif(trim(founder->>'name'), '') is not null then
        insert into public.people (fund_id, full_name, linkedin_url)
        values (v_fund_id, trim(founder->>'name'), nullif(trim(founder->>'linkedinUrl'), ''))
        returning id into v_person_id;
        insert into public.company_people (fund_id, company_id, person_id, role_title, is_founder)
        values (v_fund_id, v_company_id, v_person_id, coalesce(nullif(trim(founder->>'role'), ''), 'Founder'), true);
      end if;
    end loop;
  end if;

  insert into public.case_transition_events
    (fund_id, case_id, field, actor_type, actor_id, previous_value, new_value, reason)
  values (v_fund_id, v_case_id, 'process_stage', 'user', auth.uid(), null, 'new_case', 'Manuel case oprettet');

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'case_created', 'cases', v_case_id,
    jsonb_build_object('source', 'manual', 'company_id', v_company_id));
  return v_case_id;
end;
$$;

create or replace function public.register_pitch_deck(
  _case_id uuid,
  _file_name text,
  _storage_path text,
  _mime_type text,
  _size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_document_id uuid;
begin
  select fund_id into v_fund_id from public.cases where id = _case_id;
  if v_fund_id is null or not public.is_fund_member(auth.uid(), v_fund_id) then
    raise exception 'Casen blev ikke fundet.';
  end if;
  if split_part(_storage_path, '/', 1) <> v_fund_id::text
     or split_part(_storage_path, '/', 2) <> _case_id::text
     or lower(right(_storage_path, 4)) <> '.pdf' then
    raise exception 'Ugyldig filsti.';
  end if;
  if _mime_type <> 'application/pdf' or _size_bytes <= 0 or _size_bytes > 52428800 then
    raise exception 'Kun PDF-filer op til 50 MB accepteres.';
  end if;

  insert into public.documents
    (fund_id, case_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values
    (v_fund_id, _case_id, 'pitch_deck', trim(_file_name), _storage_path, _mime_type, _size_bytes, auth.uid())
  returning id into v_document_id;
  insert into public.pitch_decks (document_id, fund_id, case_id)
  values (v_document_id, v_fund_id, _case_id);
  insert into public.case_origins (fund_id, case_id, source, is_primary, source_reference, created_by)
  values (v_fund_id, _case_id, 'pitch_deck', false, v_document_id::text, auth.uid())
  on conflict do nothing;
  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'pitch_deck_uploaded', 'documents', v_document_id,
    jsonb_build_object('case_id', _case_id, 'file_name', trim(_file_name)));
  return v_document_id;
end;
$$;

revoke all on function public.create_manual_case(text, text, text, public.company_stage, text, text, text, jsonb) from public, anon;
grant execute on function public.create_manual_case(text, text, text, public.company_stage, text, text, text, jsonb) to authenticated, service_role;
revoke all on function public.register_pitch_deck(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.register_pitch_deck(uuid, text, text, text, bigint) to authenticated, service_role;

commit;
