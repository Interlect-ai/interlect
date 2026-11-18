-- Per-fund overrides for the public-research module questions (the 13 fixed
-- Perplexity research modules in src/lib/analysis/public-research.ts: 5
-- screening + 8 deep). Mirrors prompt_module_overrides (0012) exactly --
-- same draft/publish lifecycle, same deep-copy-on-new-draft behaviour, same
-- RLS shape -- because it is the same kind of thing: admin-authored,
-- AI-proposed, human-reviewed text that gets swapped into a real prompt
-- before it is sent, never regenerated per case.

begin;

create table public.research_module_overrides (
  id uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.fund_config_versions(id) on delete cascade,
  mode text not null check (mode in ('screening', 'deep')),
  module_id text not null
    check (module_id in (
      -- deep (8)
      'identity_registry', 'filings_financials', 'founders_team', 'funding_ownership',
      'product_technology', 'traction_customers_gtm', 'market_competition',
      'legal_regulatory_reputation',
      -- screening (5)
      'screening_identity_filings', 'screening_founders_funding',
      'screening_product_technology', 'screening_traction_commercial',
      'screening_market_mandate'
    )),
  questions text[] not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (config_version_id, mode, module_id)
);

grant select, insert, update, delete on public.research_module_overrides to authenticated;
grant all on public.research_module_overrides to service_role;

alter table public.research_module_overrides enable row level security;

create policy "research_module_overrides_select_member" on public.research_module_overrides
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

create policy "research_module_overrides_write_admin_draft" on public.research_module_overrides
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

-- Redefines create_fund_config_draft (0008, last touched by 0012) to also
-- deep-copy research_module_overrides -- otherwise a fond's carefully
-- generated research strategy would silently reset to the default questions
-- every time an admin opens a new draft to make an unrelated edit.
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

  insert into public.research_module_overrides
    (config_version_id, mode, module_id, questions, updated_by)
  select v_new_id, mode, module_id, questions, auth.uid()
  from public.research_module_overrides where config_version_id = v_source.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_draft_created',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'version', v_next_version));
  return v_new_id;
end;
$$;

commit;
