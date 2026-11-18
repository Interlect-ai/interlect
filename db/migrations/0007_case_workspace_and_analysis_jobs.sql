-- Interlect.ai - fund-owned case workspace, durable analysis jobs and inbound mail foundation.
-- Run after 0006_m4_multiformat_intake.sql.

begin;

create type public.case_workspace_status as enum (
  'screening',
  'deep_analysis',
  'on_hold',
  'archived'
);

create type public.analysis_job_status as enum (
  'queued',
  'running',
  'complete',
  'failed',
  'cancelled'
);

create type public.analysis_step_status as enum (
  'queued',
  'running',
  'complete',
  'failed',
  'skipped'
);

alter table public.cases
  add column workspace_status public.case_workspace_status not null default 'screening',
  add column workspace_reason text,
  add column workspace_changed_at timestamptz not null default now(),
  add column deep_analysis_requested_at timestamptz,
  add column archived_at timestamptz;

update public.cases c
set workspace_status = 'deep_analysis',
    workspace_reason = 'Eksisterende grundig analyse',
    workspace_changed_at = coalesce(
      (
        select coalesce(ar.completed_at, ar.created_at)
        from public.analysis_runs ar
        where ar.case_id = c.id
          and ar.fund_id = c.fund_id
          and ar.kind = 'deep'
          and ar.status in ('queued', 'running', 'complete')
        order by ar.created_at desc
        limit 1
      ),
      c.updated_at
    )
where exists (
  select 1
  from public.analysis_runs ar
  where ar.case_id = c.id
    and ar.fund_id = c.fund_id
    and ar.kind = 'deep'
    and ar.status in ('queued', 'running', 'complete')
);

create index cases_fund_workspace_updated_idx
  on public.cases(fund_id, workspace_status, updated_at desc);

alter table public.risks
  add column likelihood smallint check (likelihood is null or likelihood between 1 and 5),
  add column impact smallint check (impact is null or impact between 1 and 5),
  add column status text not null default 'open'
    check (status in ('open', 'mitigated', 'accepted'));

alter table public.analysis_runs
  add column idempotency_key text,
  add column input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column output_tokens integer check (output_tokens is null or output_tokens >= 0),
  add column actual_cost numeric check (actual_cost is null or actual_cost >= 0);

create unique index analysis_runs_fund_idempotency_idx
  on public.analysis_runs(fund_id, idempotency_key)
  where idempotency_key is not null;

create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  run_id uuid not null unique references public.analysis_runs(id) on delete cascade,
  kind public.analysis_kind not null,
  status public.analysis_job_status not null default 'queued',
  idempotency_key text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (fund_id, idempotency_key)
);

create index analysis_jobs_ready_idx
  on public.analysis_jobs(status, available_at, created_at)
  where status in ('queued', 'failed');

create table public.analysis_run_steps (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  step_key text not null,
  step_order smallint not null check (step_order > 0),
  status public.analysis_step_status not null default 'queued',
  model_name text,
  prompt_version text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  actual_cost numeric check (actual_cost is null or actual_cost >= 0),
  output_json jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, step_key)
);

create index analysis_run_steps_run_order_idx
  on public.analysis_run_steps(run_id, step_order);

-- One dedicated pitch address can be connected to each fund. The provider webhook
-- is added later; the raw address is never used as authorization.
create table public.fund_inbound_addresses (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null unique references public.funds(id) on delete cascade,
  local_part text not null unique check (local_part ~ '^[a-z0-9][a-z0-9._-]{2,62}$'),
  domain text not null,
  provider text,
  provider_route_id text,
  signing_secret_hash text,
  is_active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  provider_message_id text not null,
  sender_email text not null,
  recipient_email text not null,
  subject text not null default '',
  text_body text not null default '',
  attachment_manifest jsonb not null default '[]'::jsonb,
  status text not null default 'received'
    check (status in ('received', 'processing', 'case_created', 'duplicate', 'failed', 'ignored')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (fund_id, provider_message_id)
);

create index inbound_messages_fund_status_idx
  on public.inbound_messages(fund_id, status, received_at desc);

alter table public.analysis_jobs enable row level security;
alter table public.analysis_run_steps enable row level security;
alter table public.fund_inbound_addresses enable row level security;
alter table public.inbound_messages enable row level security;

create policy "analysis_jobs_select_member" on public.analysis_jobs
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

create policy "analysis_run_steps_select_member" on public.analysis_run_steps
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

create policy "fund_inbound_addresses_select_member" on public.fund_inbound_addresses
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

create policy "fund_inbound_addresses_admin_write" on public.fund_inbound_addresses
for all to authenticated
using (public.has_fund_role(auth.uid(), fund_id, 'administrator'))
with check (public.has_fund_role(auth.uid(), fund_id, 'administrator'));

create policy "inbound_messages_select_member" on public.inbound_messages
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

grant select on public.analysis_jobs, public.analysis_run_steps, public.inbound_messages
  to authenticated;
grant select, insert, update, delete on public.fund_inbound_addresses to authenticated;
grant all on public.analysis_jobs, public.analysis_run_steps,
  public.fund_inbound_addresses, public.inbound_messages to service_role;

alter table public.case_transition_events
  drop constraint if exists case_transition_events_field_check;
alter table public.case_transition_events
  add constraint case_transition_events_field_check
  check (field in (
    'execution_status', 'pap_recommendation', 'process_stage',
    'mandate_gate_override', 'workspace_status'
  ));

create or replace function public.create_manual_case_for_fund(
  _fund_id uuid,
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
  v_company_id uuid;
  v_case_id uuid;
  v_domain text;
  founder jsonb;
  v_person_id uuid;
  v_has_primary boolean;
begin
  if not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'Den valgte fond er ikke tilgængelig.';
  end if;
  if not (
    public.has_fund_role(auth.uid(), _fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), _fund_id, 'partner')
    or public.has_fund_role(auth.uid(), _fund_id, 'administrator')
  ) then
    raise exception 'Din rolle kan ikke oprette cases.';
  end if;
  if nullif(trim(_company_name), '') is null then
    raise exception 'Selskabsnavn mangler.';
  end if;

  v_domain := nullif(lower(regexp_replace(coalesce(_website, ''), '^https?://(www\.)?|/.*$', '', 'g')), '');

  if v_domain is not null then
    select id into v_company_id
    from public.companies
    where fund_id = _fund_id and domain = v_domain
    limit 1;
  else
    select id into v_company_id
    from public.companies
    where fund_id = _fund_id and lower(name) = lower(trim(_company_name))
    limit 1;
  end if;

  if v_company_id is null then
    insert into public.companies
      (fund_id, name, website, domain, stage, sector, geography)
    values
      (_fund_id, trim(_company_name), nullif(trim(_website), ''), v_domain,
       coalesce(_stage, 'unknown'), nullif(trim(_sector), ''), nullif(trim(_geography), ''))
    returning id into v_company_id;
  end if;

  select id into v_case_id
  from public.cases
  where fund_id = _fund_id and company_id = v_company_id
  limit 1;

  if v_case_id is null then
    insert into public.cases
      (fund_id, company_id, primary_origin, source_note, workspace_status, created_by)
    values
      (_fund_id, v_company_id, 'manual', coalesce(_source_note, ''), 'screening', auth.uid())
    returning id into v_case_id;
  end if;

  select exists(
    select 1
    from public.case_origins
    where fund_id = _fund_id and case_id = v_case_id and is_primary
  ) into v_has_primary;

  insert into public.case_origins
    (fund_id, case_id, source, is_primary, source_reference, created_by)
  values
    (_fund_id, v_case_id, 'manual', not v_has_primary, nullif(trim(_source_note), ''), auth.uid())
  on conflict do nothing;

  if jsonb_typeof(coalesce(_founders, '[]'::jsonb)) = 'array' then
    for founder in select value from jsonb_array_elements(coalesce(_founders, '[]'::jsonb)) loop
      if nullif(trim(founder->>'name'), '') is not null then
        insert into public.people (fund_id, full_name, linkedin_url)
        values (_fund_id, trim(founder->>'name'), nullif(trim(founder->>'linkedinUrl'), ''))
        returning id into v_person_id;
        insert into public.company_people (fund_id, company_id, person_id, role_title, is_founder)
        values (_fund_id, v_company_id, v_person_id,
          coalesce(nullif(trim(founder->>'role'), ''), 'Founder'), true);
      end if;
    end loop;
  end if;

  insert into public.case_transition_events
    (fund_id, case_id, field, actor_type, actor_id, previous_value, new_value, reason)
  values
    (_fund_id, v_case_id, 'workspace_status', 'user', auth.uid(), null, 'screening',
     'Case oprettet i screeningindbakken');

  insert into public.audit_events
    (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values
    (_fund_id, 'user', auth.uid(), 'case_created', 'cases', v_case_id,
     jsonb_build_object('source', 'manual', 'company_id', v_company_id));

  return v_case_id;
end;
$$;

revoke all on function public.create_manual_case_for_fund(
  uuid, text, text, public.company_stage, text, text, text, jsonb
) from public, anon;
grant execute on function public.create_manual_case_for_fund(
  uuid, text, text, public.company_stage, text, text, text, jsonb
) to authenticated, service_role;

-- The old RPC inferred a fund through a public profile key. All clients must now
-- use the explicit, membership-checked fund-owned RPC above.
revoke execute on function public.create_manual_case(
  text, text, text, public.company_stage, text, text, text, jsonb
) from authenticated;

create or replace function public.move_case_workspace(
  _case_id uuid,
  _fund_id uuid,
  _target public.case_workspace_status,
  _reason text default null
)
returns public.case_workspace_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.case_workspace_status;
begin
  select workspace_status into v_previous
  from public.cases
  where id = _case_id and fund_id = _fund_id
  for update;

  if v_previous is null or not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'Casen blev ikke fundet i den valgte fond.';
  end if;

  if _target = 'deep_analysis' then
    if not public.has_fund_role(auth.uid(), _fund_id, 'partner') then
      raise exception 'Kun en partner kan sende en case til dyb analyse.';
    end if;
    if not exists (
      select 1
      from public.analysis_runs ar
      where ar.case_id = _case_id
        and ar.fund_id = _fund_id
        and ar.kind = 'screening'
        and ar.status = 'awaiting_approval'
    ) then
      raise exception 'Casen skal have en afsluttet screening, før den kan sendes til dyb analyse.';
    end if;
  elsif not (
    public.has_fund_role(auth.uid(), _fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), _fund_id, 'partner')
    or public.has_fund_role(auth.uid(), _fund_id, 'administrator')
  ) then
    raise exception 'Din rolle kan ikke flytte casen.';
  end if;

  if v_previous = _target then
    return v_previous;
  end if;

  update public.cases
  set workspace_status = _target,
      workspace_reason = nullif(trim(coalesce(_reason, '')), ''),
      workspace_changed_at = now(),
      deep_analysis_requested_at = case
        when _target = 'deep_analysis' then now()
        else deep_analysis_requested_at
      end,
      archived_at = case when _target = 'archived' then now() else null end,
      updated_at = now()
  where id = _case_id and fund_id = _fund_id;

  insert into public.case_transition_events
    (fund_id, case_id, field, actor_type, actor_id, previous_value, new_value, reason)
  values
    (_fund_id, _case_id, 'workspace_status', 'user', auth.uid(),
     v_previous::text, _target::text, nullif(trim(coalesce(_reason, '')), ''));

  return _target;
end;
$$;

revoke all on function public.move_case_workspace(
  uuid, uuid, public.case_workspace_status, text
) from public, anon;
grant execute on function public.move_case_workspace(
  uuid, uuid, public.case_workspace_status, text
) to authenticated, service_role;

commit;
