-- Rettelser efter review. Ingen nye tabeller; kun funktioner, et view og
-- rettigheder.
-- 1. Overgangsloggen (0033) afviste enhver ændring, også når Postgres selv nulstiller en
--    henvisning (ON DELETE SET NULL). Så kunne en fond med en dyb analyse i loggen ikke slettes:
--    delete_fund sletter analysis_runs, og nulstillingen af analysis_run_id blev afvist. Nu må
--    netop analysis_run_id og config_version_id sættes til null, og kun af en fremmednøgle
--    (pg_trigger_depth() > 1); alt andet i loggen er stadig uforanderligt.
-- 2. brain_case_decisions (0033) mistede en afgørelse, når en senere overgang blev fortrudt
--    (fx genåbn → fortryd): viewet så kun på den seneste hændelse. Nu vises casens seneste
--    afgørelse, som ikke selv er fortrudt, når casen står som Besluttet. Samme kolonner.
-- 3. Fire interne triggerfunktioner (security definer) kunne kaldes af indloggede brugere via
--    API'et (Supabase-advisoren). Postgres afviser sådanne kald, men rettigheden fjernes.
--    Triggere kører uden EXECUTE-rettighed, så intet ændrer sig for appen.

begin;

set local lock_timeout = '5s';
set local search_path = public, extensions;

create or replace function public.case_transition_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1
       or not exists (select 1 from public.cases c where c.id = old.case_id) then
      return old;
    end if;
    raise exception 'Overgangsloggen kan ikke slettes.';
  end if;
  if coalesce(current_setting('brain.gdpr', true), '') = 'on' then
    return new;
  end if;
  if (to_jsonb(new) - 'reason_codes' - 'reason_confidence')
     = (to_jsonb(old) - 'reason_codes' - 'reason_confidence') then
    return new;
  end if;
  -- ON DELETE SET NULL fra analysis_runs eller fund_config_versions: kun de to henvisninger
  -- må blive null, og kun når ændringen kommer fra fremmednøglen (en trigger i en trigger).
  if pg_trigger_depth() > 1
     and (to_jsonb(new) - 'analysis_run_id' - 'config_version_id')
       = (to_jsonb(old) - 'analysis_run_id' - 'config_version_id')
     and (new.analysis_run_id is null or new.analysis_run_id = old.analysis_run_id)
     and (new.config_version_id is null or new.config_version_id = old.config_version_id) then
    return new;
  end if;
  raise exception 'Overgangsloggen kan ikke ændres.';
end;
$$;

create or replace view public.brain_case_decisions
with (security_invoker = true)
as
select latest.fund_id,
       latest.case_id,
       c.company_id,
       latest.movement_kind as decision_kind,
       latest.occurred_at as decided_at,
       latest.reason_codes,
       false as is_historical
from public.cases c
join lateral (
  select e.*
  from public.case_transition_events e
  where e.case_id = c.id
    and e.fund_id = c.fund_id
    and e.movement_kind in ('reject', 'decline_ic', 'invest')
    and e.undo_of is null
    and not exists (
      select 1 from public.case_transition_events u where u.undo_of = e.id
    )
  order by e.occurred_at desc, e.id desc
  limit 1
) as latest on true
where c.phase = 'decided';

revoke execute on function public.case_score_recalculations_append_only() from public, anon, authenticated;
revoke execute on function public.case_tasks_check_assignee() from public, anon, authenticated;
revoke execute on function public.case_transition_events_append_only() from public, anon, authenticated;
revoke execute on function public.seed_reason_codes_for_new_fund() from public, anon, authenticated;

commit;
