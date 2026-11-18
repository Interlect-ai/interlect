-- Økonomi vises altid. Et tal, Interlect ikke kan
-- finde i et regnskab, står som "Ikke fundet" med "Udfyld", og det, en person skriver ind, gemmes
-- her på casen med "indtastet af" og bruges i graferne. Intet gættes.
--
-- 1. Et tal pr. case, nøgletal og regnskabsår: de rå tal, beregningsmotoren allerede regner på
--    (omsætning, bruttofortjeneste, likvide midler, pengestrøm fra drift). Vækst, margin, burn og
--    runway regnes derfor i kode som for et regnskab. Et regnskabs eget tal overskrives aldrig af
--    serveren; det indtastede bruges kun, hvor regnskabet ikke har tallet.
-- 2. Samme-fond-reglen: casen og fonden hænger sammen (sammensat fremmednøgle).
-- 3. Brugere kan kun læse i deres egen fond; alt skrives af serveren efter et rettighedstjek
--    (correct_evidence: Admin, Lead og Medlem). Hver ændring skrives i audit_events.

begin;

set local search_path = public, extensions;

create table public.case_financial_inputs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  metric text not null check (metric in ('revenue', 'gross_profit', 'cash', 'cash_flow_operating')),
  fiscal_year integer not null check (fiscal_year between 1990 and 2100),
  value numeric not null check (value > -1e15 and value < 1e15),
  currency text not null default 'DKK' check (currency ~ '^[A-Z]{3}$'),
  entered_by uuid references auth.users (id) on delete set null,
  entered_at timestamptz not null default now(),
  constraint case_financial_inputs_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade,
  constraint case_financial_inputs_one_per_year unique (case_id, metric, fiscal_year)
);

create index case_financial_inputs_case_idx
  on public.case_financial_inputs (fund_id, case_id);

create trigger case_financial_inputs_touch_case
after insert on public.case_financial_inputs
for each row execute function public.touch_case_last_action();

create trigger case_financial_inputs_touch_case_on_update
after update on public.case_financial_inputs
for each row execute function public.touch_case_last_action_on_update();

grant select on public.case_financial_inputs to authenticated;
grant all on public.case_financial_inputs to service_role;
alter table public.case_financial_inputs enable row level security;

create policy "case_financial_inputs_select_member" on public.case_financial_inputs
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

-- Som alle tabeller (0094): kræver MFA, når brugeren har slået det til.
drop policy if exists mfa_required on public.case_financial_inputs;
create policy mfa_required on public.case_financial_inputs as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

commit;
