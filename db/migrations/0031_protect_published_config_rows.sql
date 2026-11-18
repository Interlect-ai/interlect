-- Princip 2 (auditspor): en publiceret fondsprofil er låst til de analyser, der blev kørt
-- med den. fund_config_versions er allerede beskyttet (0002), men versionens indhold
-- (mandat, gates, kriterier, kilder og prompt-/researchtilpasninger) kunne stadig ændres
-- eller slettes af server-kode med service-rollen, som ikke er underlagt RLS. Brugere kan i
-- forvejen kun skrive i kladder (RLS).
--
-- Triggeren afviser UPDATE og DELETE af en række, hvis versionen findes og ikke er en
-- kladde. En fond, der slettes, sletter først versionen og derefter rækkerne (cascade);
-- versionen findes så ikke længere, og sletningen tillades. INSERT røres ikke, så
-- oprettelse af en ny fond virker som før. Seed-scriptet (db/bootstrap) opdaterer aktive
-- versioner med ON CONFLICT DO UPDATE og kan derfor ikke længere køres igen mod en
-- eksisterende database; det er tilsigtet. Når en bruger slettes, sætter databasen
-- updated_by til null; den ene ændring tillades.

begin;

set local lock_timeout = '5s';

create or replace function public.protect_published_config_rows()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.fund_config_status;
begin
  -- Sletning af en bruger (ON DELETE SET NULL på updated_by) må gå igennem.
  if tg_op = 'UPDATE'
     and to_jsonb(new) ? 'updated_by'
     and to_jsonb(new) -> 'updated_by' = 'null'::jsonb
     and (to_jsonb(new) - 'updated_by') = (to_jsonb(old) - 'updated_by') then
    return new;
  end if;
  select status into v_status
  from public.fund_config_versions
  where id = old.config_version_id;
  if found and v_status <> 'draft'::public.fund_config_status then
    raise exception 'Publicerede fondsprofilversioner er uforanderlige (%).', tg_table_name;
  end if;
  if tg_op = 'UPDATE' and new.config_version_id is distinct from old.config_version_id then
    select status into v_status
    from public.fund_config_versions
    where id = new.config_version_id;
    if found and v_status <> 'draft'::public.fund_config_status then
      raise exception 'Publicerede fondsprofilversioner er uforanderlige (%).', tg_table_name;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_published_config_rows() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'fund_mandates', 'mandate_gates', 'assessment_criteria', 'fund_profile_sources',
    'prompt_module_overrides', 'research_module_overrides'
  ] loop
    execute format(
      'create or replace trigger %I before update or delete on public.%I
         for each row execute function public.protect_published_config_rows()',
      t || '_published_immutable',
      t
    );
  end loop;
end $$;

commit;
