-- (Brain): "Find med Brain" på et manglende økonomital. Brain søger kun efter det ene felt
-- (casens eget materiale, ellers nettet) og lægger et FORSLAG med kilde og sikkerhed. Intet sættes
-- ind på casen uden et klik; ingen fund gemmes ikke (så står feltet som "Ikke fundet").
--
-- 1. case_field_proposals: ét forslag pr. søgning (felt og år), med kilden og citatet, så "Sæt ind"
--    gemmer præcis det, Brain fandt, og ikke noget klienten selv påstår. Serveren skriver alt.
-- 2. case_financial_inputs får kilden: 'entered' (skrevet ind) eller 'brain' (fundet af Brain og
--    bekræftet af brugeren i `entered_by`), med kildelink og forslaget bag.
-- Samme-fond-reglen som 0102: casen og fonden hænger sammen (sammensat fremmednøgle).

begin;

set local search_path = public, extensions;

create table public.case_field_proposals (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  metric text not null check (metric in ('revenue', 'gross_profit', 'cash', 'cash_flow_operating')),
  fiscal_year integer not null check (fiscal_year between 1990 and 2100),
  value numeric not null check (value > -1e15 and value < 1e15),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Sikkerhed: den samme skala som evidensstatus; Brain sætter aldrig "verificeret" (det gør kun et register).
  certainty text not null check (certainty in ('likely', 'company_stated')),
  source_kind text not null check (source_kind in ('case_material', 'web')),
  source_title text,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  quote text not null check (char_length(quote) between 1 and 600),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  constraint case_field_proposals_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade
);

create index case_field_proposals_case_idx
  on public.case_field_proposals (fund_id, case_id, created_at desc);

-- Højst ét åbent forslag pr. felt og år; et ældre ubesvaret forslag afvises, når et nyt kommer.
create unique index case_field_proposals_one_open
  on public.case_field_proposals (case_id, metric, fiscal_year) where status = 'proposed';

grant select on public.case_field_proposals to authenticated;
grant all on public.case_field_proposals to service_role;
alter table public.case_field_proposals enable row level security;

create policy "case_field_proposals_select_member" on public.case_field_proposals
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

-- Som alle tabeller (0094): kræver MFA, når brugeren har slået det til.
drop policy if exists mfa_required on public.case_field_proposals;
create policy mfa_required on public.case_field_proposals as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

alter table public.case_financial_inputs
  add column source_kind text not null default 'entered' check (source_kind in ('entered', 'brain')),
  add column source_url text check (source_url is null or source_url ~ '^https?://'),
  add column source_note text check (source_note is null or char_length(source_note) <= 600),
  add column proposal_id uuid references public.case_field_proposals (id) on delete set null;

commit;
