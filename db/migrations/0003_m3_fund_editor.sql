-- PAP Intelligence — redigerbar, versionsstyret fondsopsætning.
-- Kør efter 0002_m3_fund_profiles.sql.

begin;

alter table public.fund_mandates
  add column stage_expectations jsonb not null default '{}'::jsonb,
  add column dealbreakers text[] not null default '{}'::text[];

create table public.historical_investments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  company_name text not null,
  website text,
  invested_at date,
  stage text,
  sector text,
  geography text,
  note text not null default '',
  diagnostic_only boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, company_name)
);

grant select, insert, update, delete on public.historical_investments to authenticated;
grant all on public.historical_investments to service_role;
alter table public.historical_investments enable row level security;

create policy "historical_investments_select_member" on public.historical_investments
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

create policy "historical_investments_write_admin" on public.historical_investments
for all to authenticated
using (public.has_fund_role(auth.uid(), fund_id, 'administrator'))
with check (public.has_fund_role(auth.uid(), fund_id, 'administrator'));

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

  if v_source.id is null then
    raise exception 'Den aktive fondsprofil blev ikke fundet.';
  end if;
  if not public.has_fund_role(auth.uid(), v_source.fund_id, 'administrator') then
    raise exception 'Kun en administrator kan redigere fondsopsætningen.';
  end if;

  select id into v_new_id
  from public.fund_config_versions
  where fund_id = v_source.fund_id and status = 'draft'::public.fund_config_status
  order by version desc
  limit 1;
  if v_new_id is not null then
    return v_new_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.fund_config_versions
  where fund_id = v_source.fund_id;

  insert into public.fund_config_versions
    (fund_id, version, profile_key, status, source_basis, researched_at, created_by)
  values
    (v_source.fund_id, v_next_version, v_source.profile_key, 'draft',
     'administrator_configuration', current_date, auth.uid())
  returning id into v_new_id;

  insert into public.fund_mandates
    (config_version_id, thesis, stages, geographies, sectors, ticket_min_eur,
     ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
     stage_expectations, dealbreakers)
  select v_new_id, thesis, stages, geographies, sectors, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    stage_expectations, dealbreakers
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

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_draft_created',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'version', v_next_version));

  return v_new_id;
end;
$$;

create or replace function public.save_fund_config_draft(
  _config_version_id uuid,
  _fund_name text,
  _thesis text,
  _stages text[],
  _geographies text[],
  _sectors text[],
  _ticket_min_eur numeric,
  _ticket_max_eur numeric,
  _ticket_note text,
  _analysis_threshold numeric,
  _approval_mode public.fund_approval_mode,
  _risk_posture text,
  _stage_expectations jsonb,
  _dealbreakers text[],
  _gates jsonb,
  _criteria jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_weight numeric;
begin
  select fund_id into v_fund_id
  from public.fund_config_versions
  where id = _config_version_id and status = 'draft'::public.fund_config_status;

  if v_fund_id is null then raise exception 'Kladdeversionen blev ikke fundet.'; end if;
  if not public.has_fund_role(auth.uid(), v_fund_id, 'administrator') then
    raise exception 'Kun en administrator kan redigere fondsopsætningen.';
  end if;
  if nullif(trim(_fund_name), '') is null then raise exception 'Fondsnavn mangler.'; end if;
  if nullif(trim(_thesis), '') is null then raise exception 'Tesen mangler.'; end if;
  if cardinality(_stages) = 0 then raise exception 'Vælg mindst ét stadie.'; end if;
  if cardinality(_geographies) = 0 then raise exception 'Vælg mindst én geografi.'; end if;
  if cardinality(_sectors) = 0 then raise exception 'Vælg mindst én sektor.'; end if;
  if _analysis_threshold < 0 or _analysis_threshold > 100 then raise exception 'Ugyldig analysetærskel.'; end if;
  if _ticket_min_eur is not null and _ticket_min_eur < 0 then raise exception 'Ugyldig minimumsinvestering.'; end if;
  if _ticket_max_eur is not null and _ticket_max_eur < coalesce(_ticket_min_eur, 0) then
    raise exception 'Maksimumsinvestering skal være større end minimum.';
  end if;
  if jsonb_typeof(_gates) <> 'array' or jsonb_array_length(_gates) = 0 then
    raise exception 'Tilføj mindst én mandatkontrol.';
  end if;
  if jsonb_typeof(_criteria) <> 'array' or jsonb_array_length(_criteria) = 0 then
    raise exception 'Tilføj mindst ét scoringskriterium.';
  end if;

  select coalesce(sum((item->>'weight')::numeric), 0) into v_weight
  from jsonb_array_elements(_criteria) item;
  if v_weight <> 100 then
    raise exception 'Kriterievægtene skal summe til 100, men summerer til %.', v_weight;
  end if;

  update public.funds set name = trim(_fund_name), updated_at = now() where id = v_fund_id;

  update public.fund_mandates set
    thesis = trim(_thesis), stages = _stages, geographies = _geographies,
    sectors = _sectors, ticket_min_eur = _ticket_min_eur,
    ticket_max_eur = _ticket_max_eur, ticket_note = coalesce(_ticket_note, ''),
    analysis_threshold = _analysis_threshold, approval_mode = _approval_mode,
    risk_posture = trim(_risk_posture), stage_expectations = coalesce(_stage_expectations, '{}'::jsonb),
    dealbreakers = coalesce(_dealbreakers, '{}'::text[])
  where config_version_id = _config_version_id;

  delete from public.mandate_gates where config_version_id = _config_version_id;
  insert into public.mandate_gates
    (config_version_id, gate_key, label, description, treatment, sort_order)
  select _config_version_id, item->>'key', item->>'label', item->>'description',
    (item->>'treatment')::public.gate_treatment, ordinal::integer
  from jsonb_array_elements(_gates) with ordinality as rows(item, ordinal);

  delete from public.assessment_criteria where config_version_id = _config_version_id;
  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order)
  select _config_version_id, item->>'key', item->>'label', item->>'description',
    item->>'category', (item->>'weight')::numeric, ordinal::integer
  from jsonb_array_elements(_criteria) with ordinality as rows(item, ordinal);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'fund_config_draft_saved',
    'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'threshold', _analysis_threshold));
end;
$$;

revoke all on function public.create_fund_config_draft(uuid) from public, anon;
grant execute on function public.create_fund_config_draft(uuid) to authenticated, service_role;

revoke all on function public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, jsonb, text[], jsonb, jsonb
) from public, anon;
grant execute on function public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, jsonb, text[], jsonb, jsonb
) to authenticated, service_role;

commit;
