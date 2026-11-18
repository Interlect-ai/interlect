-- 0070 · Kreditregnskab: ai_credit_ledger, ai_settings og ai_reserve() (platform).
--
-- Kunden betaler forud i kroner (P13). Hver installation har ét ledger: gratis kreditter (gift),
-- køb (purchase) og forbrug (usage). Saldo = kreditter - forbrug. Alle AI-kald reserverer deres
-- maksimum før start (ai_reserve) og afregnes bagefter (ai_finalize_usage) eller frigives
-- (ai_release_usage), som Brains brain_reserve_budget (0040), men for hele installationen.
--
--   * Scopes: 'analysis' (screening, dyb analyse), 'chat' (Spørg), 'brain' (baggrund L1-L5) og
--     'eval' (eksamen og sundhedstjek). 'eval' betales af Interlect: det rører ikke saldoen, men
--     har sit eget månedsloft (ai_settings.eval_monthly_cap_dkk, P12, standard 25 kr.).
--   * Analysen kommer først (P11): ai_reserve giver alle tre betalte scopes samme adgang til
--     saldoen. Brains andel (15 %, pause ved 15 % tilbage) lægges oven på.
--   * Samtidige reservationer: ai_reserve låser installationens ene ai_settings-række, så
--     reservationerne udføres én ad gangen, og den næste ser den forriges beløb (READ COMMITTED
--     tager nyt snapshot pr. sætning). To samtidige kald kan derfor aldrig tilsammen gå under 0.
--   * En kørsel, der er i gang, bliver altid færdig: ai_finalize_usage må overskride
--     reservationen (skønnet er ikke præcist), så saldoen kan ende lidt under 0. Derefter
--     afviser ai_reserve alt, til der er fyldt op.
--   * Alle satser står i ai_settings (én række), ikke i koden. Beløb er i kroner; ai_reserve
--     tager dollars (modelpriser) og regner om med ai_settings.usd_to_dkk.
--
-- Additiv og bagudkompatibel: ingen eksisterende tabel, kolonne, policy eller grant ændres, og
-- ingen kode kalder de nye funktioner endnu (gør). Skrivning sker kun med
-- service_role. En fonds medlemmer kan læse forbrugsrækkerne for deres egen fond; kreditrækkerne
-- (gift, køb) hører til installationen og kan kun læses af serveren. Forbrugsrækker overlever, at
-- en fond slettes (fund_id sættes til null), så regnskabet stadig passer.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Indstillinger (præcis én række pr. installation)
-- ---------------------------------------------------------------------------
create table public.ai_settings (
  id boolean primary key default true check (id),
  usd_to_dkk numeric not null default 6.9 check (usd_to_dkk > 0 and usd_to_dkk <= 100),
  -- P11: Brains baggrundsarbejde (bruges).
  brain_share_pct numeric not null default 15 check (brain_share_pct >= 0 and brain_share_pct <= 100),
  brain_pause_at_remaining_pct numeric not null default 15
    check (brain_pause_at_remaining_pct >= 0 and brain_pause_at_remaining_pct <= 100),
  brain_dkk_per_new_case numeric not null default 3 check (brain_dkk_per_new_case >= 0),
  brain_dkk_per_decision numeric not null default 0.5 check (brain_dkk_per_decision >= 0),
  -- P12: eksamen og sundhedstjek betales af Interlect, højst så meget pr. måned.
  eval_monthly_cap_dkk numeric not null default 25 check (eval_monthly_cap_dkk >= 0),
  updated_at timestamptz not null default now()
);

insert into public.ai_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Ledger. Kreditter er altid 'final'. Et forbrug starter som 'reserved' (maksimum), bliver
--    til den faktiske pris ('final') eller frigives ('released', pris 0).
-- ---------------------------------------------------------------------------
create table public.ai_credit_ledger (
  id bigserial primary key,
  kind text not null check (kind in ('gift', 'purchase', 'usage')),
  scope text check (scope in ('analysis', 'chat', 'brain', 'eval')),
  fund_id uuid references public.funds(id) on delete set null,
  user_id uuid,
  ref_id uuid,
  loop text,
  model text,
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  requests int not null default 0 check (requests >= 0),
  amount_dkk numeric not null check (amount_dkk >= 0),
  status text not null default 'final' check (status in ('reserved', 'final', 'released')),
  note text,
  created_at timestamptz not null default now(),
  -- Et forbrug hører til et scope; en kredit gør ikke, og en kredit er aldrig reserveret.
  check ((kind = 'usage') = (scope is not null)),
  check (kind = 'usage' or status = 'final')
);

create index ai_credit_ledger_usage_idx
  on public.ai_credit_ledger (scope, created_at)
  where kind = 'usage' and status <> 'released';
-- Idempotens: samme betaling (ref_id, fx Stripe-id eller topup-id) kan ikke lægges ind to gange.
create unique index ai_credit_ledger_credit_ref_uniq
  on public.ai_credit_ledger (kind, ref_id)
  where kind in ('gift', 'purchase') and ref_id is not null;
create index ai_credit_ledger_fund_idx
  on public.ai_credit_ledger (fund_id, created_at)
  where fund_id is not null;
create index ai_credit_ledger_reserved_idx
  on public.ai_credit_ledger (created_at)
  where status = 'reserved';

-- ---------------------------------------------------------------------------
-- 3. Saldo i kroner: kreditter minus forbrug (reserveret + endeligt; eval betaler Interlect).
--    Kan blive en smule negativ, når en kørsel i gang overskrider sin reservation.
-- ---------------------------------------------------------------------------
create or replace function public.ai_credit_balance_dkk()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when l.kind in ('gift', 'purchase') then l.amount_dkk
      when l.kind = 'usage' and l.scope <> 'eval' and l.status in ('reserved', 'final') then -l.amount_dkk
      else 0
    end
  ), 0)
  from public.ai_credit_ledger l;
$$;

-- ---------------------------------------------------------------------------
-- 4. Atomisk reservation. Returnerer ledger-id, eller null, når saldoen (eller for 'eval':
--    månedsloftet) ikke slår til.
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
  v_amount numeric;
  v_available numeric;
  v_month_start timestamptz := date_trunc('month', now(), 'UTC');
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
  select s.usd_to_dkk, s.eval_monthly_cap_dkk into v_rate, v_eval_cap
  from public.ai_settings s
  where s.id
  for update;
  if not found then
    raise exception 'ai_reserve: ai_settings row missing';
  end if;

  v_amount := round(_max_usd * v_rate, 6);

  if _scope = 'eval' then
    select v_eval_cap - coalesce(sum(l.amount_dkk), 0) into v_available
    from public.ai_credit_ledger l
    where l.kind = 'usage' and l.scope = 'eval'
      and l.status in ('reserved', 'final')
      and l.created_at >= v_month_start;
  else
    v_available := public.ai_credit_balance_dkk();
  end if;

  if v_available < v_amount then
    return null;
  end if;

  insert into public.ai_credit_ledger
    (kind, scope, fund_id, user_id, ref_id, loop, model, requests, amount_dkk, status)
  values
    ('usage', _scope, _fund_id, _user_id, _ref_id, _loop, _model, 0, v_amount, 'reserved')
  returning id into v_id;
  return v_id;
end;
$$;

-- Gør en reservation til den faktiske pris. Prisen må overstige reservationen (skøn er ikke
-- præcise); den gemmes, som den er, så regnskabet er sandt, og en kørsel i gang bliver færdig.
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
     and l.status = 'reserved';
  return found;
end;
$$;

-- Frigiver en reservation, når kaldet aldrig blev lavet (eller fejlede, før det blev afregnet).
create or replace function public.ai_release_usage(_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_credit_ledger l
     set status = 'released',
         amount_dkk = 0
   where l.id = _id
     and l.kind = 'usage'
     and l.status = 'reserved';
  return found;
end;
$$;

revoke all on function public.ai_credit_balance_dkk() from public, anon, authenticated;
revoke all on function public.ai_reserve(text, uuid, numeric, text, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.ai_finalize_usage(bigint, numeric, int, int, int, text)
  from public, anon, authenticated;
revoke all on function public.ai_release_usage(bigint) from public, anon, authenticated;

grant execute on function public.ai_credit_balance_dkk() to service_role;
grant execute on function public.ai_reserve(text, uuid, numeric, text, uuid, text, uuid)
  to service_role;
grant execute on function public.ai_finalize_usage(bigint, numeric, int, int, int, text)
  to service_role;
grant execute on function public.ai_release_usage(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Rettigheder og RLS. Kun serveren skriver. Medlemmer læser forbrugsrækkerne for deres egen
--    fond (til målerne); indstillinger og kreditrækker kan kun serveren læse.
-- ---------------------------------------------------------------------------
revoke all on public.ai_settings, public.ai_credit_ledger from public, anon, authenticated;
grant select on public.ai_credit_ledger to authenticated;
grant all on public.ai_settings, public.ai_credit_ledger to service_role;
revoke all on sequence public.ai_credit_ledger_id_seq from public, anon, authenticated;
grant usage, select on sequence public.ai_credit_ledger_id_seq to service_role;

alter table public.ai_settings enable row level security;
alter table public.ai_credit_ledger enable row level security;

create policy ai_credit_ledger_select_fund_member on public.ai_credit_ledger
  for select to authenticated
  using (
    kind = 'usage'
    and fund_id is not null
    and public.is_fund_member((select auth.uid()), fund_id)
  );

commit;
