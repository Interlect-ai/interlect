-- 0124 · "Stoppet på prisgrænsen" (spor B4, produktejeren).
--
-- En kørsel, der rammer sin grænse undervejs, stopper pænt: den står stadig som 'failed' (så
-- afregning, sagens status og alle eksisterende filtre er uændrede), men stop_reason siger hvorfor,
-- og det, der var færdigt, ligger på trinene og genbruges gratis ved næste forsøg. Der er ingen
-- beløb i kolonnen, så browserens rolle må læse den (casens side viser tilstanden uden kroner).
-- Additiv. Ingen data ændres.

begin;

set local lock_timeout = '5s';

alter table public.analysis_runs
  add column stop_reason text
    constraint analysis_runs_stop_reason_check check (stop_reason is null or stop_reason = 'price_limit');

comment on column public.analysis_runs.stop_reason is
  'Hvorfor en fejlet kørsel stoppede: price_limit = den ramte sin prisgrænse. Null = en anden fejl.';

grant select (stop_reason) on public.analysis_runs to authenticated;

commit;
