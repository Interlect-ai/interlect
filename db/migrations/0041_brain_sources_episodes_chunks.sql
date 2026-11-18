-- Brain (track C) · migration 0041 ·
-- brain_sources -> brain_episodes -> brain_chunks, brain_capture_queue, delete/update
-- triggers on the raw case tables and the read function brain_search_chunks.
-- Spec: §3, §4, §15 and, §5.
--
-- Depends on migration 0033 (track B): unique (id, fund_id) on cases and companies, and
-- the Brain columns on case_transition_events. The guard below stops (and rolls back)
-- with a clear message if 0033 has not run.
--
-- Instance-ready (no hard-coded ids; runs in order on a fresh or the current database) and
-- additive:
--   * only new tables and functions, plus AFTER UPDATE/DELETE triggers on raw tables;
--   * no trigger on INSERT, so creating evidence, notes or runs costs nothing extra;
--   * the capture trigger catches every error and only raises a warning, so an existing
--     update or delete in the app can never fail because of Brain.

begin;

set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.cases'::regclass
      and i.indisunique
      and i.indpred is null
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['fund_id','id']
  ) or not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.companies'::regclass
      and i.indisunique
      and i.indpred is null
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['fund_id','id']
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'case_transition_events'
      and column_name = 'reason_codes'
  ) then
    raise exception 'Migration 0033 (unique (id, fund_id) on cases/companies and the Brain columns on case_transition_events) must run before 0041.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. brain_sources: uploads and websites in Brain · Kilder (INGEST fills them)
-- ---------------------------------------------------------------------------
create table public.brain_sources (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  kind text not null check (kind in ('website','pdf','docx','xlsx','csv','text')),
  doc_type text check (doc_type in ('fund_report','status_report','investment_memo','lp_letter',
    'thesis','website_page','portfolio_list','decision_history','other')),
  title text not null check (char_length(title) between 1 and 500),
  origin_url text,
  storage_path text,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  company_entity_id uuid,                      -- FK to brain_entities is added in 0042
  period_start date,
  period_end date,
  trust_tier text not null check (trust_tier in ('customer_doc','company_claim','public_web')),
  status text not null default 'queued' check (status in
    ('queued','extracting','classifying','chunking','embedding','extracting_facts','linking',
     'review','ready','failed')),
  error_message text,                          -- user facing, never a raw error
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  check (period_end is null or period_start is null or period_end >= period_start),
  -- Storage path always starts with the fund id.
  check (storage_path is null or storage_path like fund_id::text || '/%')
);
create unique index brain_sources_fund_sha_idx on public.brain_sources (fund_id, sha256)
  where sha256 is not null;
create index brain_sources_fund_idx on public.brain_sources (fund_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. brain_episodes: one immutable piece of knowledge with its raw-data reference
-- ---------------------------------------------------------------------------
create table public.brain_episodes (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  kind text not null check (kind in (
    'evidence','finding','risk','recommendation','category_score','calculation',
    'case_note','document_page','analysis_summary','decision','identity',
    'source_chunk','historical_decision','answer','watch_signal')),
  ref_table text,                              -- e.g. 'evidence_items'; null for source_chunk
  ref_id uuid,                                 -- the row in raw data
  brain_source_id uuid,                        -- set when the episode comes from an upload
  case_id uuid,
  company_id uuid,
  trust_tier text not null check (trust_tier in ('official','partner','customer_doc',
    'third_party','analysis','user_note','company_claim','public_web')),
  occurred_at timestamptz,                     -- world time
  recorded_at timestamptz not null default now(),
  title text,
  content text not null check (char_length(content) between 1 and 8000),
  content_hash text not null check (char_length(content_hash) between 8 and 128),
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','done','skipped','failed')),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique nulls not distinct (fund_id, ref_table, ref_id, brain_source_id, content_hash),
  check ((ref_table is null) = (ref_id is null)),
  check (kind <> 'source_chunk' or brain_source_id is not null),
  foreign key (brain_source_id, fund_id)
    references public.brain_sources(id, fund_id) on delete cascade,
  foreign key (case_id, fund_id)
    references public.cases(id, fund_id) on delete cascade,
  -- PG15+: only company_id is cleared, fund_id stays (same-fund rule without a trigger).
  foreign key (company_id, fund_id)
    references public.companies(id, fund_id) on delete set null (company_id)
);
create index brain_episodes_case_idx on public.brain_episodes (fund_id, case_id, occurred_at desc);
create index brain_episodes_pending_idx on public.brain_episodes (fund_id)
  where extraction_status = 'pending';
create index brain_episodes_source_idx on public.brain_episodes (brain_source_id)
  where brain_source_id is not null;
create index brain_episodes_company_idx on public.brain_episodes (company_id)
  where company_id is not null;

-- ---------------------------------------------------------------------------
-- 3. brain_chunks: searchable text pieces. Every episode has at least one chunk.
-- ---------------------------------------------------------------------------
create table public.brain_chunks (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  episode_id uuid not null,
  ordinal int not null check (ordinal >= 0),
  heading text,
  page_from int check (page_from is null or page_from > 0),
  page_to int check (page_to is null or page_to > 0),
  content text not null check (char_length(content) between 1 and 8000),
  token_count int not null check (token_count >= 0),
  embedding vector(1536),
  embedding_model text not null default 'openai/text-embedding-3-small',
  fts tsvector generated always as (
    setweight(to_tsvector('danish'::regconfig, coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('danish'::regconfig, content), 'B') ||
    setweight(to_tsvector('english'::regconfig, content), 'C')) stored,
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique (episode_id, ordinal),
  check (page_to is null or page_from is null or page_to >= page_from),
  foreign key (episode_id, fund_id)
    references public.brain_episodes(id, fund_id) on delete cascade
);
create index brain_chunks_fts_idx on public.brain_chunks using gin (fts);
create index brain_chunks_emb_idx on public.brain_chunks using hnsw (embedding vector_cosine_ops);
create index brain_chunks_fund_idx on public.brain_chunks (fund_id);

-- ---------------------------------------------------------------------------
-- 4. brain_capture_queue: "this case has changed" (written by triggers and by
--    enqueueBrainCapture, read by L0/L4). One row per case.
-- ---------------------------------------------------------------------------
create table public.brain_capture_queue (
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null,
  changed_at timestamptz not null default now(),
  primary key (fund_id, case_id),
  foreign key (case_id, fund_id) references public.cases(id, fund_id) on delete cascade
);
create index brain_capture_queue_changed_idx on public.brain_capture_queue (changed_at);

-- ---------------------------------------------------------------------------
-- 5. Capture trigger on raw tables (security definer, search_path = '').
--    TG_ARGV[0] = mode:
--      'row'         episode ref = (TG_TABLE_NAME, old.id)
--      'run_summary' episode ref = ('analysis_runs', old.run_id)   (recommendations, category_scores)
--      'document'    episode ref = ('documents', old.document_id)  (pitch_decks)
--      'source'      evidence episodes whose evidence row points at this source
--    TG_ARGV[1..] = content columns; an UPDATE only counts when one of them changed.
--    The case is found via old.case_id, or via analysis_runs for rows that only have run_id.
--    On delete or content change: the episode(s) are deleted (chunks and fact links
--    follow by cascade) and the case is marked in brain_capture_queue, so L0 recreates the
--    episode from the corrected text and L4 notices deletions. Corrected or masked data
--    therefore never stays in Brain.
-- ---------------------------------------------------------------------------
create or replace function public.brain_capture_raw_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := tg_argv[0];
  v_old jsonb := to_jsonb(old);
  v_new jsonb;
  v_fund uuid;
  v_case uuid;
  v_run uuid;
  v_ref_table text;
  v_ref_id uuid;
  v_changed boolean := false;
  i int;
begin
  begin
    if tg_op = 'UPDATE' then
      v_new := to_jsonb(new);
      for i in 1 .. tg_nargs - 1 loop
        if (v_old -> tg_argv[i]) is distinct from (v_new -> tg_argv[i]) then
          v_changed := true;
          exit;
        end if;
      end loop;
      if not v_changed then
        return null;
      end if;
    end if;

    v_fund := (v_old ->> 'fund_id')::uuid;
    v_case := (v_old ->> 'case_id')::uuid;
    v_run := (v_old ->> 'run_id')::uuid;
    if v_case is null and v_run is not null then
      select r.case_id into v_case
      from public.analysis_runs r
      where r.id = v_run and r.fund_id = v_fund;
    end if;

    if v_mode = 'source' then
      delete from public.brain_episodes e
      where e.fund_id = v_fund
        and e.ref_table = 'evidence_items'
        and e.ref_id in (
          select ei.id from public.evidence_items ei
          where ei.fund_id = v_fund and ei.source_id = (v_old ->> 'id')::uuid
        );
    else
      if v_mode = 'row' then
        v_ref_table := tg_table_name;
        v_ref_id := (v_old ->> 'id')::uuid;
      elsif v_mode = 'run_summary' then
        v_ref_table := 'analysis_runs';
        v_ref_id := v_run;
      elsif v_mode = 'document' then
        v_ref_table := 'documents';
        v_ref_id := (v_old ->> 'document_id')::uuid;
      else
        raise exception 'unknown capture mode %', v_mode;
      end if;
      if v_ref_id is not null then
        delete from public.brain_episodes e
        where e.fund_id = v_fund and e.ref_table = v_ref_table and e.ref_id = v_ref_id;
      end if;
    end if;

    -- Skip the queue while the case itself is being deleted (cascade): the case row is
    -- already gone, and its episodes disappear through their own cascade.
    if v_case is not null and exists (
      select 1 from public.cases c where c.id = v_case and c.fund_id = v_fund
    ) then
      insert into public.brain_capture_queue as q (fund_id, case_id, changed_at)
      values (v_fund, v_case, now())
      on conflict (fund_id, case_id) do update set changed_at = excluded.changed_at;
    end if;
  exception when others then
    raise warning 'brain_capture_raw_change on %: %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.brain_capture_raw_change() from public, anon, authenticated;

create trigger brain_capture_evidence_items
  after delete or update of claim, value_text, excerpt, status, confidence, stated_by,
    observation_date, period_start, period_end, source_date, source_id, document_id, case_id
  on public.evidence_items
  for each row execute function public.brain_capture_raw_change(
    'row', 'claim', 'value_text', 'excerpt', 'status', 'confidence', 'stated_by',
    'observation_date', 'period_start', 'period_end', 'source_date', 'source_id',
    'document_id', 'case_id');

create trigger brain_capture_sources
  after delete or update of title, url, source_type, source_date, entity_match_status
  on public.sources
  for each row execute function public.brain_capture_raw_change(
    'source', 'title', 'url', 'source_type', 'source_date', 'entity_match_status');

create trigger brain_capture_analysis_findings
  after delete or update of statement, category, finding_type, nature, relevant_date, confidence
  on public.analysis_findings
  for each row execute function public.brain_capture_raw_change(
    'row', 'statement', 'category', 'finding_type', 'nature', 'relevant_date', 'confidence');

create trigger brain_capture_risks
  after delete or update of statement, mitigation, category, level, likelihood, impact, status
  on public.risks
  for each row execute function public.brain_capture_raw_change(
    'row', 'statement', 'mitigation', 'category', 'level', 'likelihood', 'impact', 'status');

create trigger brain_capture_analysis_runs
  after delete or update of status, completed_at
  on public.analysis_runs
  for each row execute function public.brain_capture_raw_change('row', 'status', 'completed_at');

create trigger brain_capture_recommendations
  after delete or update of recommendation, overall_score, evidence_confidence, rationale,
    has_failed_gate, has_critical_risk
  on public.recommendations
  for each row execute function public.brain_capture_raw_change(
    'run_summary', 'recommendation', 'overall_score', 'evidence_confidence', 'rationale',
    'has_failed_gate', 'has_critical_risk');

create trigger brain_capture_category_scores
  after delete or update of validated_score, proposed_score, weight, rationale, confidence
  on public.category_scores
  for each row execute function public.brain_capture_raw_change(
    'run_summary', 'validated_score', 'proposed_score', 'weight', 'rationale', 'confidence');

create trigger brain_capture_case_notes
  after delete or update of body
  on public.case_notes
  for each row execute function public.brain_capture_raw_change('row', 'body');

create trigger brain_capture_case_transition_events
  after delete or update of reason, reason_codes, reason_confidence, new_value, previous_value
  on public.case_transition_events
  for each row execute function public.brain_capture_raw_change(
    'row', 'reason', 'reason_codes', 'reason_confidence', 'new_value', 'previous_value');

create trigger brain_capture_documents
  after delete or update of file_name, kind, status, content_hash
  on public.documents
  for each row execute function public.brain_capture_raw_change(
    'row', 'file_name', 'kind', 'status', 'content_hash');

create trigger brain_capture_pitch_decks
  after delete or update of extracted_at, page_count
  on public.pitch_decks
  for each row execute function public.brain_capture_raw_change(
    'document', 'extracted_at', 'page_count');

-- ---------------------------------------------------------------------------
-- 6. brain_search_chunks: two ranked candidate lists (full text and vector) for one fund.
--    Fusion (RRF, usefulness, trust, recency, distance) happens in TypeScript.
--    Security invoker: RLS still applies, and the first check refuses a foreign fund.
--    Under service_role auth.uid() is null; the server has already checked membership.
-- ---------------------------------------------------------------------------
create or replace function public.brain_search_chunks(
  _fund_id uuid,
  _query text default null,
  _query_embedding vector(1536) default null,
  _case_id uuid default null,
  _kinds text[] default null,
  _limit int default 40
)
returns table (chunk_id uuid, episode_id uuid, list text, rank int, score double precision)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(_limit, 40), 1), 100);
  v_tsq tsquery;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if _query is not null and btrim(_query) <> '' then
    v_tsq := websearch_to_tsquery('danish'::regconfig, left(_query, 1000))
          || websearch_to_tsquery('english'::regconfig, left(_query, 1000));
    return query
      select s.id, s.episode_id, 'fts'::text,
             (row_number() over (order by s.r desc, s.id))::int,
             s.r::double precision
      from (
        select c.id, c.episode_id, ts_rank_cd(c.fts, v_tsq) as r
        from public.brain_chunks c
        join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
        where c.fund_id = _fund_id
          and c.fts @@ v_tsq
          and e.superseded_at is null
          and (_case_id is null or e.case_id = _case_id)
          and (_kinds is null or e.kind = any(_kinds))
        order by r desc, c.id
        limit v_limit
      ) s;
  end if;

  if _query_embedding is not null then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.ef_search', '100', true);
    return query
      select s.id, s.episode_id, 'vector'::text,
             (row_number() over (order by s.d, s.id))::int,
             (1 - s.d)::double precision
      from (
        select c.id, c.episode_id, c.embedding operator(public.<=>) _query_embedding as d
        from public.brain_chunks c
        join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
        where c.fund_id = _fund_id
          and c.embedding is not null
          and e.superseded_at is null
          and (_case_id is null or e.case_id = _case_id)
          and (_kinds is null or e.kind = any(_kinds))
        order by c.embedding operator(public.<=>) _query_embedding
        limit v_limit
      ) s;
  end if;
end;
$$;

revoke all on function public.brain_search_chunks(uuid, text, vector, uuid, text[], int)
  from public, anon;
grant execute on function public.brain_search_chunks(uuid, text, vector, uuid, text[], int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Privileges and RLS. Members read sources, episodes and chunks of their fund.
--    The capture queue is internal plumbing: service role only.
-- ---------------------------------------------------------------------------
revoke all on public.brain_sources, public.brain_episodes, public.brain_chunks,
  public.brain_capture_queue from public, anon, authenticated;
grant select on public.brain_sources, public.brain_episodes, public.brain_chunks to authenticated;
grant all on public.brain_sources, public.brain_episodes, public.brain_chunks,
  public.brain_capture_queue to service_role;

alter table public.brain_sources enable row level security;
alter table public.brain_episodes enable row level security;
alter table public.brain_chunks enable row level security;
alter table public.brain_capture_queue enable row level security;

create policy brain_sources_select_member on public.brain_sources
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_episodes_select_member on public.brain_episodes
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_chunks_select_member on public.brain_chunks
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

commit;
