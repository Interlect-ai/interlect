-- Redesignet: "Skal afklares" – tasks pr. case, samme liste i screening og
-- dyb analyse. Plan: (0034) og gap-analysen afsnit 5.
--
-- 1. case_tasks: typer fra prototypen Case Screening v5 (Opgave, Spørgsmål til selskabet,
--    Verificering, Dokument, Research, Møde) og svartyper (tekst, tal, valg, fil, Interlect søger).
--    AI-tasks har en fast dedupe-nøgle, så samme hul aldrig oprettes igen, heller ikke efter at
--    teamet har løst eller slettet det. Blød sletning giver fortryd.
-- 2. case_score_recalculations: når et svar ændrer en gate, regner koden scoren igen på den
--    seneste screenings AI-svar (intet AI-kald) og gemmer resultatet her (append-only).
-- 3. Samme-fond-reglen: sammensatte nøgler til case, kørsel, dokument og evidens; den ansvarlige
--    skal være aktivt medlem af fonden.
-- 4. Brugere kan kun læse; alt skrives af serveren efter et rettighedstjek (manage_tasks).

begin;

set local search_path = public, extensions;

-- Sammensatte nøgler kan pege på (id, fund_id) (ufarligt: id er allerede unik).
alter table public.analysis_runs add constraint analysis_runs_id_fund_key unique (id, fund_id);
alter table public.documents add constraint documents_id_fund_key unique (id, fund_id);
alter table public.evidence_items add constraint evidence_items_id_fund_key unique (id, fund_id);

-- ---------------------------------------------------------------------------
-- 1. Tasks
-- ---------------------------------------------------------------------------

create table public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  kind text not null check (kind in (
    'task', 'question', 'verification', 'document', 'research', 'meeting'
  )),
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  why text check (why is null or char_length(why) <= 2000),
  answer_kind text not null default 'text'
    check (answer_kind in ('text', 'number', 'select', 'file', 'ai')),
  answer_options text[] not null default '{}',
  answer_unit text check (answer_unit is null or char_length(answer_unit) <= 40),
  assignee_id uuid references auth.users (id) on delete set null,
  due_on date,
  linked_kind text check (linked_kind in ('gate', 'criterion')),
  linked_key text check (linked_key is null or char_length(linked_key) <= 120),
  origin text not null check (origin in ('ai', 'user')),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 400),
  source_run_id uuid,
  status text not null default 'open' check (status in ('open', 'resolved')),
  answer_text text check (answer_text is null or char_length(answer_text) <= 4000),
  answer_value jsonb,
  answer_document_id uuid,
  answer_evidence_id uuid,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  deleted_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_tasks_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade,
  constraint case_tasks_run_same_fund
    foreign key (source_run_id, fund_id) references public.analysis_runs (id, fund_id)
    on delete set null (source_run_id),
  constraint case_tasks_document_same_fund
    foreign key (answer_document_id, fund_id) references public.documents (id, fund_id)
    on delete set null (answer_document_id),
  constraint case_tasks_evidence_same_fund
    foreign key (answer_evidence_id, fund_id) references public.evidence_items (id, fund_id)
    on delete set null (answer_evidence_id),
  constraint case_tasks_link_pair check ((linked_kind is null) = (linked_key is null)),
  constraint case_tasks_resolved_pair check ((status = 'resolved') = (resolved_at is not null)),
  constraint case_tasks_ai_has_dedupe check (origin <> 'ai' or dedupe_key is not null),
  -- Et fuldt unikt krav (ikke et delvist indeks), så serveren kan bruge "on conflict do nothing".
  -- Brugeroprettede tasks har ingen nøgle, og tomme værdier kolliderer ikke.
  constraint case_tasks_dedupe_key unique (case_id, dedupe_key)
);

create index case_tasks_case_idx on public.case_tasks (fund_id, case_id, created_at)
  where deleted_at is null;
create index case_tasks_assignee_open_idx on public.case_tasks (assignee_id)
  where status = 'open' and deleted_at is null;

-- Den ansvarlige skal være aktivt medlem af fonden (kan ikke udtrykkes som fremmednøgle).
create or replace function public.case_tasks_check_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not public.is_fund_member(new.assignee_id, new.fund_id) then
    raise exception 'Den ansvarlige er ikke medlem af investeringstesen.';
  end if;
  return new;
end;
$$;

create trigger case_tasks_check_assignee
before insert or update of assignee_id on public.case_tasks
for each row execute function public.case_tasks_check_assignee();

create trigger case_tasks_touch_case
after insert on public.case_tasks
for each row execute function public.touch_case_last_action();

-- Ændringer af en task (svar, ansvarlig, sletning) er også en handling på casen.
create or replace function public.touch_case_last_action_on_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cases c
  set last_action_at = greatest(c.last_action_at, now())
  where c.id = new.case_id;
  return null;
end;
$$;

revoke all on function public.touch_case_last_action_on_update() from public, anon, authenticated;

create trigger case_tasks_touch_case_on_update
after update on public.case_tasks
for each row execute function public.touch_case_last_action_on_update();

grant select on public.case_tasks to authenticated;
grant all on public.case_tasks to service_role;
alter table public.case_tasks enable row level security;

create policy "case_tasks_select_member" on public.case_tasks
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

-- ---------------------------------------------------------------------------
-- 2. Genberegninger af scoren (append-only)
-- ---------------------------------------------------------------------------

create table public.case_score_recalculations (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  run_id uuid not null,
  task_id uuid references public.case_tasks (id) on delete set null,
  previous_score numeric,
  overall_score numeric,
  outcome text not null check (outcome in (
    'needs_information', 'blocked', 'below_threshold', 'awaiting_approval'
  )),
  failed_gate_keys text[] not null default '{}',
  unresolved_gate_keys text[] not null default '{}',
  formula_version text not null,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint case_score_recalculations_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade,
  constraint case_score_recalculations_run_same_fund
    foreign key (run_id, fund_id) references public.analysis_runs (id, fund_id) on delete cascade
);

create index case_score_recalculations_case_idx
  on public.case_score_recalculations (fund_id, case_id, created_at desc);

create or replace function public.case_score_recalculations_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and (
    pg_trigger_depth() > 1
    or not exists (select 1 from public.cases c where c.id = old.case_id)
  ) then
    return old;
  end if;
  -- task_id sættes til null af fremmednøglen, når en task slettes helt.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (to_jsonb(new) - 'task_id') = (to_jsonb(old) - 'task_id') then
    return new;
  end if;
  raise exception 'Genberegninger kan ikke ændres eller slettes.';
end;
$$;

create trigger case_score_recalculations_append_only
before update or delete on public.case_score_recalculations
for each row execute function public.case_score_recalculations_append_only();

grant select on public.case_score_recalculations to authenticated;
grant all on public.case_score_recalculations to service_role;
alter table public.case_score_recalculations enable row level security;

create policy "case_score_recalculations_select_member" on public.case_score_recalculations
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

commit;
