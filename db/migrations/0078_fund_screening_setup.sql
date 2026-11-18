-- 0078 · Fondens egen screening ("løst NU").
--
-- Alt, der styrer screeningen, skal kunne defineres af fonden og gemmes i opsætningen. Kriterier
-- og vægte, gates, risikoprofil og screeningens research-spørgsmål findes allerede pr. version
-- (fund_mandates, mandate_gates, assessment_criteria, research_module_overrides). Her kommer de to
-- sidste brikker, også pr. fondsprofilversion, så en ændring gælder nye kørsler, og en gammel
-- kørsel viser den version, den brugte (analysis_runs.config_version_id):
--
-- 1. fund_mandates.screening_instruction: fondens frie "sådan screener vi"-instruktion. Den går
--    med i screeningsprompten (kun fortrolige kald, altså kun ZDR-modeller) og aldrig i søgninger.
--    Tom tekst = ingen instruktion, så alle eksisterende versioner screener præcis som før.
-- 2. fund_mandates.screening_cards: de ekstra screeningskort, fonden har valgt (finance, team,
-- market, technology). De tre faste kort (Profil, Mandatfit, Nøglefund) vises altid.
--    Eksisterende versioner får {finance}, fordi Finanser-kortet i dag altid vises.
-- 3. save_fund_screening_setup(): gemmer begge i en kladde (Admin og Lead, som resten af
--    opsætningen) og skriver en linje i revisionsloggen uden selve teksten.
-- 4. create_fund_config_draft kopierer de to felter til den nye kladde.
--
-- Additiv og bagudkompatibel (preview og produktion deler databasen): to nye kolonner med
-- standardværdier, en ny funktion, create_fund_config_draft med samme signatur.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1–2. Kolonnerne pr. version
-- ---------------------------------------------------------------------------
alter table public.fund_mandates
  add column screening_instruction text not null default ''
    constraint fund_mandates_screening_instruction_length
      check (char_length(screening_instruction) <= 3000),
  add column screening_cards text[] not null default array['finance']::text[]
    constraint fund_mandates_screening_cards_known
      check (
        public.text_list_distinct(screening_cards)
        and screening_cards <@ array['finance', 'team', 'market', 'technology']::text[]
      );

comment on column public.fund_mandates.screening_instruction is
  'T-861: fondens egen "sådan screener vi"-instruktion til screeningsprompten (kun ZDR-kald, aldrig søgninger). Tom = ingen.';
comment on column public.fund_mandates.screening_cards is
  'T-861: ekstra screeningskort, fonden har valgt (finance, team, market, technology). De tre faste kort vises altid.';

-- ---------------------------------------------------------------------------
-- 3. Gem i kladden
-- ---------------------------------------------------------------------------
create or replace function public.save_fund_screening_setup(
  _config_version_id uuid,
  _instruction text,
  _cards text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_instruction text := btrim(coalesce(_instruction, ''));
  v_cards text[] := coalesce(_cards, '{}'::text[]);
begin
  select fund_id into v_fund_id
  from public.fund_config_versions
  where id = _config_version_id and status = 'draft'::public.fund_config_status;

  if v_fund_id is null then raise exception 'Kladdeversionen blev ikke fundet.'; end if;
  if not public.can_configure_fund(auth.uid(), v_fund_id) then
    raise exception 'Kun en Admin eller Lead kan redigere fondsopsætningen.';
  end if;
  if char_length(v_instruction) > 3000 then
    raise exception 'Screeningsinstruktionen må højst være 3.000 tegn.';
  end if;
  if not public.text_list_distinct(v_cards)
     or not (v_cards <@ array['finance', 'team', 'market', 'technology']::text[]) then
    raise exception 'Ukendt eller gentaget screeningskort.';
  end if;

  update public.fund_mandates set
    screening_instruction = v_instruction,
    screening_cards = v_cards
  where config_version_id = _config_version_id;
  if not found then raise exception 'Kladden mangler sit mandat.'; end if;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'fund_screening_setup_saved',
    'fund_config_versions', _config_version_id,
    jsonb_build_object('instruction_chars', char_length(v_instruction), 'cards', to_jsonb(v_cards)));
end;
$$;

revoke all on function public.save_fund_screening_setup(uuid, text, text[]) from public, anon;
grant execute on function public.save_fund_screening_setup(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Kladden kopierer de to felter. Uændret fra 0076 bortset fra fund_mandates-kopien.
-- ---------------------------------------------------------------------------
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
    raise exception 'Kun en Admin eller Lead kan redigere fondsopsætningen.';
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
     strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards)
  select v_new_id, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards
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

  insert into public.fund_specialists
    (config_version_id, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
     evidence_tests, risk_areas, research_questions, output_focus, categories, updated_by)
  select v_new_id, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
    evidence_tests, risk_areas, research_questions, output_focus, categories, auth.uid()
  from public.fund_specialists where config_version_id = v_source.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_draft_created',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'version', v_next_version));
  return v_new_id;
end;
$$;

commit;
