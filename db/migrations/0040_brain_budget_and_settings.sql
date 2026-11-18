-- Brain (track C) · migration 0040 · part 2
-- pg_trgm, brain_fund_settings, brain_budgets, brain_usage and atomic budget reservation.
-- Spec: §11 and.
--
-- Instance-ready: no hard-coded ids, runs in order on a fresh database as well as on the
-- current one. Per-fund defaults are created for existing funds (backfill below), for every
-- fund created later (trigger on funds), and on demand by brain_reserve_budget.
--   * no existing table, column, policy or grant is changed;
--   * the only trigger on an existing table (funds, after insert) can never make a fund
--     creation fail: it swallows its own errors, and brain_reserve_budget re-creates any
--     missing default rows itself.
-- Writes happen only through the service role (server code). Members can read their fund's
-- rows through RLS. All functions are security definer with search_path = '' and are only
-- executable by service_role.

begin;

set local lock_timeout = '5s';

-- Trigram search for entity names (used from 0042). Supabase keeps extensions out of public;
-- the schema exists on every Supabase project, the guard only matters on a bare database.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
-- 0027 removed PUBLIC's default EXECUTE on new functions. The read-only trigram functions
-- used by brain_search_entities (security invoker) must stay callable by signed-in users.
grant usage on schema extensions to authenticated, service_role;
grant execute on function extensions.similarity(text, text), extensions.similarity_op(text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Fund settings (one row per fund)
-- ---------------------------------------------------------------------------
create table public.brain_fund_settings (
  fund_id uuid primary key references public.funds(id) on delete cascade,
  ranking_weights jsonb not null
    default '{"rrf":1,"usefulness":0.3,"trust":0.2,"recency":0.1,"distance":0.3}'::jsonb
    check (jsonb_typeof(ranking_weights) = 'object'),
  learning_enabled boolean not null default true,   -- P7
  watch_enabled boolean not null default false,     -- P8 (Vagt stays off until the product owner says yes)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Monthly budgets per fund and scope (USD, 1 USD ~ 6.9 DKK)
-- ---------------------------------------------------------------------------
create table public.brain_budgets (
  fund_id uuid not null references public.funds(id) on delete cascade,
  scope text not null check (scope in ('learning','watch','chat','ingest')),
  monthly_limit_usd numeric not null check (monthly_limit_usd >= 0 and monthly_limit_usd <= 10000),
  created_at timestamptz not null default now(),
  primary key (fund_id, scope)
);

-- ---------------------------------------------------------------------------
-- 3. Usage ledger. A model call first reserves its maximum ('reserved'); afterwards the
--    row becomes the actual price ('final') or is released ('released', cost 0).
--    Spend for a month = sum(cost_usd) of 'reserved' + 'final' rows created that month.
-- ---------------------------------------------------------------------------
create table public.brain_usage (
  id bigserial primary key,
  fund_id uuid not null references public.funds(id) on delete cascade,
  scope text not null check (scope in ('learning','watch','chat','ingest')),
  loop text,
  user_id uuid,
  ref_id uuid,
  model text,
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  requests int not null default 1 check (requests >= 0),
  cost_usd numeric not null check (cost_usd >= 0),
  status text not null default 'final' check (status in ('reserved','final','released')),
  created_at timestamptz not null default now()
);
create index brain_usage_month_idx on public.brain_usage (fund_id, scope, created_at);
create index brain_usage_reserved_idx on public.brain_usage (fund_id, created_at)
  where status = 'reserved';

-- ---------------------------------------------------------------------------
-- 4. Default rows. Standard limits: learning 72 (~500 kr), watch 22 (~150 kr),
--    chat 30, ingest 30. ON CONFLICT DO NOTHING keeps any value a fund has changed.
-- ---------------------------------------------------------------------------
create or replace function public.seed_brain_fund_defaults(_fund_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _fund_id is null then
    raise exception 'seed_brain_fund_defaults: fund id is required';
  end if;
  insert into public.brain_fund_settings (fund_id)
  values (_fund_id)
  on conflict (fund_id) do nothing;
  insert into public.brain_budgets (fund_id, scope, monthly_limit_usd)
  values (_fund_id, 'learning', 72),
         (_fund_id, 'watch', 22),
         (_fund_id, 'chat', 30),
         (_fund_id, 'ingest', 30)
  on conflict (fund_id, scope) do nothing;
end;
$$;

-- Runs after a fund is created. Must never make the fund creation fail: any error is
-- turned into a warning, and brain_reserve_budget creates missing rows on first use.
create or replace function public.brain_funds_seed_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.seed_brain_fund_defaults(new.id);
  exception when others then
    raise warning 'brain: default settings for fund % could not be created: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger funds_brain_defaults
  after insert on public.funds
  for each row execute function public.brain_funds_seed_defaults();

-- Existing funds get their defaults now.
select public.seed_brain_fund_defaults(f.id) from public.funds f;

-- ---------------------------------------------------------------------------
-- 5. Atomic reservation. Locks the fund's budget row for the scope (select ... for update),
--    so concurrent reservations for the same fund and scope are serialised: the second
--    caller waits, then (READ COMMITTED: new snapshot per statement) sees the first
--    caller's reservation in the sum. Two reservations can therefore never together
--    exceed the limit. Returns the usage id, or null when the limit would be exceeded.
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

  insert into public.brain_usage (fund_id, scope, loop, user_id, ref_id, model, requests, cost_usd, status)
  values (_fund_id, _scope, _loop, _user_id, _ref_id, _model, 0, _max_usd, 'reserved')
  returning id into v_id;
  return v_id;
end;
$$;

-- Turns a reservation into the actual price. The actual price may exceed the reservation
-- (estimates are not exact); it is recorded as is so the ledger stays true.
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
     and u.status = 'reserved';
  return found;
end;
$$;

-- Releases a reservation when the call was never made (or failed before it was billed).
create or replace function public.brain_release_usage(_usage_id bigint, _fund_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.brain_usage u
     set status = 'released',
         cost_usd = 0
   where u.id = _usage_id
     and u.fund_id = _fund_id
     and u.status = 'reserved';
  return found;
end;
$$;

revoke all on function public.seed_brain_fund_defaults(uuid) from public, anon, authenticated;
revoke all on function public.brain_funds_seed_defaults() from public, anon, authenticated;
revoke all on function public.brain_reserve_budget(uuid, text, numeric, text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.brain_finalize_usage(bigint, uuid, numeric, int, int, int, text)
  from public, anon, authenticated;
revoke all on function public.brain_release_usage(bigint, uuid) from public, anon, authenticated;

grant execute on function public.seed_brain_fund_defaults(uuid) to service_role;
grant execute on function public.brain_reserve_budget(uuid, text, numeric, text, uuid, text, uuid)
  to service_role;
grant execute on function public.brain_finalize_usage(bigint, uuid, numeric, int, int, int, text)
  to service_role;
grant execute on function public.brain_release_usage(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Privileges and RLS: members read their own fund, only the service role writes.
-- ---------------------------------------------------------------------------
revoke all on public.brain_fund_settings, public.brain_budgets, public.brain_usage
  from public, anon, authenticated;
grant select on public.brain_fund_settings, public.brain_budgets, public.brain_usage
  to authenticated;
grant all on public.brain_fund_settings, public.brain_budgets, public.brain_usage to service_role;
revoke all on sequence public.brain_usage_id_seq from public, anon, authenticated;
grant usage, select on sequence public.brain_usage_id_seq to service_role;

alter table public.brain_fund_settings enable row level security;
alter table public.brain_budgets enable row level security;
alter table public.brain_usage enable row level security;

create policy brain_fund_settings_select_member on public.brain_fund_settings
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_budgets_select_member on public.brain_budgets
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_usage_select_member on public.brain_usage
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

commit;
