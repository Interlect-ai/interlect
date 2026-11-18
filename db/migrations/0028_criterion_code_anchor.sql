-- Opsamling (C8-review): fonden vælger selv, hvilke økonomi-kriterier (financial_strength)
-- der forankres i kode-scoren fra regnskaberne. Standard er som hidtil (forankret), så intet
-- ændrer sig for eksisterende fonde. Et fravalgt kriterium scores af AI'en fra evidens som
-- alle andre kriterier (fx Dreamcrafts "Distribution og monetisering").
--
-- Samme signatur som 0026, så create or replace bevarer rettighederne. Preview og produktion
-- deler databasen: kode uden codeAnchor i kriterierne bevarer kriteriets tidligere valg.

begin;

alter table public.assessment_criteria
  add column code_anchor boolean not null default true;

-- Uændret fra 0026, nu med code_anchor.
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
  if not public.can_configure_fund(auth.uid(), v_source.fund_id) then
    raise exception 'Kun en administrator eller partner kan redigere fondsopsætningen.';
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
    (config_version_id, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
     ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
     strategy_type, stage_expectations, dealbreakers)
  select v_new_id, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    strategy_type, stage_expectations, dealbreakers
  from public.fund_mandates where config_version_id = v_source.id;

  insert into public.mandate_gates
    (config_version_id, gate_key, label, description, treatment, sort_order)
  select v_new_id, gate_key, label, description, treatment, sort_order
  from public.mandate_gates where config_version_id = v_source.id;

  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order,
     code_anchor)
  select v_new_id, criterion_key, label, description, score_category, weight, sort_order,
    code_anchor
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

-- Uændret fra 0026, nu med code_anchor (bevares ved udeladelse).
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
  _strategy_type text,
  _stage_expectations jsonb,
  _dealbreakers text[],
  _gates jsonb,
  _criteria jsonb,
  _fund_size_eur numeric default null,
  _set_fund_size boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_weight numeric;
  v_fund_size numeric;
  v_old_anchor jsonb;
begin
  select fund_id into v_fund_id
  from public.fund_config_versions
  where id = _config_version_id and status = 'draft'::public.fund_config_status;

  if v_fund_id is null then raise exception 'Kladdeversionen blev ikke fundet.'; end if;
  if not public.can_configure_fund(auth.uid(), v_fund_id) then
    raise exception 'Kun en administrator eller partner kan redigere fondsopsætningen.';
  end if;
  if coalesce(_set_fund_size, false) then
    v_fund_size := _fund_size_eur;
  else
    select fund_size_eur into v_fund_size
    from public.fund_mandates where config_version_id = _config_version_id;
  end if;
  if nullif(trim(_fund_name), '') is null then raise exception 'Fondsnavn mangler.'; end if;
  if _analysis_threshold < 0 or _analysis_threshold > 100 then raise exception 'Ugyldig analysetærskel.'; end if;
  if _strategy_type not in ('venture', 'growth', 'thematic', 'custom') then raise exception 'Ugyldig strategitype.'; end if;
  if _ticket_min_eur is not null and _ticket_min_eur < 0 then raise exception 'Ugyldig minimumsinvestering.'; end if;
  if _ticket_max_eur is not null and _ticket_max_eur < coalesce(_ticket_min_eur, 0) then
    raise exception 'Maksimumsinvestering skal være større end minimum.';
  end if;
  if v_fund_size is not null and not (v_fund_size > 0 and v_fund_size < 'Infinity') then
    raise exception 'Fondsstørrelsen skal være et tal større end 0.';
  end if;
  if v_fund_size is not null
     and greatest(coalesce(_ticket_max_eur, 0), coalesce(_ticket_min_eur, 0)) > v_fund_size then
    raise exception 'En ticket kan ikke være større end fonden.';
  end if;
  if jsonb_typeof(coalesce(_gates, '[]'::jsonb)) <> 'array' then raise exception 'Ugyldige mandatregler.'; end if;
  if jsonb_typeof(coalesce(_criteria, '[]'::jsonb)) <> 'array' then raise exception 'Ugyldige kriterier.'; end if;

  select coalesce(sum((item->>'weight')::numeric), 0) into v_weight
  from jsonb_array_elements(coalesce(_criteria, '[]'::jsonb)) item;

  update public.funds set name = trim(_fund_name), updated_at = now() where id = v_fund_id;
  update public.fund_mandates set
    thesis = trim(coalesce(_thesis, '')), stages = coalesce(_stages, '{}'::text[]),
    geographies = coalesce(_geographies, '{}'::text[]), sectors = coalesce(_sectors, '{}'::text[]),
    fund_size_eur = v_fund_size,
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

  -- Ældre kode sender ikke codeAnchor; så bevares kriteriets tidligere valg (nøglen), ellers
  -- er et økonomi-kriterium forankret i kode-scoren som hidtil.
  select coalesce(jsonb_object_agg(criterion_key, code_anchor), '{}'::jsonb) into v_old_anchor
  from public.assessment_criteria where config_version_id = _config_version_id;

  delete from public.assessment_criteria where config_version_id = _config_version_id;
  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order,
     code_anchor)
  select _config_version_id, item->>'key', coalesce(item->>'label', ''),
    coalesce(item->>'description', ''), item->>'category', (item->>'weight')::numeric,
    ordinal::integer,
    coalesce(
      case when jsonb_typeof(item->'codeAnchor') = 'boolean' then (item->'codeAnchor')::boolean end,
      case when jsonb_typeof(v_old_anchor->(item->>'key')) = 'boolean'
        then (v_old_anchor->(item->>'key'))::boolean end,
      true
    )
  from jsonb_array_elements(coalesce(_criteria, '[]'::jsonb)) with ordinality as rows(item, ordinal);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'fund_config_draft_saved',
    'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'threshold', _analysis_threshold, 'partial', true,
      'code_anchor_off', (select count(*) from public.assessment_criteria
        where config_version_id = _config_version_id and not code_anchor)));
end;
$$;

commit;
