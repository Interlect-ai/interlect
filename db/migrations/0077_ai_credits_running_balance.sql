-- 0077 · Kreditter 5: løbende saldo og hængende Brain-reservationer, platform.
--
--   *: ai_credit_balance_dkk() summerede hele kreditbogen, og ai_reserve kalder den under
--     installationens ene lås, så hver reservation blev langsommere, jo flere AI-kald der var lavet.
--     Nu står saldoen i ai_settings.balance_dkk og holdes ajour af en trigger på ai_credit_ledger:
--     hver indsættelse, ændring og sletning flytter saldoen med rækkens forskel (samme regel som
--     før: kreditter plus, forbrug minus, eval og frigivne rækker 0). ai_credit_balance_dkk() læser
--     den ene række. Brains månedspulje i ai_reserve regnes som saldoen minus månedens rækker i
--     stedet for en sum over alt før månedens start. ai_credit_balance_recount_dkk() summerer
--     stadig hele bogen, til test og kontrol (de to skal altid give det samme).
--   * Låse: triggeren opdaterer ai_settings-rækken, som ai_reserve låser først. Derfor låser
--     ai_finalize_usage, ai_release_usage, ai_settle_analysis_runs og ai_release_stale nu også
--     ai_settings, før de rører kreditbogen (også når de kaldes alene), så alle tager låsene i
--     samme rækkefølge (ai_settings, så kreditbogen) og aldrig låser hinanden inde.
--   *: ai_release_stale frigav kun kreditbogen, så en hængende brain_usage-række talte mod
--     fondens brain_budgets resten af måneden. Nu frigives Brain-rækker, der har været reserveret
--     i over intervallet, samtidig (en række, som en anden transaktion er ved at afregne, springes
--     over). brain_reserve_budget tæller ikke reservationer over 3 timer med, så en fond, hvis
--     budget kun er "brugt" af hængende rækker, kan reservere igen, også før næste ai_reserve har
--     ryddet op. brain_finalize_usage bogfører prisen på en frigivet række, som ai_finalize_usage
--     gør, så et sent færdigt kald ikke bliver gratis.
--
-- Ingen tabel eller kolonne fjernes, og ingen kode skal ændres: funktionerne har samme navne,
-- argumenter og svar. Skrivning sker stadig kun med service_role.

begin;

set local lock_timeout = '5s';

alter table public.ai_settings
  add column if not exists balance_dkk numeric not null default 0;

-- Brains månedspulje læser kun månedens rækker (alle slags).
create index if not exists ai_credit_ledger_created_idx
  on public.ai_credit_ledger (created_at);

-- ---------------------------------------------------------------------------
-- 1. En rækkes virkning på saldoen og den løbende saldo.
-- ---------------------------------------------------------------------------
create or replace function public.ai_credit_effect_dkk(
  _kind text,
  _scope text,
  _status text,
  _amount numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when _kind in ('gift', 'purchase') then _amount
    when _kind = 'usage' and _scope <> 'eval' and _status in ('reserved', 'final') then -_amount
    else 0
  end;
$$;

create or replace function public.ai_credit_ledger_track_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_delta := v_delta - public.ai_credit_effect_dkk(old.kind, old.scope, old.status, old.amount_dkk);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_delta := v_delta + public.ai_credit_effect_dkk(new.kind, new.scope, new.status, new.amount_dkk);
  end if;
  if v_delta <> 0 then
    update public.ai_settings s set balance_dkk = s.balance_dkk + v_delta where s.id;
  end if;
  return null;
end;
$$;

-- TRUNCATE fyrer ingen rækketriggere: en tom bog er en saldo på 0.
create or replace function public.ai_credit_ledger_reset_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_settings s set balance_dkk = 0 where s.id;
  return null;
end;
$$;

-- Triggeren tager en lås, der venter på igangværende skrivninger og spærrer nye til commit, så
-- startsaldoen nedenfor er præcis summen af bogen, som triggeren bygger videre på.
create trigger ai_credit_ledger_balance
  after insert or update or delete on public.ai_credit_ledger
  for each row execute function public.ai_credit_ledger_track_balance();

create trigger ai_credit_ledger_balance_truncate
  after truncate on public.ai_credit_ledger
  for each statement execute function public.ai_credit_ledger_reset_balance();

-- Hele bogen summeret (den gamle beregning), til test og kontrol.
create or replace function public.ai_credit_balance_recount_dkk()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(public.ai_credit_effect_dkk(l.kind, l.scope, l.status, l.amount_dkk)), 0)
  from public.ai_credit_ledger l;
$$;

update public.ai_settings s
   set balance_dkk = public.ai_credit_balance_recount_dkk()
 where s.id;

-- Saldo i kroner: kreditter minus forbrug (reserveret + endeligt; eval betaler Interlect).
create or replace function public.ai_credit_balance_dkk()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.balance_dkk from public.ai_settings s where s.id), 0);
$$;

-- ---------------------------------------------------------------------------
-- 2. Afregning og frigivelse låser ai_settings først (samme rækkefølge som ai_reserve).
-- ---------------------------------------------------------------------------
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
  select s.usd_to_dkk into v_rate from public.ai_settings s where s.id for update;
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

create or replace function public.ai_release_usage(_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.ai_settings s where s.id for update;
  update public.ai_credit_ledger l
     set status = 'released',
         amount_dkk = 0
   where l.id = _id
     and l.kind = 'usage'
     and l.status = 'reserved';
  return found;
end;
$$;

-- Som 0071, men låser ai_settings først (kaldes også alene af en driftsperson).
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

-- ---------------------------------------------------------------------------
-- 3. Hængende reservationer: kreditbogen og Brains egen fordeling. Returnerer antallet af
--    frigivne rækker i kreditbogen (som 0071).
-- ---------------------------------------------------------------------------
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
  perform 1 from public.ai_settings s where s.id for update;
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

  -- Ét Brain-kald er ét modelkald; efter _older_than kommer det ikke tilbage. En række, som
  -- brain_finalize_usage eller brain_release_usage holder lige nu, springes over, så oprydningen
  -- (under ai_settings-låsen) aldrig venter på dem.
  update public.brain_usage u
     set status = 'released',
         cost_usd = 0
   where u.id in (
     select b.id
       from public.brain_usage b
      where b.status = 'reserved'
        and b.created_at < now() - _older_than
      for update skip locked
   );
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. ai_reserve: som 0071, men Brains pulje regnes ud fra den løbende saldo.
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
  v_month_effect numeric;
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

  insert into public.ai_credit_ledger
    (kind, scope, fund_id, user_id, ref_id, loop, model, requests, amount_dkk, status)
  values
    ('usage', _scope, _fund_id, _user_id, _ref_id, _loop, _model, 0, v_amount, 'reserved')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Brains kaldesteder (som 0071): hængende reservationer tæller ikke mod fordelingen, og en
--    sen afregning af en frigivet række bogføres.
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

  -- En reservation over 3 timer gammel hænger (samme grænse som ai_release_stale i ai_reserve)
  -- og tæller ikke med, selv om den ikke er ryddet op endnu (T-804).
  select coalesce(sum(u.cost_usd), 0) into v_spent
  from public.brain_usage u
  where u.fund_id = _fund_id
    and u.scope = _scope
    and (u.status = 'final'
         or (u.status = 'reserved' and u.created_at >= now() - interval '3 hours'))
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
     and u.status in ('reserved', 'released')
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

-- ---------------------------------------------------------------------------
-- 6. Rettigheder: kun serveren (og triggeren) bruger de nye funktioner.
-- ---------------------------------------------------------------------------
revoke all on function public.ai_credit_effect_dkk(text, text, text, numeric)
  from public, anon, authenticated;
revoke all on function public.ai_credit_ledger_track_balance() from public, anon, authenticated;
revoke all on function public.ai_credit_ledger_reset_balance() from public, anon, authenticated;
revoke all on function public.ai_credit_balance_recount_dkk() from public, anon, authenticated;
grant execute on function public.ai_credit_effect_dkk(text, text, text, numeric) to service_role;
grant execute on function public.ai_credit_balance_recount_dkk() to service_role;

commit;
