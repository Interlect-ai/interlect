-- Brain (track C) · migration 0043 ·
-- Operations and learning bookkeeping: brain_jobs (+ lease), brain_job_steps, brain_log
-- (append-only), brain_model_config, brain_prompt_versions, brain_insights,
-- brain_retrieval_events, brain_usefulness, brain_eval_items, brain_eval_runs, and the
-- service-role functions the worker uses: brain_claim_job, brain_extend_job_lease,
-- brain_record_job_step, brain_finish_job, brain_retention and gdpr_mask_log.
-- Spec: §9, §11, §15,
-- .
--
-- Instance-ready (no hard-coded ids; runs in order on a fresh or the current database).
-- Depends on 0032 (role 'admin') and 0033 (unique (id, fund_id) on cases). Additive only.

begin;

set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.app_role'::regtype and enumlabel = 'admin'
  ) then
    raise exception 'Migration 0032 (role admin) must run before 0043.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Jobs: one run per (fund, loop, key), with a lease. attempts doubles as the fencing
--    token: every write from a worker names the attempt it holds, so a worker whose lease
--    was taken over can no longer write.
-- ---------------------------------------------------------------------------
create table public.brain_jobs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  loop text not null check (loop in ('L0_capture','L1_extract','L2_reflect','L3_outcome',
    'L4_nightly','L5_weekly','L7_eval','L8_file_answer','INGEST','BACKFILL','WATCH','RETENTION')),
  key text not null check (char_length(key) between 1 and 200),
  status text not null default 'running'
    check (status in ('running','done','failed','budget_reached','skipped')),
  lease_until timestamptz not null default now() + interval '15 minutes',
  attempts int not null default 1 check (attempts >= 0),
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique (fund_id, loop, key)
);
create index brain_jobs_fund_loop_idx on public.brain_jobs (fund_id, loop, started_at desc);
create index brain_jobs_running_idx on public.brain_jobs (lease_until) where status = 'running';

create table public.brain_job_steps (
  job_id uuid not null,
  fund_id uuid not null,
  step text not null check (char_length(step) between 1 and 100),
  output jsonb,
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (job_id, step),
  foreign key (job_id, fund_id) references public.brain_jobs(id, fund_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 2. brain_log: every insert/update/invalidate/merge by a loop or a user, with before/after,
--    so it can be seen and rolled back. Append-only (see trigger below).
--    job_id is deliberately not a foreign key: an FK action on delete would be an UPDATE.
-- ---------------------------------------------------------------------------
create table public.brain_log (
  id bigserial primary key,
  fund_id uuid not null references public.funds(id) on delete cascade,
  actor text not null check (
    actor ~ '^(L[0-8](_[a-z_]+)?|INGEST|BACKFILL|WATCH|RETENTION|system|user:[0-9a-f-]{36})$'),
  action text not null check (action in ('insert','update','invalidate','merge','split','activate',
    'retire','delete','revert','approve','reject')),
  object_kind text not null check (char_length(object_kind) between 1 and 60),
  object_id uuid not null,
  before jsonb,
  after jsonb,
  reason text check (reason is null or char_length(reason) <= 2000),
  job_id uuid,
  created_at timestamptz not null default now()
);
create index brain_log_object_idx on public.brain_log (fund_id, object_kind, object_id, created_at desc);
create index brain_log_job_idx on public.brain_log (job_id) where job_id is not null;
create index brain_log_fund_created_idx on public.brain_log (fund_id, created_at desc);

-- DELETE only through a cascade (trigger depth > 1) or when the fund is already gone.
-- UPDATE only inside gdpr_mask_log (brain.gdpr = 'on'), and then only before/after/reason.
create or replace function public.brain_log_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1
       or not exists (select 1 from public.funds f where f.id = old.fund_id) then
      return old;
    end if;
    raise exception 'brain_log is append-only';
  end if;
  if coalesce(current_setting('brain.gdpr', true), '') = 'on'
     and new.id = old.id
     and new.fund_id = old.fund_id
     and new.actor = old.actor
     and new.action = old.action
     and new.object_kind = old.object_kind
     and new.object_id = old.object_id
     and new.job_id is not distinct from old.job_id
     and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'brain_log is append-only';
end;
$$;
revoke all on function public.brain_log_append_only() from public, anon, authenticated;

create trigger brain_log_append_only
  before update or delete on public.brain_log
  for each row execute function public.brain_log_append_only();

-- ---------------------------------------------------------------------------
-- 3. Evaluation (created before model config, which points at an eval run)
-- ---------------------------------------------------------------------------
create table public.brain_eval_items (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 2000),
  case_id uuid,
  expected_facts text[] not null,
  expected_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(expected_refs) = 'array'),
  category text not null check (category in ('lookup','aggregate','multi_hop','similar','global',
    'temporal','case_advice','should_refuse','injection')),
  origin text not null check (origin in ('seed','feedback','synthetic')),
  is_holdout boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  foreign key (case_id, fund_id) references public.cases(id, fund_id) on delete set null (case_id)
);
create index brain_eval_items_fund_idx on public.brain_eval_items (fund_id, category);
create index brain_eval_items_case_idx on public.brain_eval_items (case_id) where case_id is not null;

create table public.brain_eval_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  variant text not null check (char_length(variant) between 1 and 200),
  results jsonb not null,
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  cost_usd numeric not null check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  unique (id, fund_id)
);
create index brain_eval_runs_fund_idx on public.brain_eval_runs (fund_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Models and prompts
-- ---------------------------------------------------------------------------
create table public.brain_model_config (
  fund_id uuid not null references public.funds(id) on delete cascade,
  role text not null check (role in ('extractor','resolver','reflector','curator','page_writer',
    'community_writer','anticipator','chat_fast','chat_deep','query_writer','judge','embedding')),
  model text not null check (model ~ '^[a-z0-9-]+/[a-z0-9][a-z0-9.\-]*$'),
  eval_run_id uuid,                            -- the eval run that approved the switch
  created_at timestamptz not null default now(),
  primary key (fund_id, role),
  foreign key (eval_run_id, fund_id)
    references public.brain_eval_runs(id, fund_id) on delete set null (eval_run_id)
);

-- Never shown to customers: service role only.
create table public.brain_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid references public.funds(id) on delete cascade,  -- null = global default (repo only)
  prompt_key text not null check (char_length(prompt_key) between 1 and 60),
  version int not null check (version >= 1),
  body text not null check (char_length(body) between 1 and 50000),
  created_by text not null check (created_by in ('repo','gepa','human')),
  eval_score numeric,
  eval_run_id uuid,
  status text not null check (status in ('candidate','active','retired')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (fund_id, prompt_key, version),
  -- An optimised prompt only becomes active after a human approval (06 L6).
  check (not (status = 'active' and created_by = 'gepa' and approved_at is null))
);
create unique index brain_prompt_versions_one_active_idx
  on public.brain_prompt_versions (fund_id, prompt_key) nulls not distinct
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 5. Insights (the "Lært" feed)
-- ---------------------------------------------------------------------------
create table public.brain_insights (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  -- 'job_failed' is an addition to: requires an insight when a job fails its
  -- last attempt, and none of the planned kinds fits.
  kind text not null check (kind in ('lesson_candidate','bullet_retire','contradiction','stale_fact',
    'merge_candidate','pattern','thesis_drift','weekly_digest','watch_signal','budget_reached',
    'eval_regression','job_failed')),
  title text not null check (char_length(title) between 1 and 300),
  body_md text not null check (char_length(body_md) <= 20000),
  refs jsonb not null default '[]'::jsonb check (jsonb_typeof(refs) = 'array'),
  priority int not null default 2 check (priority between 1 and 3),
  status text not null default 'new' check (status in ('new','seen','accepted','dismissed')),
  decided_by uuid,
  decided_at timestamptz,
  created_by_loop text not null check (char_length(created_by_loop) between 1 and 40),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 300),
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique (fund_id, dedupe_key)
);
create index brain_insights_feed_idx on public.brain_insights (fund_id, status, priority, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Retrieval log and learned usefulness
-- ---------------------------------------------------------------------------
create table public.brain_retrieval_events (
  id bigserial primary key,
  fund_id uuid not null references public.funds(id) on delete cascade,
  message_id uuid,                             -- null when the search came from a loop
  query text not null check (char_length(query) <= 4000),
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array'),
  created_at timestamptz not null default now()
);
create index brain_retrieval_events_fund_created_idx
  on public.brain_retrieval_events (fund_id, created_at);
create index brain_retrieval_events_message_idx
  on public.brain_retrieval_events (message_id) where message_id is not null;

create table public.brain_usefulness (      -- Beta(alpha, beta) per item, learned in L4
  fund_id uuid not null references public.funds(id) on delete cascade,
  item_kind text not null check (item_kind in ('chunk','fact','page','bullet','source_domain')),
  item_key text not null check (char_length(item_key) between 1 and 300),
  alpha real not null default 1 check (alpha > 0),
  beta real not null default 1 check (beta > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fund_id, item_kind, item_key)
);

-- ---------------------------------------------------------------------------
-- 7. Worker functions (security definer, service role only)
-- ---------------------------------------------------------------------------

-- Takes the job in one statement (rule 1). Returns the job's state after the attempt;
-- claimed = true means this caller now holds the lease with attempt number `attempts`.
-- db_now lets the caller compare lease times without trusting its own clock.
create or replace function public.brain_claim_job(
  _fund_id uuid,
  _loop text,
  _key text,
  _lease_seconds int default 900,
  _max_attempts int default 5
)
returns table (
  job_id uuid, claimed boolean, status text, attempts int, lease_until timestamptz,
  db_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval := make_interval(secs => least(greatest(coalesce(_lease_seconds, 900), 30), 3600));
  v_max int := least(greatest(coalesce(_max_attempts, 5), 1), 20);
  v_id uuid;
  v_attempts int;
  v_until timestamptz;
begin
  if _fund_id is null or _loop is null or _key is null then
    raise exception 'brain_claim_job: fund, loop and key are required';
  end if;
  if not exists (select 1 from public.funds f where f.id = _fund_id) then
    raise exception 'brain_claim_job: unknown fund';
  end if;

  insert into public.brain_jobs as j (fund_id, loop, key, status, lease_until, attempts, started_at)
  values (_fund_id, _loop, _key, 'running', now() + v_lease, 1, now())
  on conflict (fund_id, loop, key) do update
     set status = 'running',
         lease_until = now() + v_lease,
         attempts = j.attempts + 1,
         started_at = now(),
         finished_at = null
   where j.status in ('running','failed')
     and j.lease_until < now()
     and j.attempts < v_max
  returning j.id, j.attempts, j.lease_until into v_id, v_attempts, v_until;

  if v_id is not null then
    return query select v_id, true, 'running'::text, v_attempts, v_until, now();
    return;
  end if;

  return query
    select j.id, false, j.status, j.attempts, j.lease_until, now()
    from public.brain_jobs j
    where j.fund_id = _fund_id and j.loop = _loop and j.key = _key;
end;
$$;

-- Long steps extend their lease. Returns the new lease end, or null when the lease was lost.
create or replace function public.brain_extend_job_lease(
  _job_id uuid,
  _fund_id uuid,
  _attempt int,
  _lease_seconds int default 900
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  update public.brain_jobs j
     set lease_until = now() + make_interval(secs => least(greatest(coalesce(_lease_seconds, 900), 30), 3600))
   where j.id = _job_id and j.fund_id = _fund_id and j.attempts = _attempt and j.status = 'running'
  returning j.lease_until into v_until;
  return v_until;
end;
$$;

-- Stores a finished step before the queue message is acknowledged (rule 2).
-- Returns true when stored; false when the step already existed or the lease was lost.
create or replace function public.brain_record_job_step(
  _job_id uuid,
  _fund_id uuid,
  _attempt int,
  _step text,
  _output jsonb,
  _cost_usd numeric default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  -- Lock the job row so a takeover or finish cannot slip in between the check and the insert.
  perform 1 from public.brain_jobs j
   where j.id = _job_id and j.fund_id = _fund_id and j.attempts = _attempt and j.status = 'running'
   for update;
  if not found then
    return false;
  end if;
  insert into public.brain_job_steps (job_id, fund_id, step, output, cost_usd)
  values (_job_id, _fund_id, _step, _output, greatest(coalesce(_cost_usd, 0), 0))
  on conflict (job_id, step) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 and coalesce(_cost_usd, 0) > 0 then
    update public.brain_jobs j set cost_usd = j.cost_usd + _cost_usd where j.id = _job_id;
  end if;
  return v_rows > 0;
end;
$$;

-- Ends the attempt. A failed attempt releases the lease at once, so the next delivery can
-- retry; after the last attempt the job stays 'failed'.
create or replace function public.brain_finish_job(
  _job_id uuid,
  _fund_id uuid,
  _attempt int,
  _status text,
  _stats jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _status not in ('done','failed','budget_reached','skipped') then
    raise exception 'brain_finish_job: invalid status %', _status;
  end if;
  update public.brain_jobs j
     set status = _status,
         finished_at = now(),
         lease_until = case when _status = 'failed' then now() - interval '1 second'
                            else j.lease_until end,
         stats = case when jsonb_typeof(_stats) = 'object' then _stats else '{}'::jsonb end
   where j.id = _job_id and j.fund_id = _fund_id and j.attempts = _attempt and j.status = 'running';
  return found;
end;
$$;

-- RETENTION: retrieval events after 180 days, chat threads after 24 months without
-- activity (the thread table arrives in 0045; skipped until then). The cut-offs come from
-- the caller but can never be more aggressive than 30 days / 180 days.
create or replace function public.brain_retention(
  _fund_id uuid,
  _events_before timestamptz,
  _threads_before timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events int := 0;
  v_threads int := 0;
begin
  if _fund_id is null or _events_before is null or _threads_before is null then
    raise exception 'brain_retention: fund and cut-offs are required';
  end if;
  if _events_before > now() - interval '30 days' then
    raise exception 'brain_retention: retrieval cut-off is too recent';
  end if;
  if _threads_before > now() - interval '180 days' then
    raise exception 'brain_retention: thread cut-off is too recent';
  end if;

  delete from public.brain_retrieval_events r
   where r.fund_id = _fund_id and r.created_at < _events_before;
  get diagnostics v_events = row_count;

  if to_regclass('public.brain_threads') is not null then
    execute 'delete from public.brain_threads t where t.fund_id = $1 and t.last_activity_at < $2'
      using _fund_id, _threads_before;
    get diagnostics v_threads = row_count;
  end if;

  return jsonb_build_object('retrieval_events', v_events, 'threads', v_threads);
end;
$$;

-- GDPR: masks before/after/reason for the given objects. The only way to
-- change a brain_log row.
create or replace function public.gdpr_mask_log(_fund_id uuid, _object_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int := 0;
begin
  if _fund_id is null or _object_ids is null or cardinality(_object_ids) = 0 then
    return 0;
  end if;
  perform set_config('brain.gdpr', 'on', true);
  update public.brain_log l
     set before = case when l.before is null then null else '{"masked":true}'::jsonb end,
         after = case when l.after is null then null else '{"masked":true}'::jsonb end,
         reason = case when l.reason is null then null else '[slettet]' end
   where l.fund_id = _fund_id and l.object_id = any(_object_ids);
  get diagnostics v_rows = row_count;
  perform set_config('brain.gdpr', 'off', true);
  return v_rows;
end;
$$;

-- RETENTION, del 2 (harden, 29. sep): en slettet opgave (case_tasks.deleted_at) beholder
-- sin dedupe-nøgle, så et AI-hul ikke oprettes igen, men teksten og svaret renses efter 30 dage.
-- Rensningen er ikke en handling på casen, så den flytter ikke casens "sidste handling".
alter table public.case_tasks add column content_purged_at timestamptz;

create or replace function public.touch_case_last_action_on_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('brain.retention', true), '') = 'on' then
    return null;
  end if;
  update public.cases c
  set last_action_at = greatest(c.last_action_at, now())
  where c.id = new.case_id;
  return null;
end;
$$;
revoke all on function public.touch_case_last_action_on_update() from public, anon, authenticated;

create or replace function public.brain_purge_deleted_tasks(_fund_id uuid, _deleted_before timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int := 0;
begin
  if _fund_id is null or _deleted_before is null then
    raise exception 'brain_purge_deleted_tasks: fund and cut-off are required';
  end if;
  if _deleted_before > now() - interval '30 days' then
    raise exception 'brain_purge_deleted_tasks: cut-off is too recent';
  end if;
  perform set_config('brain.retention', 'on', true);
  update public.case_tasks t
     set title = 'Slettet opgave',
         description = null,
         why = null,
         answer_text = null,
         answer_value = null,
         answer_options = '{}',
         answer_unit = null,
         assignee_id = null,
         content_purged_at = now()
   where t.fund_id = _fund_id
     and t.deleted_at is not null
     and t.deleted_at < _deleted_before
     and t.content_purged_at is null;
  get diagnostics v_rows = row_count;
  perform set_config('brain.retention', 'off', true);
  return v_rows;
end;
$$;

revoke all on function public.brain_purge_deleted_tasks(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.brain_purge_deleted_tasks(uuid, timestamptz) to service_role;

revoke all on function public.brain_claim_job(uuid, text, text, int, int) from public, anon, authenticated;
revoke all on function public.brain_extend_job_lease(uuid, uuid, int, int) from public, anon, authenticated;
revoke all on function public.brain_record_job_step(uuid, uuid, int, text, jsonb, numeric)
  from public, anon, authenticated;
revoke all on function public.brain_finish_job(uuid, uuid, int, text, jsonb) from public, anon, authenticated;
revoke all on function public.brain_retention(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.gdpr_mask_log(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.brain_claim_job(uuid, text, text, int, int) to service_role;
grant execute on function public.brain_extend_job_lease(uuid, uuid, int, int) to service_role;
grant execute on function public.brain_record_job_step(uuid, uuid, int, text, jsonb, numeric)
  to service_role;
grant execute on function public.brain_finish_job(uuid, uuid, int, text, jsonb) to service_role;
grant execute on function public.brain_retention(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.gdpr_mask_log(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Privileges and RLS
--    Members read: jobs, log, model config, insights (admin-only kinds excepted),
--    usefulness, eval items and runs.
--    Service role only: job steps (may hold intermediate model output), prompt versions
--    (never shown to customers) and retrieval events.
-- ---------------------------------------------------------------------------
revoke all on public.brain_jobs, public.brain_job_steps, public.brain_log, public.brain_model_config,
  public.brain_prompt_versions, public.brain_insights, public.brain_retrieval_events,
  public.brain_usefulness, public.brain_eval_items, public.brain_eval_runs
  from public, anon, authenticated;
grant select on public.brain_jobs, public.brain_log, public.brain_model_config,
  public.brain_insights, public.brain_usefulness, public.brain_eval_items, public.brain_eval_runs
  to authenticated;
grant all on public.brain_jobs, public.brain_job_steps, public.brain_log, public.brain_model_config,
  public.brain_prompt_versions, public.brain_insights, public.brain_retrieval_events,
  public.brain_usefulness, public.brain_eval_items, public.brain_eval_runs
  to service_role;
revoke all on sequence public.brain_log_id_seq, public.brain_retrieval_events_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.brain_log_id_seq, public.brain_retrieval_events_id_seq
  to service_role;

alter table public.brain_jobs enable row level security;
alter table public.brain_job_steps enable row level security;
alter table public.brain_log enable row level security;
alter table public.brain_model_config enable row level security;
alter table public.brain_prompt_versions enable row level security;
alter table public.brain_insights enable row level security;
alter table public.brain_retrieval_events enable row level security;
alter table public.brain_usefulness enable row level security;
alter table public.brain_eval_items enable row level security;
alter table public.brain_eval_runs enable row level security;

create policy brain_jobs_select_member on public.brain_jobs
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_log_select_member on public.brain_log
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_model_config_select_member on public.brain_model_config
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
-- Budget, eval-regression and failed-job insights are for Admin only.
create policy brain_insights_select_member on public.brain_insights
  for select to authenticated
  using (
    public.is_fund_member((select auth.uid()), fund_id)
    and (
      kind not in ('budget_reached','eval_regression','job_failed')
      or public.has_fund_role((select auth.uid()), fund_id, 'admin'::public.app_role)
    )
  );
create policy brain_usefulness_select_member on public.brain_usefulness
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_eval_items_select_member on public.brain_eval_items
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_eval_runs_select_member on public.brain_eval_runs
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

commit;
