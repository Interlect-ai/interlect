-- 0133 · Teamopsætning pr. stadie: skemaet (session 1, afsnit 3 og 4; beslutningslog 15. nov 2026).
--
-- 1. stage (nullable tekst) på assessment_criteria, mandate_gates, fund_specialists og
--    prompt_module_overrides. Tilladt er de syv stadienøgler pre_seed, seed, series_a, series_b
--    ("Series B+" i prototypen), later, growth og buyout: company_stage uden 'unknown'.
--    stage = null betyder det samme som i dag: rækken gælder alle stadier. Det er alle rækker i
--    de gamle versioner og tesens delte indhold i de nye.
-- 2. De unikke nøgler bliver (config_version_id, stage, nøgle) med nulls not distinct: samme nøgle
--    kan stå én gang pr. stadie og én gang uden stadie, og to rækker uden stadie med samme nøgle
--    afvises som før. ON CONFLICT skal derfor nævne stage; serveren er rettet i samme PR.
-- 3. fund_mandates.setup (jsonb, standard '{}'): det af opsætningen, der ikke er rækker.
--      about        teksten "Hvem er I, og hvordan tænker I?" (højst 3.000 tegn som
--                   screening_instruction, som den afløser i det nye UI; de gamle felter bliver)
--      fixed_rules  rettelser til de 9 redigerbare faste regler: {regel-id: tekst}; en regel uden
--                   nøgle har standardteksten ("Nulstil" fjerner nøglen)
--      stages       {stadienøgle: {...}}: økonomipunkter, egne spørgsmål og tilstanden pr. liste
--                   (slået til/fra, redigeret/standard). Indholdet pr. stadie fastlægges og
--                   tjekkes af serveren (til); databasen tjekker stadienøglerne.
--    public.fund_setup_ok afviser andre nøgler øverst, ukendte stadier og over 128 KiB.
-- 4. private.copy_fund_config_content kopierer stage og setup. Alle tre veje til en ny version
--    bruger den: create_fund_config_draft (0127), create_thesis_from (0127) og
--    restore_fund_config_version (0129). De ældre redefinitioner af create_fund_config_draft
--    (0003, 0008, 0012, 0016, 0026, 0028, 0076, 0078) gælder ikke længere, ændres ikke og køres
--    aldrig igen (schema_migrations; en ændret fil stopper kørslen).
--    scripts/test-setup-per-stage-db.mjs låser, at de tre funktioner kopierer via hjælperen.
-- 5. Låsen på en udgivet version (0031 og 0076) gælder hele rækken og dermed også stage og setup.
--    Ingen ændring her; testen beviser det.
-- RLS og grants er uændrede: kolonnerne ligger på teamets egne rækker og følger de samme regler
-- (Admin og Lead skriver kun i kladder). Ingen backfill: ingen eksisterende række ændres.
-- Kan køres igen (if not exists / drop if exists / create or replace).

begin;

set local lock_timeout = '5s';

-- Låsene tages med det samme og i samme rækkefølge som private.copy_fund_config_content (mandat
-- først), så en kladde, der laves samtidig, venter i stedet for at give en deadlock.
lock table public.fund_mandates, public.mandate_gates, public.assessment_criteria,
  public.prompt_module_overrides, public.fund_specialists in access exclusive mode;

-- 1 og 2. stage og de unikke nøgler --------------------------------------------------------------

do $$
declare
  t record;
  c record;
begin
  for t in
    select * from (values
      ('assessment_criteria', 'criterion_key'),
      ('mandate_gates', 'gate_key'),
      ('fund_specialists', 'specialist_key'),
      ('prompt_module_overrides', 'module_id')
    ) as v (tbl, key_col)
  loop
    execute format('alter table public.%I add column if not exists stage text', t.tbl);
    execute format('alter table public.%I drop constraint if exists %I', t.tbl, t.tbl || '_stage_known');
    execute format(
      $sql$alter table public.%I add constraint %I check (stage is null or stage = any (array[
        'pre_seed', 'seed', 'series_a', 'series_b', 'later', 'growth', 'buyout']::text[]))$sql$,
      t.tbl, t.tbl || '_stage_known');

    -- Den gamle nøgle (config_version_id, nøgle) findes ud fra kolonnerne, ikke navnet.
    for c in
      select con.conname
      from pg_constraint con
      where con.conrelid = format('public.%I', t.tbl)::regclass
        and con.contype = 'u'
        and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = any (con.conkey))
            = array(select x from unnest(array['config_version_id', t.key_col]) as x order by x)
    loop
      execute format('alter table public.%I drop constraint %I', t.tbl, c.conname);
    end loop;

    execute format('alter table public.%I drop constraint if exists %I', t.tbl, t.tbl || '_version_stage_key');
    execute format(
      'alter table public.%I add constraint %I unique nulls not distinct (config_version_id, stage, %I)',
      t.tbl, t.tbl || '_version_stage_key', t.key_col);

    -- Ingen unik nøgle uden stadie må blive tilbage, heller ikke som et løst indeks.
    if exists (
      select 1
      from pg_index i
      where i.indrelid = format('public.%I', t.tbl)::regclass
        and i.indisunique
        and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any (i.indkey::int2[]))
            = array(select x from unnest(array['config_version_id', t.key_col]) as x order by x)
    ) then
      raise exception 'Den gamle unikke nøgle (config_version_id, %) på % findes stadig.',
        t.key_col, t.tbl;
    end if;

    execute format(
      'comment on column public.%I.stage is %L', t.tbl,
      'T-1091: stadiet rækken gælder (pre_seed, seed, series_a, series_b, later, growth, buyout). '
      || 'null = alle stadier: de gamle versioner og tesens delte indhold. Unik nøgle: '
      || '(config_version_id, stage, ' || t.key_col || ') med nulls not distinct.');
  end loop;
end
$$;

-- 3. fund_mandates.setup -------------------------------------------------------------------------

create or replace function public.fund_setup_ok(_setup jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry record;
begin
  if _setup is null then return true; end if;
  if jsonb_typeof(_setup) <> 'object' then return false; end if;
  if octet_length(_setup::text) > 131072 then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(_setup) as k (key)
    where k.key <> all (array['about', 'fixed_rules', 'stages'])
  ) then
    return false;
  end if;

  if _setup ? 'about' and (
    jsonb_typeof(_setup -> 'about') <> 'string' or char_length(_setup ->> 'about') > 3000
  ) then
    return false;
  end if;

  if _setup ? 'fixed_rules' then
    if jsonb_typeof(_setup -> 'fixed_rules') <> 'object' then return false; end if;
    for v_entry in select key, value from jsonb_each(_setup -> 'fixed_rules') loop
      if v_entry.key !~ '^[a-z0-9_]{1,60}$'
         or jsonb_typeof(v_entry.value) <> 'string'
         or char_length(btrim(v_entry.value #>> '{}')) not between 1 and 600 then
        return false;
      end if;
    end loop;
  end if;

  if _setup ? 'stages' then
    if jsonb_typeof(_setup -> 'stages') <> 'object' then return false; end if;
    for v_entry in select key, value from jsonb_each(_setup -> 'stages') loop
      if v_entry.key <> all (array[
           'pre_seed', 'seed', 'series_a', 'series_b', 'later', 'growth', 'buyout'])
         or jsonb_typeof(v_entry.value) <> 'object' then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

revoke all on function public.fund_setup_ok(jsonb) from public, anon;
grant execute on function public.fund_setup_ok(jsonb) to authenticated, service_role;

alter table public.fund_mandates add column if not exists setup jsonb not null default '{}'::jsonb;
alter table public.fund_mandates drop constraint if exists fund_mandates_setup_ok;
alter table public.fund_mandates
  add constraint fund_mandates_setup_ok check (public.fund_setup_ok(setup));

comment on column public.fund_mandates.setup is
  'T-1091: det af opsætningen, der ikke er rækker. about (Hvem er I, og hvordan tænker I?, højst '
  '3.000 tegn), fixed_rules ({regel-id: tekst} for de 9 redigerbare faste regler) og stages '
  '({stadienøgle: {...}}: økonomipunkter, egne spørgsmål, tilstanden pr. liste). Tjekkes af '
  'public.fund_setup_ok; indholdet pr. stadie tjekkes af serveren.';

-- 4. Kopien til en ny version tager stage og setup med ------------------------------------------

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
     strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards,
     setup)
  select _to, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards,
    setup
  from public.fund_mandates where config_version_id = _from;

  insert into public.mandate_gates
    (config_version_id, stage, gate_key, label, description, treatment, sort_order)
  select _to, stage, gate_key, label, description, treatment, sort_order
  from public.mandate_gates where config_version_id = _from;

  insert into public.assessment_criteria
    (config_version_id, stage, criterion_key, label, description, score_category, weight,
     sort_order, code_anchor)
  select _to, stage, criterion_key, label, description, score_category, weight, sort_order,
    code_anchor
  from public.assessment_criteria where config_version_id = _from;

  insert into public.fund_profile_sources
    (config_version_id, label, url, supports, source_type, collected_at)
  select _to, label, url, supports, source_type, collected_at
  from public.fund_profile_sources where config_version_id = _from;

  insert into public.prompt_module_overrides
    (config_version_id, stage, module_id, mandate, evidence_tests, risk_areas, updated_by)
  select _to, stage, module_id, mandate, evidence_tests, risk_areas, auth.uid()
  from public.prompt_module_overrides where config_version_id = _from;

  insert into public.research_module_overrides
    (config_version_id, mode, module_id, questions, updated_by)
  select _to, mode, module_id, questions, auth.uid()
  from public.research_module_overrides where config_version_id = _from;

  insert into public.fund_specialists
    (config_version_id, stage, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
     evidence_tests, risk_areas, research_questions, output_focus, categories, updated_by)
  select _to, stage, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
    evidence_tests, risk_areas, research_questions, output_focus, categories, auth.uid()
  from public.fund_specialists where config_version_id = _from;
end;
$$;

revoke all on function private.copy_fund_config_content(uuid, uuid) from public, anon, authenticated;

commit;
