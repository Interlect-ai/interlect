-- Per-fund overrides for specialist-module prompt text (mandate,
-- evidence_tests, risk_areas). Piggybacks entirely on the existing
-- fund_config_versions draft/publish lifecycle: a new draft deep-copies its
-- overrides just like gates/criteria already do, publishing needs no new
-- logic (child-table rows survive activation via the FK alone), and old
-- analysis_runs stay correctly attributed forever, same guarantee as the
-- mandate itself. Screening has no per-category prompt structure to
-- override -- this only ever affects the 4 deep-analysis specialist modules.

begin;

create table public.prompt_module_overrides (
  id uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.fund_config_versions(id) on delete cascade,
  module_id text not null
    check (module_id in ('people_team', 'product_market_gtm', 'technology_risk', 'fund_finance_deal')),
  mandate text[] not null,
  evidence_tests text[] not null,
  risk_areas text[] not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (config_version_id, module_id)
);

grant select, insert, update, delete on public.prompt_module_overrides to authenticated;
grant all on public.prompt_module_overrides to service_role;

alter table public.prompt_module_overrides enable row level security;

create policy "prompt_module_overrides_select_member" on public.prompt_module_overrides
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

-- Immutability after publish is an RLS property in this codebase (mirrors
-- mandate_gates/assessment_criteria), not something the parent's status
-- trigger gives for free to a new child table.
create policy "prompt_module_overrides_write_admin_draft" on public.prompt_module_overrides
for all to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
)
with check (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
);

-- Redefines create_fund_config_draft (originally 0008) to also deep-copy
-- prompt_module_overrides, identical in shape to the other four child-table
-- copy blocks it already has. activate_fund_config needs no changes: it
-- never touches child tables at publish time, only flips two status
-- columns on fund_config_versions itself.
create or replace function public.create_fund_config_draft(_source_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.fund_config_versions%rowtype;
  v_new_id uuid;
  v_next_version integer;
begin
  select * into v_source
  from public.fund_config_versions
  where id = _source_config_id and status = 'active'::public.fund_config_status;

  if v_source.id is null then raise exception 'Den aktive fondsprofil blev ikke fundet.'; end if;
  if not public.has_fund_role(auth.uid(), v_source.fund_id, 'administrator') then
    raise exception 'Kun en administrator kan redigere fondsopsætningen.';
  end if;

  select id into v_new_id
  from public.fund_config_versions
  where fund_id = v_source.fund_id and status = 'draft'::public.fund_config_status
  order by version desc limit 1;
  if v_new_id is not null then return v_new_id; end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.fund_config_versions where fund_id = v_source.fund_id;

  insert into public.fund_config_versions
    (fund_id, version, profile_key, status, source_basis, researched_at, created_by)
  values
    (v_source.fund_id, v_next_version, v_source.profile_key, 'draft',
     'administrator_configuration', current_date, auth.uid())
  returning id into v_new_id;

  insert into public.fund_mandates
    (config_version_id, thesis, stages, geographies, sectors, ticket_min_eur,
     ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
     strategy_type, stage_expectations, dealbreakers)
  select v_new_id, thesis, stages, geographies, sectors, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    strategy_type, stage_expectations, dealbreakers
  from public.fund_mandates where config_version_id = v_source.id;

  insert into public.mandate_gates
    (config_version_id, gate_key, label, description, treatment, sort_order)
  select v_new_id, gate_key, label, description, treatment, sort_order
  from public.mandate_gates where config_version_id = v_source.id;

  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order)
  select v_new_id, criterion_key, label, description, score_category, weight, sort_order
  from public.assessment_criteria where config_version_id = v_source.id;

  insert into public.fund_profile_sources
    (config_version_id, label, url, supports, source_type, collected_at)
  select v_new_id, label, url, supports, source_type, collected_at
  from public.fund_profile_sources where config_version_id = v_source.id;

  insert into public.prompt_module_overrides
    (config_version_id, module_id, mandate, evidence_tests, risk_areas, updated_by)
  select v_new_id, module_id, mandate, evidence_tests, risk_areas, auth.uid()
  from public.prompt_module_overrides where config_version_id = v_source.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_draft_created',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'version', v_next_version));
  return v_new_id;
end;
$$;

commit;
