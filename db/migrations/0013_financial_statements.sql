-- Regnskabsdata hentet fra offentlige, strukturerede kilder (i dag:
-- Erhvervsstyrelsens XBRL-regnskaber for danske CVR-registrerede selskaber).
-- Ingen AI involveret i selve tallene -- kun deterministisk udtræk fra det
-- indberettede regnskab. Adskilt fra evidence_items, som er fri-tekst-evidens
-- med usikkerhed; her er hvert tal enten det virksomheden faktisk har
-- indberettet, eller det findes slet ikke i denne tabel.

begin;

create table public.financial_statements (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  cvr_number text not null check (cvr_number ~ '^\d{8}$'),
  reporting_class_text text,
  period_start date not null,
  period_end date not null,
  currency text not null default 'DKK',
  source_kind text not null default 'xbrl_structured' check (source_kind in ('xbrl_structured')),
  source_document_url text not null,
  fetched_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (case_id, cvr_number, period_end)
);

create index financial_statements_case_idx on public.financial_statements(case_id, period_end desc);

create table public.financial_statement_line_items (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.financial_statements(id) on delete cascade,
  taxonomy_tag text not null,
  metric text not null,
  value numeric not null,
  unit text not null default 'DKK',
  created_at timestamptz not null default now(),
  unique (statement_id, metric)
);

create index financial_statement_line_items_statement_idx
  on public.financial_statement_line_items(statement_id);

grant select, insert, delete on public.financial_statements to authenticated;
grant select, insert, delete on public.financial_statement_line_items to authenticated;
grant all on public.financial_statements to service_role;
grant all on public.financial_statement_line_items to service_role;

alter table public.financial_statements enable row level security;
alter table public.financial_statement_line_items enable row level security;

create policy "financial_statements_select_member" on public.financial_statements
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

-- Hentning sker fra en offentlig, gratis kilde uden nogen AI-risiko -- alle
-- fondsmedlemmer med lov til at starte analyser kan hente et regnskab, ikke
-- kun administratorer. Sletning følger samme regel (fx for at hente igen).
create policy "financial_statements_insert_team" on public.financial_statements
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_fund_member(auth.uid(), fund_id)
  and (
    public.has_fund_role(auth.uid(), fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), fund_id, 'partner')
    or public.has_fund_role(auth.uid(), fund_id, 'administrator')
  )
);

create policy "financial_statements_delete_team" on public.financial_statements
for delete to authenticated
using (
  public.is_fund_member(auth.uid(), fund_id)
  and (
    public.has_fund_role(auth.uid(), fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), fund_id, 'partner')
    or public.has_fund_role(auth.uid(), fund_id, 'administrator')
  )
);

create policy "financial_statement_line_items_select_member"
on public.financial_statement_line_items
for select to authenticated
using (
  exists (
    select 1 from public.financial_statements fs
    where fs.id = financial_statement_line_items.statement_id
      and public.is_fund_member(auth.uid(), fs.fund_id)
  )
);

create policy "financial_statement_line_items_insert_team"
on public.financial_statement_line_items
for insert to authenticated
with check (
  exists (
    select 1 from public.financial_statements fs
    where fs.id = financial_statement_line_items.statement_id
      and public.is_fund_member(auth.uid(), fs.fund_id)
      and (
        public.has_fund_role(auth.uid(), fs.fund_id, 'analyst')
        or public.has_fund_role(auth.uid(), fs.fund_id, 'partner')
        or public.has_fund_role(auth.uid(), fs.fund_id, 'administrator')
      )
  )
);

commit;
