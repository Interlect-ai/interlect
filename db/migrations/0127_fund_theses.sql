-- Teser i databasen.
-- Spec: afsnit 2.2, 2.3 og 5.
--
-- Et team kan have flere teser. En tese er en navngiven opsætning med sine egne versioner, og hver
-- case hører til én tese. Denne migration lægger kun fundamentet:
--   1. tabellen fund_theses (RLS: medlemmer læser; skrivning kun via security definer-funktioner);
--   2. én tese pr. eksisterende team (navn = teamets navn, aktiv og standard, hvis teamet har en
--      udgivet version, ellers kladde);
--   3. thesis_id på fund_config_versions og cases (udfyldt, not null, samme team via sammensat
--      nøgle), versionsnummer og "højst én aktiv" pr. tese, og samme selskab må være case under
--      to teser;
--   4. kladde, udgiv, opret case, overgange, Brains tese-side og Cases-listen arbejder pr. tese,
--      og den nye create_thesis_from laver en ny tese som kopi af en anden;
--   5. indsættelser uden thesis_id (scripts, tests, createFund, customer:new) får teamets
--      standardtese, eller teamets første tese oprettes; første udgivelse gør tesen aktiv.
-- Intet ændres for brugeren: hvert team har én tese med samme navn, versioner og cases.
-- Intet slettes. Kan køres igen (if not exists / drop if exists / create or replace).

begin;

-- 1. Tabellen ----------------------------------------------------------------------------------

create table if not exists public.fund_theses (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  unique (id, fund_id),
  -- Kun en aktiv tese (med en udgivet version) kan være standard.
  constraint fund_theses_default_is_active check (not is_default or status = 'active'),
  constraint fund_theses_archived_at check ((status = 'archived') = (archived_at is not null))
);

-- Navnet er unikt pr. team blandt de ikke-arkiverede teser.
create unique index if not exists fund_theses_name_idx
  on public.fund_theses (fund_id, lower(btrim(name)))
  where status <> 'archived';

-- Højst én standardtese pr. team.
create unique index if not exists fund_theses_one_default_idx
  on public.fund_theses (fund_id)
  where is_default;

revoke all on table public.fund_theses from public, anon, authenticated;
grant select on table public.fund_theses to authenticated;
grant all on table public.fund_theses to service_role;

alter table public.fund_theses enable row level security;

drop policy if exists fund_theses_select_member on public.fund_theses;
create policy fund_theses_select_member on public.fund_theses
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

drop policy if exists mfa_required on public.fund_theses;
create policy mfa_required on public.fund_theses as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Tesens navn, når den laves ud fra teamets navn (2-80 tegn).
create or replace function private.thesis_name_from_team(_team_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when char_length(btrim(coalesce(_team_name, ''))) < 2 then 'Tese'
    else btrim(left(btrim(_team_name), 80))
  end;
$$;

revoke all on function private.thesis_name_from_team(text) from public, anon, authenticated;

-- 2. Én tese pr. eksisterende team ---------------------------------------------------------------

insert into public.fund_theses (fund_id, name, status, is_default, created_at)
select
  f.id,
  private.thesis_name_from_team(f.name),
  case when a.has_active then 'active' else 'draft' end,
  a.has_active,
  f.created_at
from public.funds f
cross join lateral (
  select exists (
    select 1 from public.fund_config_versions v
    where v.fund_id = f.id and v.status = 'active'::public.fund_config_status
  ) as has_active
) a
where not exists (select 1 from public.fund_theses t where t.fund_id = f.id);

-- 3. thesis_id på versioner og cases -------------------------------------------------------------

alter table public.fund_config_versions add column if not exists thesis_id uuid;
alter table public.cases add column if not exists thesis_id uuid;

-- Udgivne versioner er uforanderlige (0002); udfyldningen er den eneste undtagelse og sker i
-- denne transaktion. Triggeren udvides nedenfor, så thesis_id aldrig kan ændres bagefter.
alter table public.fund_config_versions disable trigger fund_config_versions_immutable;

update public.fund_config_versions v
set thesis_id = (
  select t.id from public.fund_theses t
  where t.fund_id = v.fund_id
  order by t.is_default desc, t.created_at, t.id
  limit 1)
where v.thesis_id is null;

alter table public.fund_config_versions enable trigger fund_config_versions_immutable;

update public.cases c
set thesis_id = (
  select t.id from public.fund_theses t
  where t.fund_id = c.fund_id
  order by t.is_default desc, t.created_at, t.id
  limit 1)
where c.thesis_id is null;

alter table public.fund_config_versions alter column thesis_id set not null;
alter table public.cases alter column thesis_id set not null;

-- Samme team som versionen/casen (sammensat nøgle); følger tesen ved sletning, så delete_fund
-- sletter teamet uden ny rækkefølge. En tese slettes ellers aldrig (arkivér, afsnit 3).
alter table public.fund_config_versions drop constraint if exists fund_config_versions_thesis_fkey;
alter table public.fund_config_versions
  add constraint fund_config_versions_thesis_fkey
  foreign key (thesis_id, fund_id) references public.fund_theses (id, fund_id) on delete cascade;

alter table public.cases drop constraint if exists cases_thesis_fkey;
alter table public.cases
  add constraint cases_thesis_fkey
  foreign key (thesis_id, fund_id) references public.fund_theses (id, fund_id) on delete cascade;

-- Versionsnummer og "højst én aktiv" pr. tese i stedet for pr. team.
-- (fund_id, profile_key, version) bliver stående: hver tese har sin egen profile_key.
alter table public.fund_config_versions drop constraint if exists fund_config_versions_fund_id_version_key;
alter table public.fund_config_versions drop constraint if exists fund_config_versions_thesis_id_version_key;
alter table public.fund_config_versions
  add constraint fund_config_versions_thesis_id_version_key unique (thesis_id, version);

drop index if exists public.fund_config_one_active_idx;
create unique index if not exists fund_config_one_active_per_thesis_idx
  on public.fund_config_versions (thesis_id)
  where status = 'active'::public.fund_config_status;

-- Samme selskab kan være case under to teser (beslutningslog 28. sep: én case pr. tese).
alter table public.cases drop constraint if exists cases_fund_id_company_id_key;
alter table public.cases drop constraint if exists cases_thesis_id_company_id_key;
alter table public.cases
  add constraint cases_thesis_id_company_id_key unique (thesis_id, company_id);
-- Opslag på team + selskab (dublettjek, Brain) beholder et indeks.
create index if not exists cases_fund_company_idx on public.cases (fund_id, company_id);

-- En version og en case skifter aldrig tese.
create or replace function public.protect_published_fund_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.thesis_id is distinct from old.thesis_id then
    raise exception 'En version kan ikke flyttes til en anden tese.';
  end if;
  if old.status = 'superseded'::public.fund_config_status then
    raise exception 'Publicerede fondsprofilversioner er uforanderlige.';
  end if;
  if old.status = 'active'::public.fund_config_status
     and new.status <> 'superseded'::public.fund_config_status then
    raise exception 'En aktiv fondsprofil kan kun afløses af en ny version.';
  end if;
  return new;
end;
$$;

create or replace function private.protect_case_thesis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.thesis_id is distinct from old.thesis_id then
    raise exception 'En case kan ikke flyttes til en anden tese.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_case_thesis() from public, anon, authenticated;

drop trigger if exists cases_thesis_immutable on public.cases;
create trigger cases_thesis_immutable
before update of thesis_id on public.cases
for each row execute function private.protect_case_thesis();

-- 5. Indsættelse uden tese -----------------------------------------------------------------------

-- Teamets tese til en ny række uden thesis_id: standardtesen, ellers den ældste ikke-arkiverede
-- (en ny tese, der endnu ikke er udgivet). Har teamet ingen, oprettes den første (navn = teamets
-- navn, kladde), så createFund, customer:new og scripts virker uændret.
create or replace function private.team_thesis_for_insert(_fund_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
begin
  select t.id into v_id
  from public.fund_theses t
  where t.fund_id = _fund_id and t.status <> 'archived'
  order by t.is_default desc, (t.status = 'active') desc, t.created_at, t.id
  limit 1;
  if v_id is not null then return v_id; end if;

  -- Ingen tese endnu: lås teamet, så to samtidige indsættelser ikke laver to første teser.
  select f.name into v_name from public.funds f where f.id = _fund_id for update;
  if not found then return null; end if;

  select t.id into v_id
  from public.fund_theses t
  where t.fund_id = _fund_id and t.status <> 'archived'
  order by t.is_default desc, (t.status = 'active') desc, t.created_at, t.id
  limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.fund_theses (fund_id, name, status, created_by)
  values (_fund_id, private.thesis_name_from_team(v_name), 'draft', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.team_thesis_for_insert(uuid) from public, anon, authenticated;

create or replace function private.fill_thesis_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.thesis_id is null then
    new.thesis_id := private.team_thesis_for_insert(new.fund_id);
  end if;
  return new;
end;
$$;

revoke all on function private.fill_thesis_id() from public, anon, authenticated;

drop trigger if exists fund_config_versions_fill_thesis on public.fund_config_versions;
create trigger fund_config_versions_fill_thesis
before insert on public.fund_config_versions
for each row execute function private.fill_thesis_id();

drop trigger if exists cases_fill_thesis on public.cases;
create trigger cases_fill_thesis
before insert on public.cases
for each row execute function private.fill_thesis_id();

-- Første udgivelse gør tesen aktiv; har teamet ingen standardtese, bliver den standard (2.3).
create or replace function private.thesis_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fund_theses
  set status = 'active'
  where id = new.thesis_id and status = 'draft';

  if not exists (
    select 1 from public.fund_theses t where t.fund_id = new.fund_id and t.is_default
  ) then
    update public.fund_theses
    set is_default = true
    where id = new.thesis_id and status = 'active';
  end if;
  return null;
end;
$$;

revoke all on function private.thesis_published() from public, anon, authenticated;

drop trigger if exists fund_config_versions_thesis_published on public.fund_config_versions;
create trigger fund_config_versions_thesis_published
after insert or update of status on public.fund_config_versions
for each row when (new.status = 'active'::public.fund_config_status)
execute function private.thesis_published();

-- 4. Funktionerne pr. tese -----------------------------------------------------------------------

-- Opsætningens indhold kopieres fra én version til en anden (kladde eller ny tese). Samme tabeller
-- og kolonner som create_fund_config_draft fra 0078.
create or replace function private.copy_fund_config_content(_from uuid, _to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fund_mandates
    (config_version_id, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
     ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
     strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards)
  select _to, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards
  from public.fund_mandates where config_version_id = _from;

  insert into public.mandate_gates
    (config_version_id, gate_key, label, description, treatment, sort_order)
  select _to, gate_key, label, description, treatment, sort_order
  from public.mandate_gates where config_version_id = _from;

  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order,
     code_anchor)
  select _to, criterion_key, label, description, score_category, weight, sort_order,
    code_anchor
  from public.assessment_criteria where config_version_id = _from;

  insert into public.fund_profile_sources
    (config_version_id, label, url, supports, source_type, collected_at)
  select _to, label, url, supports, source_type, collected_at
  from public.fund_profile_sources where config_version_id = _from;

  insert into public.prompt_module_overrides
    (config_version_id, module_id, mandate, evidence_tests, risk_areas, updated_by)
  select _to, module_id, mandate, evidence_tests, risk_areas, auth.uid()
  from public.prompt_module_overrides where config_version_id = _from;

  insert into public.research_module_overrides
    (config_version_id, mode, module_id, questions, updated_by)
  select _to, mode, module_id, questions, auth.uid()
  from public.research_module_overrides where config_version_id = _from;

  insert into public.fund_specialists
    (config_version_id, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
     evidence_tests, risk_areas, research_questions, output_focus, categories, updated_by)
  select _to, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
    evidence_tests, risk_areas, research_questions, output_focus, categories, auth.uid()
  from public.fund_specialists where config_version_id = _from;
end;
$$;

revoke all on function private.copy_fund_config_content(uuid, uuid) from public, anon, authenticated;

-- Kladden og næste versionsnummer pr. tese (ikke pr. team).
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
  if exists (
    select 1 from public.fund_theses t where t.id = v_source.thesis_id and t.status = 'archived'
  ) then
    raise exception 'Tesen er arkiveret. Genaktivér den for at redigere.';
  end if;

  select id into v_new_id
  from public.fund_config_versions
  where thesis_id = v_source.thesis_id and status = 'draft'::public.fund_config_status
  order by version desc limit 1;
  if v_new_id is not null then return v_new_id; end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.fund_config_versions where thesis_id = v_source.thesis_id;

  insert into public.fund_config_versions
    (fund_id, thesis_id, version, profile_key, status, source_basis, researched_at, created_by)
  values
    (v_source.fund_id, v_source.thesis_id, v_next_version, v_source.profile_key, 'draft',
     'administrator_configuration', current_date, auth.uid())
  returning id into v_new_id;

  perform private.copy_fund_config_content(v_source.id, v_new_id);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_draft_created',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'version', v_next_version,
      'thesis_id', v_source.thesis_id));
  return v_new_id;
end;
$$;

revoke all on function public.create_fund_config_draft(uuid) from public, anon;
grant execute on function public.create_fund_config_draft(uuid) to authenticated, service_role;

-- Udgiv: kun den samme teses tidligere aktive version afløses; rettighedstjekket fra 0032 bliver.
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
  where thesis_id = v_thesis_id and status = 'active'::public.fund_config_status;
  update public.fund_config_versions
  set status = 'active'::public.fund_config_status, activated_at = now()
  where id = _config_version_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user'::public.audit_actor_type, auth.uid(),
    'fund_config_activated', 'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight, 'strategy_type', v_mandate.strategy_type,
      'thesis_id', v_thesis_id));
end;
$$;

revoke all on function public.activate_fund_config(uuid) from public, anon;
grant execute on function public.activate_fund_config(uuid) to authenticated, service_role;

-- Ny tese som kopi: den valgte teses aktive version bliver version 1 (kladde) af en ny tese med
-- en ny profile_key. Admin og Lead (configure_fund, afsnit 4.7). Returnerer den nye teses id.
-- Kun service_role må kalde den, indtil lader serveren læse casens tese: med to aktive
-- teser i et team ville opslagene "teamets aktive version" ellers fejle. giver
-- authenticated adgang.
create or replace function public.create_thesis_from(_source_thesis_id uuid, _name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thesis public.fund_theses%rowtype;
  v_source public.fund_config_versions%rowtype;
  v_name text := btrim(coalesce(_name, ''));
  v_new_thesis uuid;
  v_new_version uuid;
  v_key text;
begin
  select * into v_thesis from public.fund_theses where id = _source_thesis_id;
  if v_thesis.id is null then raise exception 'Tesen blev ikke fundet.'; end if;
  if not public.can_configure_fund(auth.uid(), v_thesis.fund_id) then
    raise exception 'Kun en Admin eller Lead kan oprette en tese.';
  end if;
  if v_thesis.status <> 'active' then
    raise exception 'Kun en aktiv tese kan kopieres.';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Tesens navn skal være 2-80 tegn.';
  end if;
  if exists (
    select 1 from public.fund_theses t
    where t.fund_id = v_thesis.fund_id and t.status <> 'archived'
      and lower(btrim(t.name)) = lower(v_name)
  ) then
    raise exception 'Der findes allerede en tese med det navn.';
  end if;

  select * into v_source
  from public.fund_config_versions
  where thesis_id = v_thesis.id and status = 'active'::public.fund_config_status;
  if v_source.id is null then raise exception 'Tesen har ingen udgivet version at kopiere.'; end if;

  insert into public.fund_theses (fund_id, name, status, created_by)
  values (v_thesis.fund_id, v_name, 'draft', auth.uid())
  returning id into v_new_thesis;

  -- Ny, unik analysenøgle for den nye tese (afsnit 2.2, punkt 2).
  loop
    v_key := left(v_source.profile_key, 60) || '-' || substr(md5(gen_random_uuid()::text), 1, 8);
    exit when not exists (
      select 1 from public.fund_config_versions where fund_id = v_thesis.fund_id and profile_key = v_key
    );
  end loop;

  insert into public.fund_config_versions
    (fund_id, thesis_id, version, profile_key, status, source_basis, researched_at, created_by)
  values
    (v_thesis.fund_id, v_new_thesis, 1, v_key, 'draft', 'administrator_configuration',
     current_date, auth.uid())
  returning id into v_new_version;

  perform private.copy_fund_config_content(v_source.id, v_new_version);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_thesis.fund_id, 'user', auth.uid(), 'fund_thesis_created', 'fund_theses', v_new_thesis,
    jsonb_build_object('name', v_name, 'source_thesis_id', v_thesis.id,
      'source_config_id', v_source.id, 'config_version_id', v_new_version));
  return v_new_thesis;
end;
$$;

revoke all on function public.create_thesis_from(uuid, text) from public, anon, authenticated;
grant execute on function public.create_thesis_from(uuid, text) to service_role;

-- Opret case pr. tese: _thesis_id (valgfri; tom = teamets standardtese) og dublet på tese + selskab.
drop function if exists public.create_manual_case_for_fund(
  uuid, text, text, public.company_stage, text, text, text, jsonb);

create or replace function public.create_manual_case_for_fund(
  _fund_id uuid,
  _company_name text,
  _website text,
  _stage public.company_stage,
  _sector text,
  _geography text,
  _source_note text,
  _founders jsonb,
  _thesis_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_case_id uuid;
  v_thesis_id uuid;
  v_domain text;
  founder jsonb;
  v_person_id uuid;
  v_has_primary boolean;
begin
  if not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'Den valgte fond er ikke tilgængelig.';
  end if;
  if not (
    public.has_fund_role(auth.uid(), _fund_id, 'member')
    or public.has_fund_role(auth.uid(), _fund_id, 'lead')
    or public.has_fund_role(auth.uid(), _fund_id, 'admin')
  ) then
    raise exception 'Din rolle kan ikke oprette cases.';
  end if;
  if nullif(trim(_company_name), '') is null then
    raise exception 'Selskabsnavn mangler.';
  end if;

  if _thesis_id is null then
    v_thesis_id := private.team_thesis_for_insert(_fund_id);
  else
    select t.id into v_thesis_id
    from public.fund_theses t
    where t.id = _thesis_id and t.fund_id = _fund_id and t.status = 'active';
    if v_thesis_id is null then
      raise exception 'Tesen kan ikke vælges.';
    end if;
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
  where fund_id = _fund_id and thesis_id = v_thesis_id and company_id = v_company_id
  limit 1;

  if v_case_id is null then
    insert into public.cases
      (fund_id, thesis_id, company_id, primary_origin, source_note, workspace_status, created_by)
    values
      (_fund_id, v_thesis_id, v_company_id, 'manual', coalesce(_source_note, ''), 'screening', auth.uid())
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
     jsonb_build_object('source', 'manual', 'company_id', v_company_id, 'thesis_id', v_thesis_id));

  return v_case_id;
end;
$$;

revoke all on function public.create_manual_case_for_fund(
  uuid, text, text, public.company_stage, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.create_manual_case_for_fund(
  uuid, text, text, public.company_stage, text, text, text, jsonb, uuid) to authenticated, service_role;

-- transition_case (0039), brain_page_data (0064) og case_list_payload (0122) ændres kun ét eller
-- få steder; de rettes i den nuværende definition (som 0032), og hvert sted skal findes præcis én
-- gang, ellers stopper migrationen.
create or replace function private.patch_function_text(_definition text, _old text, _new text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Allerede rettet (migrationen køres igen): den nye tekst kan indeholde den gamle, så den
  -- tjekkes først.
  if position(_new in _definition) > 0 then
    return _definition;
  end if;
  v_count := (char_length(_definition) - char_length(replace(_definition, _old, ''))) / char_length(_old);
  if v_count = 1 then
    return replace(_definition, _old, _new);
  end if;
  raise exception 'T-1046: stedet blev fundet % gange: %', v_count, left(_old, 120);
end;
$$;

revoke all on function private.patch_function_text(text, text, text) from public, anon, authenticated;

do $$
declare
  definition text;
begin
  -- Uden screening: den aktive version af casens tese (ikke teamets).
  definition := pg_get_functiondef(
    'public.transition_case(uuid, uuid, uuid, public.case_phase, public.case_status, text[], text, uuid, public.audit_actor_type, public.case_phase, uuid, text, uuid, public.case_status)'::regprocedure);
  definition := private.patch_function_text(definition,
    E'    from public.fund_config_versions v\n    where v.fund_id = _fund_id and v.status = ''active''\n    limit 1;',
    E'    from public.fund_config_versions v\n    join public.cases tc on tc.thesis_id = v.thesis_id\n    where tc.id = _case_id and v.fund_id = _fund_id and v.status = ''active''\n    limit 1;');
  execute definition;

  -- Brains tese-side: standardtesens aktive version.
  definition := pg_get_functiondef('public.brain_page_data(uuid, text, uuid)'::regprocedure);
  definition := private.patch_function_text(definition,
    E'          where v.fund_id = _fund_id and v.status = ''active''\n          order by v.version desc limit 1),',
    E'          join public.fund_theses dt on dt.id = v.thesis_id and dt.is_default\n          where v.fund_id = _fund_id and v.status = ''active''\n          order by v.version desc limit 1),');
  execute definition;
end
$$;

-- Cases-listen: _thesis_id (tom = alle ikke-arkiverede teser), og "i gang" måles mod hver cases
-- egen teses aktive version. _config_version_id bruges kun, hvis casens tese ingen har.
do $$
declare
  definition text;
begin
  if to_regprocedure('public.case_list_payload(uuid, uuid, uuid)') is not null then
    return; -- allerede rettet
  end if;
  definition := pg_get_functiondef('public.case_list_payload(uuid, uuid)'::regprocedure);
  definition := private.patch_function_text(definition,
    'public.case_list_payload(_fund_id uuid, _config_version_id uuid)',
    'public.case_list_payload(_fund_id uuid, _config_version_id uuid, _thesis_id uuid DEFAULT NULL::uuid)');
  definition := private.patch_function_text(definition,
    E'      coalesce(c.assigned_to, c.created_by) as assignee_id\n    from public.cases c\n    where c.fund_id = _fund_id\n',
    E'      coalesce(c.assigned_to, c.created_by) as assignee_id, av.id as active_config_id\n    from public.cases c\n    join public.fund_theses th on th.id = c.thesis_id\n    left join public.fund_config_versions av\n      on av.thesis_id = c.thesis_id and av.status = ''active''\n    where c.fund_id = _fund_id\n      and (case when _thesis_id is null then th.status <> ''archived''\n                else c.thesis_id = _thesis_id end)\n');
  definition := private.patch_function_text(definition,
    E'      r.config_version_id, v.version as setup_version\n',
    E'      r.config_version_id, v.version as setup_version, fc.active_config_id\n');
  definition := private.patch_function_text(definition,
    E'    where r.config_version_id = _config_version_id or r.status not in (''queued'', ''running'')',
    E'    where r.config_version_id = coalesce(r.active_config_id, _config_version_id)\n      or r.status not in (''queued'', ''running'')');
  execute definition;
  drop function public.case_list_payload(uuid, uuid);
end
$$;

revoke all on function public.case_list_payload(uuid, uuid, uuid) from public, anon;
grant execute on function public.case_list_payload(uuid, uuid, uuid) to authenticated, service_role;

drop function private.patch_function_text(text, text, text);

commit;
