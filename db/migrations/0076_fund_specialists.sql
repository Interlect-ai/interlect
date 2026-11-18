-- 0076 · Fondens eget sæt af specialister.
--
-- Fonden vælger frit, hvilke specialister den dybe analyse kører: de fire standardspecialister
-- kan slås fra og til igen, og fonden kan lave sine egne (højst 3 som standard, en indstilling pr.
-- installation). Mindst én specialist skal være aktiv.
--
-- 1. ai_settings.max_custom_specialists: hvor mange egne specialister en version højst må have
--    aktive (indstilling pr. installation, P11-mønsteret; ændres uden ny kode).
-- 2. fund_specialists: én række pr. specialist pr. fondsprofilversion, samme livscyklus som
--    prompt_module_overrides (0012): kladden kopierer rækkerne, en udgivet version er låst (0031),
--    og en analyse viser altid, hvilken udgave den brugte (analysis_runs.config_version_id).
--    * kind 'standard': kun et til/fra-valg for et af de fire faste moduler. En standardspecialist
--      uden række er aktiv, så alle eksisterende versioner kører præcis som før. Teksten kommer
--      fra koden og evt. prompt_module_overrides.
--    * kind 'custom': fondens egen specialist med navn, formål, mandat, evidenstests,
--      risikoområder, spørgsmål, leverancer ("output-felter") og de scoreområder, den vurderer.
--      Nøglen (custom_…) skrives af serveren og følger specialisten fra version til version.
-- 3. Ved udgivelse: mindst én aktiv specialist og højst max_custom_specialists aktive egne. Reglen
--    sidder som trigger på skiftet til aktiv (som vægtgrænserne i 0051), så den gælder for alle.
--
-- Additiv og bagudkompatibel (preview og produktion deler databasen): ny kolonne med standard,
-- ny tabel, nye triggere, create_fund_config_draft med samme signatur (kopierer nu også rækkerne).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Indstilling pr. installation
-- ---------------------------------------------------------------------------
alter table public.ai_settings
  add column max_custom_specialists integer not null default 3
    check (max_custom_specialists between 0 and 6);

comment on column public.ai_settings.max_custom_specialists is
  'T-860: højst så mange egne specialister må være aktive i en fondsprofilversion (holder prisen nede).';

-- ---------------------------------------------------------------------------
-- 2. Hjælpere til tjek af tekstlister. De bruges i CHECK, som kører med brugerens egne
--    rettigheder, så de ligger i public og kan kaldes af authenticated (rene funktioner uden
--    dataadgang).
-- ---------------------------------------------------------------------------
create or replace function public.text_list_ok(_items text[], _min integer, _max integer, _max_len integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _items is not null
    and coalesce(cardinality(_items), 0) between _min and _max
    and not exists (
      select 1 from unnest(_items) as t(item)
      where item is null or char_length(btrim(item)) = 0 or char_length(item) > _max_len
    );
$$;

create or replace function public.text_list_distinct(_items text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (select count(distinct item) from unnest(_items) as t(item)) = coalesce(cardinality(_items), 0);
$$;

revoke all on function public.text_list_ok(text[], integer, integer, integer) from public, anon;
revoke all on function public.text_list_distinct(text[]) from public, anon;
grant execute on function public.text_list_ok(text[], integer, integer, integer) to authenticated, service_role;
grant execute on function public.text_list_distinct(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Specialisterne pr. version
-- ---------------------------------------------------------------------------
create table public.fund_specialists (
  id uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.fund_config_versions(id) on delete cascade,
  specialist_key text not null,
  kind text not null check (kind in ('standard', 'custom')),
  enabled boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 100),
  name text,
  purpose text,
  mandate text[],
  evidence_tests text[],
  risk_areas text[],
  research_questions text[] not null default '{}',
  output_focus text[] not null default '{}',
  -- Scoreområderne (assessment_criteria.score_category), som specialisten vurderer kriterierne i,
  -- når ingen aktiv standardspecialist ejer området.
  categories text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (config_version_id, specialist_key),
  constraint fund_specialists_standard_shape check (
    kind <> 'standard' or (
      specialist_key in ('people_team', 'product_market_gtm', 'technology_risk', 'fund_finance_deal')
      and name is null and purpose is null
      and mandate is null and evidence_tests is null and risk_areas is null
      and cardinality(research_questions) = 0 and cardinality(output_focus) = 0
      and cardinality(categories) = 0
    )
  ),
  constraint fund_specialists_custom_shape check (
    kind <> 'custom' or (
      specialist_key ~ '^custom_[a-z0-9]{8,32}$'
      and char_length(btrim(coalesce(name, ''))) between 3 and 80
      and char_length(btrim(coalesce(purpose, ''))) between 10 and 600
      and public.text_list_ok(mandate, 1, 12, 400)
      and public.text_list_ok(evidence_tests, 1, 12, 400)
      and public.text_list_ok(risk_areas, 1, 12, 120)
      and public.text_list_ok(research_questions, 0, 6, 300)
      and public.text_list_ok(output_focus, 0, 8, 300)
      and public.text_list_distinct(categories)
      and categories <@ array[
        'fund_thesis_fit', 'founder_market_fit', 'team_market_fit', 'product_market_fit',
        'product_technology', 'market_timing', 'traction_gtm', 'financial_strength',
        'evidence_quality'
      ]::text[]
    )
  )
);

create index fund_specialists_updated_by_idx on public.fund_specialists (updated_by);

comment on table public.fund_specialists is
  'T-860: fondens sæt af specialister pr. fondsprofilversion. En standardspecialist uden række er aktiv; egne specialister har hele deres tekst her. Låst efter udgivelse (0031-triggeren).';

grant select, insert, update, delete on public.fund_specialists to authenticated;
grant all on public.fund_specialists to service_role;

alter table public.fund_specialists enable row level security;

create policy "fund_specialists_select_member" on public.fund_specialists
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

-- Kun kladder kan ændres, og kun af dem, der må ændre fondsopsætningen (0021).
create policy "fund_specialists_write_configure_draft" on public.fund_specialists
for all to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.can_configure_fund(auth.uid(), v.fund_id)
  )
)
with check (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.can_configure_fund(auth.uid(), v.fund_id)
  )
);

-- En udgivet version er uforanderlig, også for service-rollen (samme regel som 0031).
create trigger fund_specialists_published_immutable
before update or delete on public.fund_specialists
for each row execute function public.protect_published_config_rows();

-- Og der kan ikke komme nye specialister i en udgivet version: en kørsel læser versionens sæt i
-- hver fase, og reglerne ved udgivelse må ikke kunne gås udenom. (0031 tillader INSERT af hensyn
-- til oprettelse af fonde; nye fonde starter uden rækker her.)
create or replace function private.protect_published_specialist_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.fund_config_status;
begin
  select status into v_status
  from public.fund_config_versions
  where id = new.config_version_id;
  if found and v_status <> 'draft'::public.fund_config_status then
    raise exception 'Publicerede fondsprofilversioner er uforanderlige (%).', tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_published_specialist_insert() from public, anon, authenticated;

create trigger fund_specialists_published_insert
before insert on public.fund_specialists
for each row execute function private.protect_published_specialist_insert();

-- ---------------------------------------------------------------------------
-- 4. Reglerne ved udgivelse
-- ---------------------------------------------------------------------------
create or replace function private.assert_config_specialist_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_standard_off integer;
  v_custom_on integer;
  v_max integer;
begin
  if new.status = 'active'::public.fund_config_status
     and old.status is distinct from 'active'::public.fund_config_status then
    select count(*) filter (where s.kind = 'standard' and not s.enabled),
           count(*) filter (where s.kind = 'custom' and s.enabled)
    into v_standard_off, v_custom_on
    from public.fund_specialists s
    where s.config_version_id = new.id;
    select a.max_custom_specialists into v_max from public.ai_settings a where a.id;
    v_max := coalesce(v_max, 3);
    if v_custom_on > v_max then
      raise exception 'Højst % egne specialister kan være aktive (opsætningen har %).', v_max, v_custom_on
        using errcode = 'P0001';
    end if;
    if (4 - v_standard_off) + v_custom_on < 1 then
      raise exception 'Mindst én specialist skal være aktiv i den dybe analyse.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.assert_config_specialist_limits() from public, anon, authenticated;

create trigger fund_config_versions_specialist_limits
before update of status on public.fund_config_versions
for each row execute function private.assert_config_specialist_limits();

-- ---------------------------------------------------------------------------
-- 5. Kladden kopierer specialisterne. Uændret fra 0028 (med rollenavnene fra 0032) bortset fra
--    den sidste kopi-blok.
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
