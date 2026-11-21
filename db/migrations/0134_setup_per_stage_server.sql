-- 0134 · Teamopsætning pr. stadie: gem og udgiv (session 4, afsnit 3; overdragelsen fra session 1-3
-- samme sted).
--
-- 1. save_fund_config_draft får _setup (jsonb, standard null).
--      _setup = null (alle kald fra: editoren, AI-forslagene) erstatter kun de delte
--                      regler og kriterier (stage = null); rækker pr. stadie bliver stående, og
--                      fund_mandates.setup røres ikke. Tidligere slettede funktionen alle regler
--                      og kriterier i kladden, også dem pr. stadie (overdragelsen, session 1 b).
--      _setup <> null  er hele opsætningen: alle regler og kriterier erstattes med inputtet, hver
--                      med sit eget "stage" (tom = delt), og fund_mandates.setup sættes til _setup.
--                      Serveren tjekker indholdet (setup-input.ts); databasen tjekker formen
--                      (fund_setup_ok, 0133) og stadienøglerne (check på kolonnerne).
--    Den gamle signatur fjernes, så PostgREST kun ser én funktion (to ville gøre kaldet tvetydigt).
-- 2. activate_fund_config regner pr. stadie: de delte kriterier summer til 100, når der er nogen,
--    og hvert stadies egne kriterier summer til 100 (før: alle kriterier i versionen tilsammen, så
--    en version med tre stadier aldrig kunne udgives). Risikotolerancen kræves kun, når teksten
--    "Hvem er I, og hvordan tænker I?" (setup.about) er tom: den afløser risikolinsen i det nye UI.
--    Alt andet er som i 0127.
-- 3. assert_config_specialist_limits tjekker hvert sæt for sig: det delte sæt (stage = null) og
--    hvert stadies eget sæt (et stadie med egne rækker bruger kun dem, som analysen,
--    setup-stage.ts). Før talte triggeren på tværs af stadier.
-- 4. analysis_runs.validation_public viser også setupStage (hvilket stadie casen blev screenet
--    med, og om det var antaget) og economy (økonomipunkterne), så casesiden kan vise markeringen
--    "stadie antaget" og tallene. Begge er casens egne data uden AI-interne felter; resten af
--    validation_result er stadig skjult for browseren (0115).
-- 5. case_list_payload sender screeningens stadie med (screening_setup_stage).
-- RLS og grants er uændrede. Ingen eksisterende række ændres (generationen af validation_public
-- regnes igen for alle kørsler, men gamle kørsler har ingen setupStage eller economy).

begin;

set local lock_timeout = '5s';

-- 1. save_fund_config_draft ----------------------------------------------------------------------

drop function if exists public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, text, jsonb, text[], jsonb, jsonb, numeric, boolean
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
  _criteria jsonb,
  _fund_size_eur numeric default null,
  _set_fund_size boolean default false,
  _setup jsonb default null
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
  v_staged boolean := _setup is not null;
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
  if v_staged and jsonb_typeof(_setup) <> 'object' then raise exception 'Ugyldig opsætning.'; end if;
  -- Uden _setup må inputtet kun rumme delte rækker: et stadie her ville ellers erstatte et
  -- stadies rækker halvt (kun de nøgler, der er med) uden at resten blev slettet.
  if not v_staged and exists (
    select 1 from jsonb_array_elements(coalesce(_gates, '[]'::jsonb) || coalesce(_criteria, '[]'::jsonb)) item
    where nullif(item->>'stage', '') is not null
  ) then
    raise exception 'Regler og kriterier pr. stadie gemmes kun sammen med hele opsætningen.';
  end if;

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
    dealbreakers = coalesce(_dealbreakers, '{}'::text[]),
    setup = case when v_staged then _setup else setup end
  where config_version_id = _config_version_id;

  -- Uden _setup: kun de delte rækker (stage = null) erstattes; rækkerne pr. stadie bliver.
  delete from public.mandate_gates
  where config_version_id = _config_version_id and (v_staged or stage is null);
  insert into public.mandate_gates
    (config_version_id, stage, gate_key, label, description, treatment, sort_order)
  select _config_version_id, nullif(item->>'stage', ''), item->>'key', coalesce(item->>'label', ''),
    coalesce(item->>'description', ''), (item->>'treatment')::public.gate_treatment,
    ordinal::integer
  from jsonb_array_elements(coalesce(_gates, '[]'::jsonb)) with ordinality as rows(item, ordinal);

  -- Ældre kode sender ikke codeAnchor; så bevares kriteriets tidligere valg (samme stadie og
  -- nøgle), ellers er et økonomi-kriterium forankret i kode-scoren som hidtil.
  select coalesce(jsonb_object_agg(coalesce(stage, '') || ':' || criterion_key, code_anchor), '{}'::jsonb)
  into v_old_anchor
  from public.assessment_criteria where config_version_id = _config_version_id;

  delete from public.assessment_criteria
  where config_version_id = _config_version_id and (v_staged or stage is null);
  insert into public.assessment_criteria
    (config_version_id, stage, criterion_key, label, description, score_category, weight,
     sort_order, code_anchor)
  select _config_version_id, nullif(item->>'stage', ''), item->>'key', coalesce(item->>'label', ''),
    coalesce(item->>'description', ''), item->>'category', (item->>'weight')::numeric,
    ordinal::integer,
    coalesce(
      case when jsonb_typeof(item->'codeAnchor') = 'boolean' then (item->'codeAnchor')::boolean end,
      case when jsonb_typeof(v_old_anchor->(coalesce(item->>'stage', '') || ':' || (item->>'key'))) = 'boolean'
        then (v_old_anchor->(coalesce(item->>'stage', '') || ':' || (item->>'key')))::boolean end,
      true
    )
  from jsonb_array_elements(coalesce(_criteria, '[]'::jsonb)) with ordinality as rows(item, ordinal);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'fund_config_draft_saved',
    'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'threshold', _analysis_threshold, 'partial', true,
      'per_stage', v_staged,
      'code_anchor_off', (select count(*) from public.assessment_criteria
        where config_version_id = _config_version_id and not code_anchor)));
end;
$$;

revoke all on function public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, text, jsonb, text[], jsonb, jsonb, numeric, boolean, jsonb
) from public, anon;
grant execute on function public.save_fund_config_draft(
  uuid, text, text, text[], text[], text[], numeric, numeric, text, numeric,
  public.fund_approval_mode, text, text, jsonb, text[], jsonb, jsonb, numeric, boolean, jsonb
) to authenticated, service_role;

-- 2. activate_fund_config: vægtene pr. stadie -----------------------------------------------------

create or replace function public.activate_fund_config(_config_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_thesis_id uuid;
  v_status public.fund_config_status;
  v_weight numeric;
  v_group record;
  v_mandate public.fund_mandates%rowtype;
begin
  select v.fund_id, v.thesis_id, v.status into v_fund_id, v_thesis_id, v_status
  from public.fund_config_versions v where v.id = _config_version_id;
  if v_fund_id is null then raise exception 'Ukendt fondsprofilversion.'; end if;
  if not private.can_publish_fund_config(auth.uid(), v_fund_id) then
    raise exception 'Din rolle kan ikke udgive fondsopsætningen.';
  end if;
  if v_status <> 'draft'::public.fund_config_status then raise exception 'Kun en kladde kan aktiveres.'; end if;
  if exists (select 1 from public.fund_theses t where t.id = v_thesis_id and t.status = 'archived') then
    raise exception 'Tesen er arkiveret. Genaktivér den for at udgive.';
  end if;

  select * into v_mandate from public.fund_mandates where config_version_id = _config_version_id;
  if v_mandate.config_version_id is null then raise exception 'Fondsprofilen mangler mandat.'; end if;
  if nullif(trim(v_mandate.thesis), '') is null then raise exception 'Tesen mangler.'; end if;
  if cardinality(v_mandate.stages) = 0 then raise exception 'Vælg mindst ét stadie.'; end if;
  if cardinality(v_mandate.geographies) = 0 then raise exception 'Vælg mindst én geografi.'; end if;
  if cardinality(v_mandate.sectors) = 0 then raise exception 'Vælg mindst én sektor.'; end if;
  -- T-1094: "Hvem er I, og hvordan tænker I?" afløser risikolinsen i det nye UI.
  if nullif(trim(v_mandate.risk_posture), '') is null
     and nullif(btrim(coalesce(v_mandate.setup ->> 'about', '')), '') is null then
    raise exception 'Risikotolerancen mangler.';
  end if;
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

  -- Hver liste for sig: de delte kriterier og hvert stadies egne (setup-stage.ts, rowsForStageList).
  for v_group in
    select c.stage, coalesce(sum(c.weight), 0) as total
    from public.assessment_criteria c where c.config_version_id = _config_version_id
    group by c.stage
  loop
    if v_group.total <> 100 then
      if v_group.stage is null then
        raise exception 'Aktive kriterievægte skal summe til 100, men summerer til %.', v_group.total;
      end if;
      raise exception 'Kriterievægtene for stadiet % skal summe til 100, men summerer til %.',
        v_group.stage, v_group.total;
    end if;
  end loop;

  select coalesce(sum(c.weight), 0) into v_weight
  from public.assessment_criteria c
  where c.config_version_id = _config_version_id and c.stage is null;

  update public.fund_config_versions set status = 'superseded'::public.fund_config_status
  where thesis_id = v_thesis_id and status = 'active'::public.fund_config_status;
  update public.fund_config_versions
  set status = 'active'::public.fund_config_status, activated_at = now()
  where id = _config_version_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user'::public.audit_actor_type, auth.uid(),
    'fund_config_activated', 'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'strategy_type', v_mandate.strategy_type,
      'thesis_id', v_thesis_id,
      'stages', (select coalesce(jsonb_agg(distinct c.stage), '[]'::jsonb)
                 from public.assessment_criteria c
                 where c.config_version_id = _config_version_id and c.stage is not null)));
end;
$$;

revoke all on function public.activate_fund_config(uuid) from public, anon;
grant execute on function public.activate_fund_config(uuid) to authenticated, service_role;

-- 3. Specialisterne: hvert sæt for sig -------------------------------------------------------------

create or replace function private.assert_config_specialist_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_max integer;
begin
  if new.status = 'active'::public.fund_config_status
     and old.status is distinct from 'active'::public.fund_config_status then
    select a.max_custom_specialists into v_max from public.ai_settings a where a.id;
    v_max := coalesce(v_max, 3);
    -- Det delte sæt findes altid (ingen rækker = de fire standardspecialister); et stadie har
    -- kun sit eget sæt, når det har egne rækker.
    for v_group in
      select g.stage,
        count(s.specialist_key) filter (where s.kind = 'standard' and not s.enabled) as standard_off,
        count(s.specialist_key) filter (where s.kind = 'custom' and s.enabled) as custom_on
      from (
        select null::text as stage
        union
        select distinct f.stage from public.fund_specialists f
        where f.config_version_id = new.id and f.stage is not null
      ) g
      left join public.fund_specialists s
        on s.config_version_id = new.id and s.stage is not distinct from g.stage
      group by g.stage
    loop
      if v_group.custom_on > v_max then
        raise exception 'Højst % egne specialister kan være aktive (opsætningen har %).',
          v_max, v_group.custom_on
          using errcode = 'P0001';
      end if;
      if (4 - v_group.standard_off) + v_group.custom_on < 1 then
        raise exception 'Mindst én specialist skal være aktiv i den dybe analyse.'
          using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.assert_config_specialist_limits() from public, anon, authenticated;

-- 4. validation_public: stadiet og økonomien ------------------------------------------------------

alter table public.analysis_runs
  alter column validation_public set expression as (
    case when jsonb_typeof(validation_result) = 'object' then
      case when validation_result ? 'teamGateAnswers'
        then jsonb_set('{}'::jsonb, '{teamGateAnswers}', validation_result -> 'teamGateAnswers')
        else '{}'::jsonb end
      || case when validation_result ? 'financeScore'
        then jsonb_set('{}'::jsonb, '{financeScore}', validation_result -> 'financeScore')
        else '{}'::jsonb end
      || case when validation_result ? 'setupStage'
        then jsonb_set('{}'::jsonb, '{setupStage}', validation_result -> 'setupStage')
        else '{}'::jsonb end
      || case when validation_result ? 'economy'
        then jsonb_set('{}'::jsonb, '{economy}', validation_result -> 'economy')
        else '{}'::jsonb end
    end
  );

comment on column public.analysis_runs.validation_public is
  'T-915 og T-1094: kun teamGateAnswers, financeScore, setupStage og economy fra '
  'validation_result; det, browserens rolle må læse.';

-- 5. Caselisten får screeningens stadie, så hver case vises med sit stadies regler og kriterier
--    (case-list.ts). Samme fremgangsmåde som 0127 og 0128: funktionens tekst rettes ét sted, og
--    rettelsen afvises, hvis stedet ikke findes præcis én gang.
do $$
declare
  v_definition text;
  v_old text := E'          ''screening_team_gate_answers'', sv.validation_public -> ''teamGateAnswers'',\n';
  v_count integer;
begin
  v_definition := pg_get_functiondef('public.case_list_payload(uuid, uuid, uuid)'::regprocedure);
  if position('screening_setup_stage' in v_definition) > 0 then
    return;
  end if;
  v_count := (char_length(v_definition) - char_length(replace(v_definition, v_old, '')))
    / char_length(v_old);
  if v_count <> 1 then
    raise exception 'T-1094: stedet i case_list_payload blev fundet % gange.', v_count;
  end if;
  execute replace(v_definition, v_old, v_old
    || E'          ''screening_setup_stage'', sv.validation_public -> ''setupStage'',\n');
end
$$;

revoke all on function public.case_list_payload(uuid, uuid, uuid) from public, anon;
grant execute on function public.case_list_payload(uuid, uuid, uuid) to authenticated, service_role;

commit;
