-- 0125 · Månedsgrænse for analyser (spor B5, produktejeren).
--
-- funds.monthly_cap_dkk (0123) håndhæves her. ai_reserve afviser en analysekørsels reservation,
-- når teamets forbrug i måneden plus reservationen passerer grænsen (dog højst
-- ai_settings.platform_monthly_cap_dkk). Forbruget er analysekørslernes rækker i kreditbogen,
-- reserverede med deres loft og afregnede med deres pris; ai_reserve afregner færdige kørsler først,
-- så en afsluttet kørsel tæller med sin faktiske pris. Reservationerne kører én ad gangen under
-- rækkelåsen på ai_settings (0070), så to samtidige kørsler aldrig tilsammen passerer grænsen.
--
-- Måneden følger UTC som resten af kreditbogen. Et team uden månedsgrænse er uændret.
-- public.fund_analysis_month kan kun kaldes af service-rollen: beløbene er for Admin og Lead og
-- læses gennem serveren. Ingen tabel eller data ændres.

begin;

set local lock_timeout = '5s';

create or replace function public.fund_analysis_month(_fund_id uuid)
returns table (cap_dkk numeric, used_dkk numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select case when f.monthly_cap_dkk is null then null
              else least(f.monthly_cap_dkk, s.platform_monthly_cap_dkk) end,
         coalesce((select sum(l.amount_dkk)
                     from public.ai_credit_ledger l
                    where l.kind = 'usage'
                      and l.scope = 'analysis'
                      and l.fund_id = f.id
                      and l.ref_id is not null
                      and l.loop is null
                      and l.status in ('reserved', 'final')
                      and l.created_at >= date_trunc('month', now(), 'UTC')), 0)
  from public.funds f
  cross join public.ai_settings s
  where f.id = _fund_id and s.id
$$;

revoke all on function public.fund_analysis_month(uuid) from public, anon, authenticated;
grant execute on function public.fund_analysis_month(uuid) to service_role;

create or replace function public.ai_reserve(
  _scope text,
  _fund_id uuid,
  _max_usd numeric,
  _loop text default null,
  _ref_id uuid default null,
  _model text default null,
  _user_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
  v_eval_cap numeric;
  v_enforced boolean;
  v_share numeric;
  v_pause numeric;
  v_amount numeric;
  v_available numeric;
  v_month_start timestamptz := date_trunc('month', now(), 'UTC');
  v_added numeric;
  v_month_effect numeric;
  v_opening numeric;
  v_pool numeric;
  v_brain_spent numeric;
  v_allowance numeric;
  v_allowance_used numeric;
  v_month_cap numeric;
  v_month_used numeric;
  v_id bigint;
begin
  -- Korrektheden hviler på READ COMMITTED (nyt snapshot efter rækkelåsen): kald den som et
  -- almindeligt RPC-kald, ikke inde i en REPEATABLE READ- eller SERIALIZABLE-transaktion.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'ai_reserve: must run in READ COMMITTED';
  end if;
  if _scope is null or _scope not in ('analysis', 'chat', 'brain', 'eval') then
    raise exception 'ai_reserve: unknown scope %', _scope;
  end if;
  -- Én reservation dækker ét modelkald eller én analysekørsel.
  if _max_usd is null or _max_usd < 0.000001 or _max_usd > 200 then
    raise exception 'ai_reserve: invalid amount %', _max_usd;
  end if;
  if _fund_id is not null
     and not exists (select 1 from public.funds f where f.id = _fund_id) then
    raise exception 'ai_reserve: unknown fund';
  end if;

  -- Rækkelåsen serialiserer alle reservationer i installationen.
  select s.usd_to_dkk, s.eval_monthly_cap_dkk, s.credits_enforced,
         s.brain_share_pct, s.brain_pause_at_remaining_pct
    into v_rate, v_eval_cap, v_enforced, v_share, v_pause
  from public.ai_settings s
  where s.id
  for update;
  if not found then
    raise exception 'ai_reserve: ai_settings row missing';
  end if;

  -- Selvhelbredelse under låsen: færdige kørsler afregnes, hængende reservationer frigives.
  perform public.ai_settle_analysis_runs();
  perform public.ai_release_stale(interval '3 hours');

  v_amount := round(_max_usd * v_rate, 6);

  if _scope = 'eval' then
    select v_eval_cap - coalesce(sum(l.amount_dkk), 0) into v_available
    from public.ai_credit_ledger l
    where l.kind = 'usage' and l.scope = 'eval'
      and l.status in ('reserved', 'final')
      and l.created_at >= v_month_start;
    if v_available < v_amount then
      return null;
    end if;
  elsif v_enforced then
    v_available := public.ai_credit_balance_dkk();
    if v_available < v_amount then
      return null;
    end if;
    if _scope = 'brain' then
      -- T-205: Brain må højst bruge sin andel af månedens pulje og holder pause ved lidt tilbage.
      -- Saldoen ved månedens start er saldoen nu minus virkningen af månedens rækker (T-802).
      select
        coalesce(sum(l.amount_dkk) filter (where l.kind in ('gift', 'purchase')), 0),
        coalesce(sum(public.ai_credit_effect_dkk(l.kind, l.scope, l.status, l.amount_dkk)), 0)
        into v_added, v_month_effect
      from public.ai_credit_ledger l
      where l.created_at >= v_month_start;
      v_opening := v_available - v_month_effect;
      v_pool := greatest(v_opening, 0) + v_added;
      if v_pool <= 0 then
        return null;
      end if;
      if v_available * 100 <= v_pause * v_pool then
        return null;
      end if;
      select coalesce(sum(l.amount_dkk), 0) into v_brain_spent
      from public.ai_credit_ledger l
      where l.kind = 'usage' and l.scope = 'brain'
        and l.status in ('reserved', 'final')
        and l.created_at >= v_month_start;
      if (v_brain_spent + v_amount) * 100 > v_share * v_pool then
        return null;
      end if;
    end if;
  end if;

  -- T-888: a team with its own allowance (the demo team on staging) never spends beyond it,
  -- whatever the installation allows. Under the same row lock, so two reservations cannot both
  -- pass the last kroner. Analysis first (P11) holds inside the allowance too: Brain's background
  -- work pauses at the pause line, so a screening in a meeting still has its kroner.
  if _scope <> 'eval' and _fund_id is not null then
    select a.allowance_dkk, a.used_dkk into v_allowance, v_allowance_used
    from public.fund_credit_allowance(_fund_id) a;
    if v_allowance is not null then
      if v_allowance_used + v_amount > v_allowance then
        return null;
      end if;
      if _scope = 'brain' and (v_allowance - v_allowance_used) * 100 <= v_pause * v_allowance then
        return null;
      end if;
    end if;
  end if;

  -- T-1003: the team's monthly limit for analyses. Under the same row lock, so two runs started at
  -- the same time cannot both pass the last kroner. Only an analysis run's own reservation counts
  -- (no loop, a run id): a helper in the fund setup or a Brain answer never stops here.
  if _scope = 'analysis' and _fund_id is not null and _ref_id is not null and _loop is null then
    select m.cap_dkk, m.used_dkk into v_month_cap, v_month_used
    from public.fund_analysis_month(_fund_id) m;
    if v_month_cap is not null and v_month_used + v_amount > v_month_cap then
      return null;
    end if;
  end if;

  insert into public.ai_credit_ledger
    (kind, scope, fund_id, user_id, ref_id, loop, model, requests, amount_dkk, status)
  values
    ('usage', _scope, _fund_id, _user_id, _ref_id, _loop, _model, 0, v_amount, 'reserved')
  returning id into v_id;
  return v_id;
end;
$$;

commit;
