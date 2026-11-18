-- PAP Intelligence - permitted-source traction scanner and case promotion.
-- Run after 0004_m4_cases_evidence.sql.

begin;

create type public.scanner_source_kind as enum ('hacker_news', 'github');
create type public.scanner_run_status as enum ('running', 'complete', 'partial', 'failed');
create type public.scanner_signal_status as enum ('new', 'reviewed', 'promoted', 'rejected');

create table public.scanner_sources (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  source_key text not null,
  kind public.scanner_source_kind not null,
  label text not null,
  base_url text not null,
  enabled boolean not null default true,
  terms_note text not null default '',
  requests_per_run integer not null default 1 check (requests_per_run between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, source_key)
);

create table public.scanner_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  config_version_id uuid not null references public.fund_config_versions(id) on delete restrict,
  status public.scanner_run_status not null default 'running',
  started_by uuid not null references auth.users(id) on delete restrict,
  source_count integer not null default 0,
  fetched_count integer not null default 0,
  accepted_count integer not null default 0,
  error_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.scanner_signals (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  scanner_run_id uuid not null references public.scanner_runs(id) on delete cascade,
  source_id uuid not null references public.scanner_sources(id) on delete restrict,
  external_id text not null,
  fingerprint text not null,
  title text not null,
  url text not null,
  summary text not null default '',
  entity_name text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  relevance_score numeric not null check (relevance_score between 0 and 100),
  relevance_explanation text not null,
  matched_terms text[] not null default '{}',
  entity_confidence numeric not null default 0 check (entity_confidence between 0 and 1),
  status public.scanner_signal_status not null default 'new',
  matched_case_id uuid references public.cases(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, source_id, external_id),
  unique (fund_id, fingerprint)
);

create index scanner_signals_fund_discovered_idx
  on public.scanner_signals(fund_id, discovered_at desc);
create index scanner_signals_status_score_idx
  on public.scanner_signals(fund_id, status, relevance_score desc);

grant select on public.scanner_sources, public.scanner_runs, public.scanner_signals to authenticated;
grant select, insert, update on public.scanner_sources, public.scanner_runs, public.scanner_signals to service_role;

alter table public.scanner_sources enable row level security;
alter table public.scanner_runs enable row level security;
alter table public.scanner_signals enable row level security;

create policy scanner_sources_select_member on public.scanner_sources
for select to authenticated using (public.is_fund_member(auth.uid(), fund_id));
create policy scanner_runs_select_member on public.scanner_runs
for select to authenticated using (public.is_fund_member(auth.uid(), fund_id));
create policy scanner_signals_select_member on public.scanner_signals
for select to authenticated using (public.is_fund_member(auth.uid(), fund_id));

insert into public.scanner_sources (fund_id, source_key, kind, label, base_url, terms_note)
select f.id, source.source_key, source.kind::public.scanner_source_kind,
       source.label, source.base_url, source.terms_note
from public.funds f
cross join (values
  ('hacker-news', 'hacker_news', 'Hacker News', 'https://hacker-news.firebaseio.com',
   'Officiel offentlig API. Højst 15 historier hentes pr. kørsel; kun metadata og links gemmes.'),
  ('github-repositories', 'github', 'GitHub repositories', 'https://api.github.com',
   'Offentlig repository-søgning. Rate limit og kilde-URL bevares.')
) as source(source_key, kind, label, base_url, terms_note)
on conflict (fund_id, source_key) do nothing;

commit;
