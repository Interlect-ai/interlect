-- 0131 · Månedsgrænsen holder også ved afregning, og en kørsel afregnes med sin egen kurs
--        (fund fra /harden på spor B, 4. nov).
--
-- Tre fejl i afregningen (ai_settle_analysis_runs, 0114):
--
--   1. En kendt pris blev bogført, også når den var højere end reservationen. Kørslens loft er det
--      højeste, en analyse må koste (spec B.0), og reservationen er loftet, så teamets måned kunne
--      ende over grænsen (C4-3). Nu bogføres en kendt pris højst til reservationen, som en ukendt
--      pris med gemt grænse allerede gjorde.
--   2. En reservation, der blev frigivet som hængende efter 24 timer (ai_release_stale, 0077), gav
--      månedens plads til andre kørsler. Endte kørslen senere med en pris, blev den bogført igen
--      til fuld pris uden tjek mod månedsgrænsen (C4-3, B.4 test 6). Nu bogføres en frigivet række
--      højst til kørslens eget loft (det, der blev reserveret) og højst til det, der er tilbage af
--      teamets månedsgrænse i den måned, rækken hører til. Den venter, så længe en anden kørsel i
--      samme måned stadig har en reservation: målt mod hele den reservation ville rækken blive
--      bogført for lavt for altid. Rækkerne bogføres én ad gangen, så to aldrig deler samme plads.
--   3. Afregningen omregnede med den aktuelle kurs i ai_settings, mens kørslens loft og gennemsnittene
--      under Analysegrænser bruger kursen, kørslen blev sat op med (analysis_runs.usd_to_dkk, 0123).
--      Efter en kursændring passede månedens tal og gennemsnittene ikke sammen (S2-4, B.4 test 7). Nu
--      afregnes med kørslens kurs; en kørsel fra før 0123 (null) afregnes med ai_settings som før.
--
-- Bogføres en række lavere end kørslens pris på grund af loftet eller månedsgrænsen, står det i
-- rækkens note ("afregnet til loftet" / "afregnet til månedsgrænsen"), så afstemningen
-- (scripts/analysis-reconcile.ts) kan skelne det fra en fejl.
--
-- public.ai_analysis_month_used(fund, månedens start) er månedens forbrug for én måned, og
-- fund_analysis_month (0125) bruger den nu for den aktuelle måned; tallet er det samme som før.
-- Måneden følger stadig UTC som resten af kreditbogen.
--
-- Ingen tabel eller kolonne ændres. Funktionerne har samme navn, argumenter og svar, og koden kalder
-- dem som før (via ai_reserve og ai_settle_now).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Teamets forbrug af analysekørsler i én måned (UTC), i kr.
-- ---------------------------------------------------------------------------
create or replace function public.ai_analysis_month_used(_fund_id uuid, _month_start timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
  -- Kun en analysekørsels egen række (ingen loop, et kørsels-id), reserveret med sit loft eller
  -- afregnet med sin pris, som i 0125.
  select coalesce(sum(l.amount_dkk), 0)
    from public.ai_credit_ledger l
   where l.kind = 'usage'
     and l.scope = 'analysis'
     and l.fund_id = _fund_id
     and l.ref_id is not null
     and l.loop is null
     and l.status in ('reserved', 'final')
     and l.created_at >= _month_start
     and l.created_at < _month_start + interval '1 month';
$$;

create or replace function public.fund_analysis_month(_fund_id uuid)
returns table (cap_dkk numeric, used_dkk numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select case when f.monthly_cap_dkk is null then null
              else least(f.monthly_cap_dkk, s.platform_monthly_cap_dkk) end,
         public.ai_analysis_month_used(f.id, date_trunc('month', now(), 'UTC'))
  from public.funds f
  cross join public.ai_settings s
  where f.id = _fund_id and s.id
$$;

-- ---------------------------------------------------------------------------
-- 2. Afregningen.
-- ---------------------------------------------------------------------------
create or replace function public.ai_settle_analysis_runs()
returns integer
language plpgsql
security definer
set search_path = ''
-- En måned er en UTC-måned, også når sessionen har en anden tidszone ("+ 1 month").
set timezone = 'UTC'
as $$
declare
  v_rate numeric;
  v_count integer;
  v_rebooked integer := 0;
  v_row record;
  v_cap numeric;
  v_limit numeric;
  v_month_start timestamptz;
  v_amount numeric;
  v_note text;
begin
  select s.usd_to_dkk into v_rate from public.ai_settings s where s.id for update;

  -- En kørsel, der ikke længere er i gang (alt andet end queued og running, også awaiting_approval),
  -- afregnes med sin egen kurs. Kendt pris → prisen. Ukendt pris (actual_cost er null) → kørslens
  -- loft over forbruget (validation_result.budget.chargedUsd, T-896). Begge højst reservationen.
  -- Uden nogen af dem: en gennemført kørsel → reservationen, en fejlet eller annulleret → 0 kr.
  update public.ai_credit_ledger l
     set status = 'final',
         amount_dkk = case
           when p.price_dkk is not null then least(l.amount_dkk, p.price_dkk)
           when r.status in ('complete', 'awaiting_approval') then l.amount_dkk
           else 0
         end,
         note = case
           when p.price_dkk > l.amount_dkk then coalesce(l.note || ' · ', '') || 'afregnet til loftet'
           else l.note
         end,
         requests = 1
    from public.analysis_runs r
    cross join lateral (
      select coalesce(
               round(r.actual_cost * coalesce(r.usd_to_dkk, v_rate), 6),
               round(public.ai_run_charged_usd(r.validation_result) * coalesce(r.usd_to_dkk, v_rate), 6)
             ) as price_dkk
    ) p
   where l.kind = 'usage'
     and l.scope = 'analysis'
     and l.status = 'reserved'
     and l.ref_id = r.id
     and r.status not in ('queued', 'running');
  get diagnostics v_count = row_count;

  -- En række, der blev frigivet som hængende, bogfører stadig, hvad kørslen endte med at koste, men
  -- højst kørslens eget loft (det reserverede: estimated_cost er planens dollars, cost_cap_dkk dens
  -- kroner) og højst det, der er tilbage af teamets månedsgrænse i rækkens måned. Én ad gangen og i
  -- den rækkefølge, de blev reserveret, så hver række ser de foregående.
  -- "loop" er citeret: i en FOR-løkke læser PL/pgSQL forespørgslen frem til ordet loop.
  for v_row in
    select l.id,
           l.fund_id,
           (l."loop" is null) as run_row,
           l.note,
           l.created_at,
           r.cost_cap_dkk,
           round(r.estimated_cost * coalesce(r.usd_to_dkk, v_rate), 6) as reserved_dkk,
           coalesce(
             round(r.actual_cost * coalesce(r.usd_to_dkk, v_rate), 6),
             round(public.ai_run_charged_usd(r.validation_result) * coalesce(r.usd_to_dkk, v_rate), 6)
           ) as price_dkk
      from public.ai_credit_ledger l
      join public.analysis_runs r on r.id = l.ref_id
     where l.kind = 'usage'
       and l.scope = 'analysis'
       and l.status = 'released'
       and r.status not in ('queued', 'running')
       and (
         coalesce(r.actual_cost, 0) > 0
         or (r.actual_cost is null and coalesce(public.ai_run_charged_usd(r.validation_result), 0) > 0)
       )
     order by l.created_at, l.id
  loop
    v_amount := v_row.price_dkk;
    v_note := null;
    -- least() springer null over: null kun når kørslen hverken har loft eller planpris.
    v_limit := least(v_row.cost_cap_dkk, v_row.reserved_dkk);
    if v_limit is not null and v_limit < v_amount then
      v_amount := v_limit;
      v_note := 'afregnet til loftet';
    end if;
    if v_row.fund_id is not null and v_row.run_row then
      select case when f.monthly_cap_dkk is null then null
                  else least(f.monthly_cap_dkk, s.platform_monthly_cap_dkk) end
        into v_cap
        from public.funds f
        cross join public.ai_settings s
       where f.id = v_row.fund_id and s.id;
      if v_cap is not null then
        v_month_start := date_trunc('month', v_row.created_at, 'UTC');
        -- En anden kørsel i måneden har stadig en reservation: vent til næste afregning, når dens
        -- pris er kendt, ellers bliver rækken målt mod hele reservationen og bogført for lavt.
        if exists (
          select 1
            from public.ai_credit_ledger o
           where o.fund_id = v_row.fund_id
             and o.kind = 'usage'
             and o.scope = 'analysis'
             and o.status = 'reserved'
             and o.ref_id is not null
             and o."loop" is null
             and o.created_at >= v_month_start
             and o.created_at < v_month_start + interval '1 month'
        ) then
          continue;
        end if;
        v_cap := greatest(v_cap - public.ai_analysis_month_used(v_row.fund_id, v_month_start), 0);
        if v_cap < v_amount then
          v_amount := v_cap;
          v_note := 'afregnet til månedsgrænsen';
        end if;
      end if;
    end if;
    update public.ai_credit_ledger
       set status = 'final',
           amount_dkk = v_amount,
           requests = 1,
           note = case when v_note is null then note else coalesce(note || ' · ', '') || v_note end
     where id = v_row.id;
    v_rebooked := v_rebooked + 1;
  end loop;

  return v_count + v_rebooked;
end;
$$;

revoke all on function public.ai_analysis_month_used(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_analysis_month_used(uuid, timestamptz) to service_role;

commit;
