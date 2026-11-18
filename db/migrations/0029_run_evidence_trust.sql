-- D-13 (opsamling): datatillid i lister. Statusfordelingen af den evidens, en kørsel faktisk
-- brugte (input_evidence_ids), talt i databasen, så caselisten ikke skal hente hundredvis af
-- evidensrækker pr. case. Samme regel som båndet i screening og dyb analyse (D-10): kun
-- kørslens egen evidens.
--
-- security_invoker: viewet læser med den spørgendes rettigheder, så RLS på analysis_runs og
-- evidence_items gælder uændret (kun egne fonde). Kun authenticated må læse det; spørg med
-- brugerens egen klient (service-klienten ser alle fonde).

begin;

create view public.analysis_run_evidence_trust
with (security_invoker = true)
as
select
  r.id as run_id,
  r.fund_id,
  r.case_id,
  count(e.id) filter (where e.status = 'verified') as verified,
  count(e.id) filter (where e.status = 'corroborated') as corroborated,
  count(e.id) filter (where e.status = 'company_stated') as company_stated,
  count(e.id) filter (where e.status = 'contradictory') as contradictory,
  count(e.id) filter (where e.status = 'unknown') as unknown,
  count(e.id) as total
from public.analysis_runs r
left join public.evidence_items e
  on e.id = any (r.input_evidence_ids)
  and e.fund_id = r.fund_id
  and e.case_id = r.case_id
group by r.id, r.fund_id, r.case_id;

-- Kun læseret: viewet kan ikke skrives til, men standardrettighederne ville give mere.
revoke all on public.analysis_run_evidence_trust from public, anon, authenticated;
grant select on public.analysis_run_evidence_trust to authenticated, service_role;

-- Opfølgning på 0027 (PG 17): MAINTAIN (VACUUM/ANALYZE/REINDEX/LOCK) er ikke omfattet af RLS
-- og bruges ikke af appen.
revoke maintain on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public
  revoke maintain on tables from authenticated;

commit;
