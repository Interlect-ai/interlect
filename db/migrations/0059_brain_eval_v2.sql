-- 0059 · Brains eksamen v2 (plan 1.0 pakke 0-C).
--
-- Eksamen skal være pålidelig, før vi retter Brain efter den:
--   * brain_eval_items får facit-punkter (ja/nej, kritisk, rettet af kode eller dommer), et spor
--     (dev, holdout, sealed) og et regressionsflag. Et forseglet spørgsmål (sealed) er skrevet af
--     Produktejeren og partneren og kan kun læses af serveren; scriptet viser kun samlet score.
--   * brain_eval_runs får spor, antal gentagelser, dommerens model og prompt-version, et
--     fingeraftryk af de fem knapper (søgevægte, case-profil, prompts, lektioner, model), git-sha
--     og statistikken (interval, ustabile spørgsmål, fejltyper).
--   * brain_eval_attempts gemmer hele sporet pr. forsøg (svar, kilder, værktøjskald, søgekandidater,
--     dommerens og kodens rettelse, fejltype, CRAG-point, pris, tid). Kun serveren.
--   * brain_eval_human_grades gemmer produktejerens ja/nej pr. punkt, så dommeren kan kalibreres
--     (TPR og TNR mod produktejeren). Kun serveren.
--
-- Additiv: nye kolonner har standardværdier, eksisterende rækker beholder deres betydning
-- (is_holdout bliver spor holdout), og den gamle kode virker uændret mod tabellerne.

begin;

-- ---------------------------------------------------------------------------
-- 1. Spørgsmål: facit-punkter, spor og regression
-- ---------------------------------------------------------------------------
alter table public.brain_eval_items
  add column facit jsonb not null default '[]'::jsonb
    check (jsonb_typeof(facit) = 'array' and jsonb_array_length(facit) <= 40),
  add column track text not null default 'dev' check (track in ('dev', 'holdout', 'sealed')),
  add column regression boolean not null default false,
  add column updated_at timestamptz not null default now();

update public.brain_eval_items set track = 'holdout' where is_holdout;

-- is_holdout følger sporet fra nu af (kolonnen bevares til læsere fra 0043).
alter table public.brain_eval_items
  add constraint brain_eval_items_holdout_follows_track check (is_holdout = (track <> 'dev'));

-- Forseglede spørgsmål skrives af mennesker.
alter table public.brain_eval_items drop constraint brain_eval_items_origin_check;
alter table public.brain_eval_items
  add constraint brain_eval_items_origin_check
    check (origin in ('seed', 'feedback', 'synthetic', 'human'));

-- Medlemmer ser ikke forseglede spørgsmål (de må ikke kunne øves på).
drop policy brain_eval_items_select_member on public.brain_eval_items;
create policy brain_eval_items_select_member on public.brain_eval_items
  for select to authenticated
  using (track <> 'sealed' and public.is_fund_member((select auth.uid()), fund_id));

-- ---------------------------------------------------------------------------
-- 2. Kørsler: spor, gentagelser, dommer, knapper og statistik
-- ---------------------------------------------------------------------------
alter table public.brain_eval_runs
  add column track text check (track in ('dev', 'holdout', 'sealed', 'all')),
  add column repeats smallint check (repeats between 1 and 10),
  add column judge_model text check (judge_model ~ '^[a-z0-9-]+/[a-z0-9][a-z0-9.\-]*$'),
  add column judge_prompt_version text
    check (char_length(judge_prompt_version) between 1 and 50),
  add column knobs jsonb check (knobs is null or jsonb_typeof(knobs) = 'object'),
  add column git_sha text check (git_sha ~ '^[0-9a-f]{7,40}$'),
  add column stats jsonb check (stats is null or jsonb_typeof(stats) = 'object'),
  -- En ny rettelse af gemte svar (ny dommer eller prompt) er en ny kørsel, der peger på svarene.
  add column regraded_from uuid,
  add constraint brain_eval_runs_regraded_from_fkey
    foreign key (regraded_from, fund_id)
    references public.brain_eval_runs(id, fund_id) on delete set null (regraded_from);
create index brain_eval_runs_regraded_from_idx on public.brain_eval_runs (regraded_from)
  where regraded_from is not null;

-- ---------------------------------------------------------------------------
-- 3. Forsøg: hele sporet pr. spørgsmål × gentagelse (kun serveren)
-- ---------------------------------------------------------------------------
create table public.brain_eval_attempts (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  run_id uuid not null,
  item_id uuid not null,
  attempt smallint not null check (attempt between 1 and 10),
  answer text not null default '' check (char_length(answer) <= 100000),
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  trace jsonb not null default '{}'::jsonb check (jsonb_typeof(trace) = 'object'),
  judge jsonb check (judge is null or jsonb_typeof(judge) = 'object'),
  grade jsonb check (grade is null or jsonb_typeof(grade) = 'object'),
  pass boolean,
  failure_type text check (failure_type in ('not_retrieved', 'retrieved_not_used',
    'wrong_period', 'entity_confusion', 'unsupported_claim', 'refusal_fail', 'injection_fail',
    'format')),
  crag smallint check (crag in (-1, 0, 1)),
  recall real check (recall between 0 and 1),
  error text check (char_length(error) <= 500),
  chat_cost_usd numeric not null default 0 check (chat_cost_usd >= 0),
  judge_cost_usd numeric not null default 0 check (judge_cost_usd >= 0),
  seconds real not null default 0 check (seconds >= 0),
  message_id uuid,
  created_at timestamptz not null default now(),
  unique (run_id, item_id, attempt),
  unique (id, fund_id),
  foreign key (run_id, fund_id) references public.brain_eval_runs(id, fund_id) on delete cascade,
  foreign key (item_id, fund_id) references public.brain_eval_items(id, fund_id) on delete cascade
);
create index brain_eval_attempts_item_idx on public.brain_eval_attempts (item_id, created_at desc);
create index brain_eval_attempts_fund_idx on public.brain_eval_attempts (fund_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Produktejerens rettelser til kalibrering af dommeren (kun serveren)
-- ---------------------------------------------------------------------------
create table public.brain_eval_human_grades (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  attempt_id uuid not null,
  point_id text not null check (point_id ~ '^[fn][0-9]{1,2}$'),
  verdict text not null check (verdict in ('yes', 'no')),
  note text check (char_length(note) <= 2000),
  graded_by text not null check (char_length(graded_by) between 1 and 200),
  graded_at timestamptz not null default now(),
  unique (attempt_id, point_id),
  foreign key (attempt_id, fund_id)
    references public.brain_eval_attempts(id, fund_id) on delete cascade
);
create index brain_eval_human_grades_fund_idx on public.brain_eval_human_grades (fund_id);

-- ---------------------------------------------------------------------------
-- 5. Rettigheder: forsøg og rettelser kun for serveren (svarene kan rumme forseglede spørgsmål)
-- ---------------------------------------------------------------------------
revoke all on public.brain_eval_attempts, public.brain_eval_human_grades
  from public, anon, authenticated;
grant all on public.brain_eval_attempts, public.brain_eval_human_grades to service_role;
alter table public.brain_eval_attempts enable row level security;
alter table public.brain_eval_human_grades enable row level security;

commit;
