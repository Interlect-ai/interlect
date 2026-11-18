-- Fund memory: a single fund's own retrospective corpus of decided cases
-- (invested / closed without investment) plus manually-logged historical
-- investments, embedded for similarity search. This is deliberately
-- single-fund only -- every read and write is fund_id-scoped, so a brand
-- new fund has zero rows and the feature is structurally invisible for it.
-- Retrieved matches are always a deterministic similarity score plus the
-- honest decision fact -- never a performance judgement, since no
-- post-decision performance data exists anywhere in this schema.

begin;

create extension if not exists vector;

create table public.fund_memory_entries (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  historical_investment_id uuid references public.historical_investments(id) on delete cascade,
  company_name text not null,
  sector text,
  geography text,
  stage text,
  decision text not null check (decision in ('invested', 'closed_without_investment')),
  decided_at date,
  summary_text text not null,
  embedding vector(1536) not null,
  embedding_model text not null default 'openai/text-embedding-3-small',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (case_id is not null and historical_investment_id is null)
    or (case_id is null and historical_investment_id is not null)
  )
);

create unique index fund_memory_entries_case_uidx
  on public.fund_memory_entries(case_id) where case_id is not null;
create unique index fund_memory_entries_historical_uidx
  on public.fund_memory_entries(historical_investment_id) where historical_investment_id is not null;
create index fund_memory_entries_fund_idx on public.fund_memory_entries(fund_id);

grant select on public.fund_memory_entries to authenticated;
grant all on public.fund_memory_entries to service_role;

alter table public.fund_memory_entries enable row level security;

-- No insert/update/delete policy for `authenticated`: every memory entry is
-- derived (embedding + templated summary computed server-side), so there is
-- no legitimate direct-from-browser write path. service_role bypasses RLS.
create policy "fund_memory_entries_select_member" on public.fund_memory_entries
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

-- The persisted top-K retrieval result for a case, written once per
-- screening/deep run so the UI never triggers a live embedding call, and so
-- the citation shown always matches what the model actually saw.
create table public.case_memory_matches (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  run_id uuid references public.analysis_runs(id) on delete set null,
  memory_entry_id uuid not null references public.fund_memory_entries(id) on delete cascade,
  similarity numeric not null check (similarity between -1 and 1),
  created_at timestamptz not null default now(),
  unique (case_id, memory_entry_id)
);

create index case_memory_matches_case_idx on public.case_memory_matches(case_id, created_at desc);

grant select on public.case_memory_matches to authenticated;
grant all on public.case_memory_matches to service_role;

alter table public.case_memory_matches enable row level security;

create policy "case_memory_matches_select_member" on public.case_memory_matches
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

-- Nearest-neighbour lookup, scoped to one fund. PostgREST's plain .select()
-- cannot parameterize an ORDER BY expression like `embedding <=> $vector`,
-- so this needs its own function. Only granted to service_role: it is only
-- ever called from the server-side pipeline, which has already verified
-- fund access via requireFundCapability before calling it. Deliberately has
-- no is_fund_member() check inside -- auth.uid() is null under a
-- service-role JWT, which would make it always return zero rows. If this is
-- ever called from the browser, that check must be added then.
create or replace function public.match_fund_memory(
  _fund_id uuid,
  _query_embedding vector(1536),
  _exclude_case_id uuid,
  _match_count int default 5
)
returns table (
  memory_entry_id uuid,
  case_id uuid,
  historical_investment_id uuid,
  company_name text,
  sector text,
  geography text,
  stage text,
  decision text,
  decided_at date,
  summary_text text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id, m.case_id, m.historical_investment_id, m.company_name, m.sector,
    m.geography, m.stage, m.decision, m.decided_at, m.summary_text,
    1 - (m.embedding <=> _query_embedding) as similarity
  from public.fund_memory_entries m
  where m.fund_id = _fund_id
    and (_exclude_case_id is null or m.case_id is distinct from _exclude_case_id)
  order by m.embedding <=> _query_embedding
  limit greatest(1, least(_match_count, 20));
$$;

revoke all on function public.match_fund_memory(uuid, vector, uuid, int) from public, anon, authenticated;
grant execute on function public.match_fund_memory(uuid, vector, uuid, int) to service_role;

commit;
