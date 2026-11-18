-- 0071 · Kreditter 2 og 3: håndhævelse og Brains andel, platform.
--
-- Bygger oven på 0070 og ændrer ingen tabel, der ikke er nævnt her:
--   * ai_settings.credits_enforced (standard FRA): så længe den er fra, bogfører ai_reserve alt
--     forbrug, men afviser aldrig. Så stopper chat og analyse ikke på en installation, der endnu
--     ikke har fået kreditter. customer:new og customer:topup slår den til.
--   *: analyser (screening, dyb analyse) reserverer deres loft ved start (kode i
--     src/lib/ai/credits.server.ts). Afregningen sker her: ai_settle_analysis_runs bogfører den
--     faktiske pris for færdige kørsler fra analysis_runs.actual_cost, så ingen af de mange
--     afslutningsveje i koden skal kende kreditterne. En kørsel i gang bliver altid færdig.
--   *: en reservation, hvis kørsel døde, frigives efter 3 timer (analyser: 24 timer, eller 3
--     timer, hvis kørslen er slettet) (ai_release_stale), og
--     ai_finalize_usage bogfører prisen på en række, der allerede er frigivet.
--     Begge køres automatisk i starten af hver ai_reserve; der skal ikke et cron-job til.
--   *: Brains baggrund (learning, watch, ingest) tæller som scope 'brain' og må højst bruge
--     ai_settings.brain_share_pct af månedens pulje (saldo ved månedens start + det, der er
--     fyldt på) og holder pause, når der er brain_pause_at_remaining_pct tilbage af puljen.
--     Chatten er brugerens eget spørgsmål og tæller som 'chat' (ingen andel).
--     brain_budgets er stadig fordelingen inden for Brain: brain_reserve_budget tjekker først sin
--     egen fordeling og derefter den fælles saldo, så alle Brains kaldesteder er dækket uden
--     kodeændringer.

begin;

set local lock_timeout = '5s';

alter table public.ai_settings
  add column if not exists credits_enforced boolean not null default false;

alter table public.brain_usage
  add column if not exists ledger_id bigint references public.ai_credit_ledger(id);

-- ---------------------------------------------------------------------------
-- 1. Afregning af færdige analysekørsler (kaldes af ai_reserve, som har låsen).
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
  select s.usd_to_dkk into v_rate from public.ai_settings s where s.id;
  -- En kørsel, der ikke længere er i gang (alt andet end queued og running, også awaiting_approval,
  -- hvor en screening venter på godkendelse), afregnes. Ukendt pris (actual_cost er null, fordi
  -- gatewayen ikke rapporterede en pris) på en gennemført kørsel afregnes til reservationen, ikke
  -- til 0 kr.; på en fejlet eller annulleret kørsel er null "intet brugt". En række, der blev
  -- frigivet som hængende, bogfører stadig prisen, hvis kørslen senere blev færdig med en pris.
  update public.ai_credit_ledger l
     set status = 'final',
         amount_dkk = case
           when r.actual_cost is not null then round(r.actual_cost * v_rate, 6)
           when r.status in ('complete', 'awaiting_approval') and l.status = 'reserved' then l.amount_dkk
           else 0
         end,
         requests = 1
    from public.analysis_runs r
   where l.kind = 'usage'
     and l.scope = 'analysis'
     and l.ref_id = r.id
     and r.status not in ('queued', 'running')
     and (l.status = 'reserved' or (l.status = 'released' and coalesce(r.actual_cost, 0) > 0));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Frigiver reservationer, hvis kørsel aldrig blev afregnet (serveren døde midt i et kald).
create or replace function public.ai_release_stale(_older_than interval default interval '3 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if _older_than is null or _older_than < interval '5 minutes' then
    raise exception 'ai_release_stale: interval too short';
  end if;
  -- Analysekørsler kan vare længe (flere faser): deres reservation frigives først efter 24 timer,
  -- eller efter _older_than, hvis kørslen er slettet og aldrig kan afregnes.
  update public.ai_credit_ledger l
     set status = 'released',
         amount_dkk = 0,
         note = coalesce(l.note || ' · ', '') || 'frigivet: hængende reservation'
   where l.kind = 'usage'
     and l.status = 'reserved'
     and (
       (l.scope <> 'analysis' and l.created_at < now() - _older_than)
       or (l.scope = 'analysis'
           and l.created_at < now() - greatest(_older_than, interval '24 hours'))
       or (l.scope = 'analysis'
           and l.created_at < now() - _older_than
           and not exists (select 1 from public.analysis_runs r where r.id = l.ref_id))
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- En kørsel, der var ved at blive færdig efter frigivelsen, bogfører stadig sin pris.
create or replace function public.ai_finalize_usage(
  _id bigint,
  _cost_usd numeric,
  _input_tokens int default null,
  _output_tokens int default null,
  _requests int default 1,
  _model text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
begin
  -- Over reservationsloftet (200) med god margen: en enhedsfejl skal fejle højlydt, ikke låse kunden ude.
  if _cost_usd is null or _cost_usd < 0 or _cost_usd > 1000 then
    raise exception 'ai_finalize_usage: invalid cost %', _cost_usd;
  end if;
  select s.usd_to_dkk into v_rate from public.ai_settings s where s.id;
  update public.ai_credit_ledger l
     set status = 'final',
         amount_dkk = round(_cost_usd * v_rate, 6),
         input_tokens = _input_tokens,
         output_tokens = _output_tokens,
         requests = greatest(coalesce(_requests, 1), 0),
         model = coalesce(_model, l.model)
   where l.id = _id
     and l.kind = 'usage'
     and l.status in ('reserved', 'released');
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. ai_reserve med håndhævelse og Brains andel.
-- ---------------------------------------------------------------------------
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
  v_opening numeric;
  v_pool numeric;
  v_brain_spent numeric;
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
      select coalesce(sum(l.amount_dkk), 0) into v_added
      from public.ai_credit_ledger l
      where l.kind in ('gift', 'purchase') and l.created_at >= v_month_start;
      select coalesce(sum(
        case
          when l.kind in ('gift', 'purchase') then l.amount_dkk
          when l.scope <> 'eval' and l.status in ('reserved', 'final') then -l.amount_dkk
          else 0
        end), 0) into v_opening
      from public.ai_credit_ledger l
      where l.created_at < v_month_start;
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

  insert into public.ai_credit_ledger
    (kind, scope, fund_id, user_id, ref_id, loop, model, requests, amount_dkk, status)
  values
    ('usage', _scope, _fund_id, _user_id, _ref_id, _loop, _model, 0, v_amount, 'reserved')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Brains kaldesteder: brain_reserve_budget tjekker først fordelingen (brain_budgets, 0040) og
--    derefter den fælles saldo. Afregning og frigivelse følger med samme id.
-- ---------------------------------------------------------------------------
create or replace function public.brain_reserve_budget(
  _fund_id uuid,
  _scope text,
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
  v_limit numeric;
  v_spent numeric;
  v_month_start timestamptz := date_trunc('month', now(), 'UTC');
  v_ledger bigint;
  v_id bigint;
begin
  if _fund_id is null then
    raise exception 'brain_reserve_budget: fund id is required';
  end if;
  if _scope is null or _scope not in ('learning','watch','chat','ingest') then
    raise exception 'brain_reserve_budget: unknown scope %', _scope;
  end if;
  -- One reservation covers one model call; no single call may reserve more than $25.
  if _max_usd is null or _max_usd <= 0 or _max_usd > 25 then
    raise exception 'brain_reserve_budget: invalid amount %', _max_usd;
  end if;
  if not exists (select 1 from public.funds f where f.id = _fund_id) then
    raise exception 'brain_reserve_budget: unknown fund';
  end if;

  -- Self-healing: a fund created while the insert trigger failed still gets its defaults.
  perform public.seed_brain_fund_defaults(_fund_id);

  select b.monthly_limit_usd into v_limit
  from public.brain_budgets b
  where b.fund_id = _fund_id and b.scope = _scope
  for update;
  if not found then
    raise exception 'brain_reserve_budget: budget row missing';
  end if;

  select coalesce(sum(u.cost_usd), 0) into v_spent
  from public.brain_usage u
  where u.fund_id = _fund_id
    and u.scope = _scope
    and u.status in ('reserved','final')
    and u.created_at >= v_month_start;

  if v_spent + _max_usd > v_limit then
    return null;
  end if;

  -- Fælles saldo (0071). Låserækkefølge: først brain_budgets, så ai_settings, altid i den
  -- rækkefølge, så to kald aldrig låser hinanden inde.
  v_ledger := public.ai_reserve(
    case when _scope = 'chat' then 'chat' else 'brain' end,
    _fund_id, _max_usd, _loop, _ref_id, _model, _user_id
  );
  if v_ledger is null then
    return null;
  end if;

  insert into public.brain_usage
    (fund_id, scope, loop, user_id, ref_id, model, requests, cost_usd, status, ledger_id)
  values (_fund_id, _scope, _loop, _user_id, _ref_id, _model, 0, _max_usd, 'reserved', v_ledger)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.brain_finalize_usage(
  _usage_id bigint,
  _fund_id uuid,
  _cost_usd numeric,
  _input_tokens int default null,
  _output_tokens int default null,
  _requests int default 1,
  _model text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger bigint;
begin
  if _cost_usd is null or _cost_usd < 0 then
    raise exception 'brain_finalize_usage: invalid cost %', _cost_usd;
  end if;
  update public.brain_usage u
     set status = 'final',
         cost_usd = _cost_usd,
         input_tokens = _input_tokens,
         output_tokens = _output_tokens,
         requests = greatest(coalesce(_requests, 1), 0),
         model = coalesce(_model, u.model)
   where u.id = _usage_id
     and u.fund_id = _fund_id
     and u.status = 'reserved'
  returning u.ledger_id into v_ledger;
  if not found then
    return false;
  end if;
  if v_ledger is not null then
    perform public.ai_finalize_usage(
      v_ledger, _cost_usd, _input_tokens, _output_tokens, _requests, _model
    );
  end if;
  return true;
end;
$$;

create or replace function public.brain_release_usage(_usage_id bigint, _fund_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger bigint;
begin
  update public.brain_usage u
     set status = 'released',
         cost_usd = 0
   where u.id = _usage_id
     and u.fund_id = _fund_id
     and u.status = 'reserved'
  returning u.ledger_id into v_ledger;
  if not found then
    return false;
  end if;
  if v_ledger is not null then
    perform public.ai_release_usage(v_ledger);
  end if;
  return true;
end;
$$;

revoke all on function public.ai_settle_analysis_runs() from public, anon, authenticated;
revoke all on function public.ai_release_stale(interval) from public, anon, authenticated;
grant execute on function public.ai_settle_analysis_runs() to service_role;
grant execute on function public.ai_release_stale(interval) to service_role;

commit;
