-- 0114 · Kreditter: en analyse med ukendt pris afregnes til sit eget loft over forbruget, ikke til
--        hele reservationen eller 0 kr. (Brain).
--
-- Fundet: Sonarworks' screening i "Interlect Demo" stod med 0,00 kr. Prisen var
-- ikke 0, men ukendt (actual_cost null): researchens første refleksion fejlede, efter kaldet var
-- sendt, så dens pris kunne ikke kendes, og dermed heller ikke researchens samlede pris
-- (sumCompleteCosts). ai_settle_analysis_runs (0071, 0077) afregnede derfor den gennemførte
-- screening til hele reservationen: 10,63 kr. for en kørsel, der kostede ca. 1,9 kr. Omvendt
-- afregnes en fejlet kørsel med ukendt pris til 0 kr., også når den nåede at bruge penge.
--
-- Kørslen gemmer allerede, hvad den har trukket mod sit budget (validation_result.budget.chargedUsd):
-- de kendte priser plus maksimum for hvert kald uden pris. Det er en øvre grænse for, hvad kørslen
-- kostede, og den ligger tæt på prisen (Sonarworks: 0,247 USD = 1,71 kr.).
--
--   1. ai_run_charged_usd(validation_result) læser grænsen. Kun et ikke-negativt tal tæller; alt
--      andet er null, så en forkert række aldrig får afregningen (og dermed ai_reserve) til at fejle.
--   2. ai_settle_analysis_runs: kendt pris → prisen (som før). Ukendt pris og en gemt grænse →
--      grænsen, dog højst rækkens reservation. Uden grænse som før: gennemført → reservationen,
--      fejlet eller annulleret → 0 kr. En frigivet række bogføres nu også, når kørslen endte med
--      ukendt pris og en grænse over 0 (før kun ved en kendt pris over 0). Det gælder også en
--      gammel frigivet række (første afregning efter migrationen); på staging var der ingen.
--   3. Allerede afregnede kørsler, der er gennemført med ukendt pris og en gemt grænse, men blev
--      bogført over grænsen, sættes ned til grænsen. Kun ned, aldrig op; saldoen følger med via
--      triggeren fra 0077.
--
-- Ingen tabel eller kolonne ændres. Funktionen har samme navn, argumenter og svar, og koden
-- kalder den som før (via ai_reserve).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Kørslens loft over forbruget i USD, eller null.
-- ---------------------------------------------------------------------------
create or replace function public.ai_run_charged_usd(_validation jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  -- CASE i to trin: castet køres kun på et JSON-tal.
  select case
    when jsonb_typeof(_validation #> '{budget,chargedUsd}') = 'number' then
      case
        when (_validation #>> '{budget,chargedUsd}')::numeric >= 0
          then (_validation #>> '{budget,chargedUsd}')::numeric
      end
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Afregningen (som 0077, med grænsen for en ukendt pris).
-- ---------------------------------------------------------------------------
create or replace function public.ai_settle_analysis_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
  v_count integer;
begin
  select s.usd_to_dkk into v_rate from public.ai_settings s where s.id for update;
  -- En kørsel, der ikke længere er i gang (alt andet end queued og running, også awaiting_approval,
  -- hvor en screening venter på godkendelse), afregnes. Kendt pris → prisen. Ukendt pris (actual_cost
  -- er null, fordi et kald ikke rapporterede sin pris) → kørslens loft over forbruget
  -- (validation_result.budget.chargedUsd), højst reservationen (T-896). Uden loft: en gennemført
  -- kørsel afregnes til reservationen, ikke til 0 kr., og på en fejlet eller annulleret kørsel er
  -- null "intet brugt". En række, der blev frigivet som hængende, bogfører stadig prisen eller
  -- loftet, hvis kørslen senere endte med et af dem over 0.
  update public.ai_credit_ledger l
     set status = 'final',
         amount_dkk = case
           when r.actual_cost is not null then round(r.actual_cost * v_rate, 6)
           when public.ai_run_charged_usd(r.validation_result) is not null and l.status = 'reserved'
             then least(l.amount_dkk, round(public.ai_run_charged_usd(r.validation_result) * v_rate, 6))
           when public.ai_run_charged_usd(r.validation_result) is not null
             then round(public.ai_run_charged_usd(r.validation_result) * v_rate, 6)
           when r.status in ('complete', 'awaiting_approval') and l.status = 'reserved' then l.amount_dkk
           else 0
         end,
         requests = 1
    from public.analysis_runs r
   where l.kind = 'usage'
     and l.scope = 'analysis'
     and l.ref_id = r.id
     and r.status not in ('queued', 'running')
     and (
       l.status = 'reserved'
       or (
         l.status = 'released'
         and (
           coalesce(r.actual_cost, 0) > 0
           or (r.actual_cost is null and coalesce(public.ai_run_charged_usd(r.validation_result), 0) > 0)
         )
       )
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Allerede afregnede gennemførte kørsler med ukendt pris: ned til loftet.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rate numeric;
begin
  -- Samme låserækkefølge som afregningen (ai_settings, så kreditbogen).
  select s.usd_to_dkk into v_rate from public.ai_settings s where s.id for update;
  if v_rate is null then
    return;
  end if;
  update public.ai_credit_ledger l
     set amount_dkk = round(public.ai_run_charged_usd(r.validation_result) * v_rate, 6)
    from public.analysis_runs r
   where l.kind = 'usage'
     and l.scope = 'analysis'
     and l.status = 'final'
     and l.ref_id = r.id
     and r.status in ('complete', 'awaiting_approval')
     and r.actual_cost is null
     and public.ai_run_charged_usd(r.validation_result) is not null
     and round(public.ai_run_charged_usd(r.validation_result) * v_rate, 6) < l.amount_dkk;
end;
$$;

revoke all on function public.ai_run_charged_usd(jsonb) from public, anon, authenticated;
grant execute on function public.ai_run_charged_usd(jsonb) to service_role;

commit;
