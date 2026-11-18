-- Sletning af en hel fond (arbejdslisten 27. sep). To fejl gjorde, at en fond ikke kunne
-- slettes, også før redesignet:
-- 1. Reglen "mindst én aktiv Admin" (0001) slog også til, når hele fonden blev slettet, så en
--    fond med en Admin (altså alle) aldrig kunne slettes.
-- 2. scanner_runs.config_version_id er ON DELETE RESTRICT og blev ikke ryddet (0005); det samme
--    gælder analysis_runs (ryddet i koden i et separat kald) og financial_data_points →
--    evidence_items, hvor rækkefølgen i en cascade er tilfældig.
--
-- delete_fund sletter nu alt i én transaktion (kun service_role). Den sætter et flag, som
-- Admin-reglerne kender, rydder de rækker, der ellers blokerer, og sletter fonden; resten følger
-- med som cascade. Serveren fjerner de private filer i storage bagefter (deleteFund).

begin;

set local search_path = public, extensions;

create or replace function public.delete_fund(_fund_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('interlect.deleting_fund', _fund_id::text, true);
  delete from public.financial_data_points where fund_id = _fund_id;
  delete from public.analysis_runs where fund_id = _fund_id;
  delete from public.scanner_signals where fund_id = _fund_id;
  delete from public.scanner_runs where fund_id = _fund_id;
  delete from public.funds where id = _fund_id;
  if not found then
    raise exception 'Fonden blev ikke fundet.';
  end if;
  perform set_config('interlect.deleting_fund', '', true);
end;
$$;

revoke all on function public.delete_fund(uuid) from public, anon, authenticated;
grant execute on function public.delete_fund(uuid) to service_role;

-- Admin-reglerne springer over, mens netop en fond slettes (flaget sættes kun af delete_fund).
do $$
declare
  f record;
  definition text;
  guard constant text := E'begin\n  if coalesce(current_setting(''interlect.deleting_fund'', true), '''') <> '''' then\n    return %s;\n  end if;\n';
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'protect_last_administrator_on_role_delete', 'protect_last_administrator_on_deactivate'
      )
  loop
    definition := pg_get_functiondef(f.oid);
    if definition like '%interlect.deleting_fund%' then
      continue;
    end if;
    if position(E'\nbegin\n' in definition) = 0 then
      raise exception 'Funktionen % har ikke den forventede form.', f.proname;
    end if;
    definition := regexp_replace(
      definition,
      E'\nbegin\n',
      E'\n' || format(
        guard,
        case when f.proname = 'protect_last_administrator_on_role_delete' then 'old' else 'new' end
      ),
      ''
    );
    execute definition;
  end loop;
  if (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'protect_last_administrator_on_%'
      and p.prosrc like '%interlect.deleting_fund%'
  ) <> 2 then
    raise exception 'Admin-reglerne blev ikke opdateret.';
  end if;
end $$;

commit;
