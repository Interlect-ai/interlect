-- Kun administrator og partner må ændre fondsopsætningen.
-- Analytikeren kan se den (uændret) og foreslå ændringer.
--
-- Én fælles regel, can_configure_fund, erstatter "kun administrator" i præcis de regler,
-- der styrer fondsopsætningen (tese-versioner, mandat, gates, kriterier, kilder,
-- prompt- og research-tilpasninger, historiske investeringer) og i de tre funktioner,
-- der opretter, gemmer og publicerer en version. Brugere, invitationer, fondens navn og
-- mail-intake forbliver kun administrator.
--
-- Reglerne omskrives mekanisk fra deres nuværende definition, og migrationen fejler,
-- hvis en omskrivning ikke rammer, så intet ændres halvt.

begin;

-- Policy-teksten gemmes uden skemanavn; fast search_path gør omskrivningen forudsigelig.
set local search_path = public, extensions;

create or replace function public.can_configure_fund(_user_id uuid, _fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_fund_role(_user_id, _fund_id, 'administrator')
      or public.has_fund_role(_user_id, _fund_id, 'partner');
$$;

revoke all on function public.can_configure_fund(uuid, uuid) from public, anon;
grant execute on function public.can_configure_fund(uuid, uuid) to authenticated, service_role;

-- 1. Policies på fondsopsætningens tabeller.
do $$
declare
  p record;
  new_qual text;
  new_check text;
  pattern constant text := 'has_fund_role\(auth\.uid\(\), ([a-z_.]+), ''administrator''::app_role\)';
  replacement constant text := 'public.can_configure_fund(auth.uid(), \1)';
  changed integer := 0;
begin
  for p in
    select *
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'fund_config_versions', 'fund_mandates', 'mandate_gates', 'assessment_criteria',
        'fund_profile_sources', 'prompt_module_overrides', 'research_module_overrides',
        'historical_investments'
      )
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%''administrator''%'
  loop
    new_qual := case when p.qual is null then null
                else regexp_replace(p.qual, pattern, replacement, 'g') end;
    new_check := case when p.with_check is null then null
                 else regexp_replace(p.with_check, pattern, replacement, 'g') end;
    if coalesce(new_qual, '') || coalesce(new_check, '') like '%''administrator''%' then
      raise exception 'Policy %.% blev ikke omskrevet fuldt ud.', p.tablename, p.policyname;
    end if;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format(
      'create policy %I on public.%I as %s for %s to %s %s %s',
      p.policyname,
      p.tablename,
      p.permissive,
      p.cmd,
      array_to_string(p.roles, ', '),
      case when new_qual is null then '' else format('using (%s)', new_qual) end,
      case when new_check is null then '' else format('with check (%s)', new_check) end
    );
    raise notice 'Omskrevet policy %.%', p.tablename, p.policyname;
    changed := changed + 1;
  end loop;
  if changed < 8 then
    raise exception 'Forventede mindst 8 policies at omskrive, fandt %.', changed;
  end if;
end $$;

-- 2. Funktionerne, der opretter, gemmer og publicerer en version af fondsopsætningen.
do $$
declare
  f record;
  definition text;
  changed integer := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_fund_config_draft', 'save_fund_config_draft', 'activate_fund_config')
  loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(
      definition,
      'public\.has_fund_role\(auth\.uid\(\), ([a-z_.]+), ''administrator''\)',
      'public.can_configure_fund(auth.uid(), \1)',
      'g'
    );
    definition := replace(definition, 'Kun en administrator kan', 'Kun en administrator eller partner kan');
    if definition like '%has_fund_role(auth.uid(), %''administrator'')%' then
      raise exception 'Funktionen % blev ikke omskrevet fuldt ud.', f.proname;
    end if;
    execute definition;
    changed := changed + 1;
  end loop;
  if changed <> 3 then
    raise exception 'Forventede 3 funktioner, fandt %.', changed;
  end if;
end $$;

commit;
