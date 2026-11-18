-- Interlect.ai - guided, partially savable fund configuration.
-- Keeps published versions immutable and preserves the existing administrator
-- authorization boundary.

begin;

alter table public.fund_mandates
  add column if not exists strategy_type text not null default 'custom'
  check (strategy_type in ('venture', 'growth', 'thematic', 'custom'));

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

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_draft_created',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'version', v_next_version));
  return v_new_id;
end;
$$;

drop function if exists public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, jsonb, text[], jsonb, jsonb
);

create function public.save_fund_config_draft(
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
  _strategy_type text,
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
  if _analysis_threshold < 0 or _analysis_threshold > 100 then raise exception 'Ugyldig analysetærskel.'; end if;
  if _strategy_type not in ('venture', 'growth', 'thematic', 'custom') then raise exception 'Ugyldig strategitype.'; end if;
  if _ticket_min_eur is not null and _ticket_min_eur < 0 then raise exception 'Ugyldig minimumsinvestering.'; end if;
  if _ticket_max_eur is not null and _ticket_max_eur < coalesce(_ticket_min_eur, 0) then
    raise exception 'Maksimumsinvestering skal være større end minimum.';
  end if;
  if jsonb_typeof(coalesce(_gates, '[]'::jsonb)) <> 'array' then raise exception 'Ugyldige mandatregler.'; end if;
  if jsonb_typeof(coalesce(_criteria, '[]'::jsonb)) <> 'array' then raise exception 'Ugyldige kriterier.'; end if;

  select coalesce(sum((item->>'weight')::numeric), 0) into v_weight
  from jsonb_array_elements(coalesce(_criteria, '[]'::jsonb)) item;

  update public.funds set name = trim(_fund_name), updated_at = now() where id = v_fund_id;
  update public.fund_mandates set
    thesis = trim(coalesce(_thesis, '')), stages = coalesce(_stages, '{}'::text[]),
    geographies = coalesce(_geographies, '{}'::text[]), sectors = coalesce(_sectors, '{}'::text[]),
    ticket_min_eur = _ticket_min_eur, ticket_max_eur = _ticket_max_eur,
    ticket_note = coalesce(_ticket_note, ''), analysis_threshold = _analysis_threshold,
    approval_mode = _approval_mode, risk_posture = trim(coalesce(_risk_posture, '')),
    strategy_type = _strategy_type,
    stage_expectations = coalesce(_stage_expectations, '{}'::jsonb),
    dealbreakers = coalesce(_dealbreakers, '{}'::text[])
  where config_version_id = _config_version_id;

  delete from public.mandate_gates where config_version_id = _config_version_id;
  insert into public.mandate_gates
    (config_version_id, gate_key, label, description, treatment, sort_order)
  select _config_version_id, item->>'key', coalesce(item->>'label', ''),
    coalesce(item->>'description', ''), (item->>'treatment')::public.gate_treatment,
    ordinal::integer
  from jsonb_array_elements(coalesce(_gates, '[]'::jsonb)) with ordinality as rows(item, ordinal);

  delete from public.assessment_criteria where config_version_id = _config_version_id;
  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order)
  select _config_version_id, item->>'key', coalesce(item->>'label', ''),
    coalesce(item->>'description', ''), item->>'category', (item->>'weight')::numeric,
    ordinal::integer
  from jsonb_array_elements(coalesce(_criteria, '[]'::jsonb)) with ordinality as rows(item, ordinal);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'fund_config_draft_saved',
    'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'threshold', _analysis_threshold, 'partial', true));
end;
$$;

create or replace function public.activate_fund_config(_config_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_status public.fund_config_status;
  v_weight numeric;
  v_mandate public.fund_mandates%rowtype;
begin
  select v.fund_id, v.status into v_fund_id, v_status
  from public.fund_config_versions v where v.id = _config_version_id;
  if v_fund_id is null then raise exception 'Ukendt fondsprofilversion.'; end if;
  if not public.has_fund_role(auth.uid(), v_fund_id, 'administrator') then
    raise exception 'Kun en administrator kan publicere en fondsprofil.';
  end if;
  if v_status <> 'draft'::public.fund_config_status then raise exception 'Kun en kladde kan aktiveres.'; end if;

  select * into v_mandate from public.fund_mandates where config_version_id = _config_version_id;
  if v_mandate.config_version_id is null then raise exception 'Fondsprofilen mangler mandat.'; end if;
  if nullif(trim(v_mandate.thesis), '') is null then raise exception 'Tesen mangler.'; end if;
  if cardinality(v_mandate.stages) = 0 then raise exception 'Vælg mindst ét stadie.'; end if;
  if cardinality(v_mandate.geographies) = 0 then raise exception 'Vælg mindst én geografi.'; end if;
  if cardinality(v_mandate.sectors) = 0 then raise exception 'Vælg mindst én sektor.'; end if;
  if nullif(trim(v_mandate.risk_posture), '') is null then raise exception 'Risikotolerancen mangler.'; end if;
  if not exists (
    select 1 from public.mandate_gates
    where config_version_id = _config_version_id
      and nullif(trim(label), '') is not null and nullif(trim(description), '') is not null
  ) then raise exception 'Tilføj mindst én udfyldt mandatregel.'; end if;
  if exists (
    select 1 from public.mandate_gates
    where config_version_id = _config_version_id
      and (nullif(trim(label), '') is null or nullif(trim(description), '') is null)
  ) then raise exception 'Alle mandatregler skal have navn og beskrivelse.'; end if;
  if not exists (
    select 1 from public.assessment_criteria where config_version_id = _config_version_id
  ) then raise exception 'Tilføj mindst ét scoringskriterium.'; end if;
  if exists (
    select 1 from public.assessment_criteria
    where config_version_id = _config_version_id
      and (nullif(trim(label), '') is null or nullif(trim(description), '') is null)
  ) then raise exception 'Alle scoringskriterier skal have navn og beskrivelse.'; end if;

  select coalesce(sum(c.weight), 0) into v_weight
  from public.assessment_criteria c where c.config_version_id = _config_version_id;
  if v_weight <> 100 then
    raise exception 'Aktive kriterievægte skal summe til 100, men summerer til %.', v_weight;
  end if;

  update public.fund_config_versions set status = 'superseded'::public.fund_config_status
  where fund_id = v_fund_id and status = 'active'::public.fund_config_status;
  update public.fund_config_versions
  set status = 'active'::public.fund_config_status, activated_at = now()
  where id = _config_version_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user'::public.audit_actor_type, auth.uid(),
    'fund_config_activated', 'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'strategy_type', v_mandate.strategy_type));
end;
$$;

revoke all on function public.create_fund_config_draft(uuid) from public, anon;
grant execute on function public.create_fund_config_draft(uuid) to authenticated, service_role;

revoke all on function public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, text, jsonb, text[], jsonb, jsonb
) from public, anon;
grant execute on function public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, text, jsonb, text[], jsonb, jsonb
) to authenticated, service_role;

revoke all on function public.activate_fund_config(uuid) from public, anon;
grant execute on function public.activate_fund_config(uuid) to authenticated, service_role;

commit;
