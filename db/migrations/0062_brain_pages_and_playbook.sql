-- 0062 · Brain-sider, lektioner og bullet-events.
--
-- Fase 3 (second brain) får sin datamodel: levende sider (brain_pages og versioner), playbookens
-- lektioner (brain_playbook_bullets) og deres tæller-log (brain_bullet_events), samt
-- analysis_runs.playbook_bullet_ids (hvilke lektioner var i kontekst for en analyse). Indsigterne
-- (brain_insights) findes siden 0043. Intet skrives af denne migration; L4/L2 og side-skriveren
-- Bruger tabellerne bagefter.
--
-- Det, databasen selv holder fast på (så det ikke afhænger af, at koden husker det):
--   * En side har ét antal versioner, der kun vokser: hver ændring af sektionerne giver en ny
--     version (automatisk) og en række i brain_page_versions.
--   * En sektion, en bruger har låst (locked_by_user), kan L4 aldrig ændre eller fjerne; kun en
--     redigering, serveren markerer som brugerens (brain.user_edit), må.
--   * Samme kilde kan kun tælle én gang pr. lektion (unik pr. bullet, source_kind, source_id), og
--     helpful/harmful er altid summen af eventenes deltaer (en trigger), aldrig under 0.
--   * En lektion bliver kun "active", når et menneske har godkendt den, eller når den har mindst
--     to bekræftelser fra forskellige brugere OG forskellige cases (princip 5).
--   * Bullet-events er append-only (som brain_log): kun en cascade eller GDPR-funktionerne må slette.
--   * Alle fremmednøgler er sammensatte (x_id, fund_id): en række peger aldrig ind i en anden fond.
--
-- Rettigheder: medlemmer af fonden kan læse; kun service_role (serveren) kan skrive.
-- Tests: scripts/test-brain-db.mjs (pagesPlaybookDb).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Sider
-- ---------------------------------------------------------------------------
create table public.brain_pages (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  kind text not null check (kind in ('company','person','case','sector','market','theme',
    'investor','thesis','fund_overview')),
  entity_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  -- Sat af koden ved hvert gem (titel + sektionstekst); ikke generated, fordi teksten ligger i json.
  search_fts tsvector,
  embedding vector(1536),
  -- [{key, heading, body_md, fact_ids[], updated_at, locked_by_user}]
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  version int not null default 1 check (version >= 1),
  updated_by text not null check (updated_by ~ '^(L4|user:[0-9a-fA-F-]{36})$'),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique nulls not distinct (fund_id, kind, entity_id),
  -- Thesis- og fund_overview-siderne hører til fonden; alle andre til en entitet.
  check ((kind in ('thesis','fund_overview')) = (entity_id is null)),
  foreign key (entity_id, fund_id)
    references public.brain_entities(id, fund_id) on delete cascade
);
create index brain_pages_fts_idx on public.brain_pages using gin (search_fts);
create index brain_pages_emb_idx on public.brain_pages using hnsw (embedding vector_cosine_ops);
create index brain_pages_fund_kind_idx on public.brain_pages (fund_id, kind);

create table public.brain_page_versions (
  page_id uuid not null,
  fund_id uuid not null,
  version int not null check (version >= 1),
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  change_note text check (char_length(change_note) <= 500),
  changed_by text not null,
  created_at timestamptz not null default now(),
  primary key (page_id, version),
  foreign key (page_id, fund_id) references public.brain_pages(id, fund_id) on delete cascade
);
create index brain_page_versions_fund_idx on public.brain_page_versions (fund_id);

-- A locked section: L4 may neither change nor remove it. A user may (user:<uuid>).
create or replace function public.brain_pages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  end if;
  if tg_op = 'UPDATE' then
    if new.fund_id <> old.fund_id or new.kind <> old.kind
       or new.entity_id is distinct from old.entity_id then
      raise exception 'brain_pages: fund, kind and entity of a page cannot change';
    end if;
    if new.sections is distinct from old.sections then
      -- Only an edit the server marks as a user's (set_config('brain.user_edit', 'on', true)) may
      -- change a locked section; whatever the writer puts in updated_by.
      if new.updated_by = 'L4' or current_setting('brain.user_edit', true) is distinct from 'on' then
        for v_old in select e from jsonb_array_elements(old.sections) e
                     where coalesce((e ->> 'locked_by_user')::boolean, false)
        loop
          select e into v_new from jsonb_array_elements(new.sections) e
           where e ->> 'key' = v_old ->> 'key' limit 1;
          if v_new is null
             or (v_new ->> 'body_md') is distinct from (v_old ->> 'body_md')
             or (v_new ->> 'heading') is distinct from (v_old ->> 'heading')
             or coalesce((v_new ->> 'locked_by_user')::boolean, false) is not true then
            raise exception 'brain_pages: section % is locked by a user and cannot be changed by L4 or a writer that is not a user edit',
              v_old ->> 'key';
          end if;
        end loop;
      end if;
      -- Every change of the sections is a new version, whatever the caller wrote.
      new.version := old.version + 1;
      new.updated_at := now();
    elsif new.version <> old.version then
      raise exception 'brain_pages: the version only changes with the sections';
    end if;
  end if;
  return new;
end;
$$;
create trigger brain_pages_guard_trg
  before insert or update on public.brain_pages
  for each row execute function public.brain_pages_guard();

-- The history: the page as it was stored, one row per version (a note may be set per transaction
-- with set_config('brain.change_note', ..., true)).
create or replace function public.brain_pages_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.brain_page_versions (page_id, fund_id, version, sections, change_note, changed_by)
  values (new.id, new.fund_id, new.version, new.sections,
          left(nullif(current_setting('brain.change_note', true), ''), 500), new.updated_by)
  on conflict (page_id, version) do nothing;
  return new;
end;
$$;
create trigger brain_pages_history_trg
  after insert or update of sections on public.brain_pages
  for each row execute function public.brain_pages_history();

-- ---------------------------------------------------------------------------
-- 2. Lektioner (playbook) og deres tæller-log
-- ---------------------------------------------------------------------------
create table public.brain_playbook_bullets (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  short_id text not null check (short_id ~ '^pb-[0-9]{5,9}$'),
  section text not null check (section in ('strategies','red_flags','green_flags',
    'questions_to_ask','sector_notes','process','common_mistakes')),
  text text not null check (char_length(text) between 1 and 500),
  scope jsonb not null default '{}' check (jsonb_typeof(scope) = 'object'),
  helpful int not null default 0 check (helpful >= 0),
  harmful int not null default 0 check (harmful >= 0),
  status text not null default 'candidate'
    check (status in ('candidate','active','retired','rejected')),
  origin text not null check (origin in ('brain','user')),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  approved_by uuid,
  approved_at timestamptz,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, fund_id),
  unique (fund_id, short_id),
  check ((approved_by is null) = (approved_at is null))
);
create index brain_playbook_bullets_status_idx on public.brain_playbook_bullets (fund_id, status);
create index brain_playbook_bullets_emb_idx on public.brain_playbook_bullets
  using hnsw (embedding vector_cosine_ops);

create table public.brain_bullet_events (
  id bigserial primary key,
  fund_id uuid not null,
  bullet_id uuid not null,
  delta_helpful int not null default 0,
  delta_harmful int not null default 0,
  reason text not null check (char_length(reason) between 1 and 500),
  source_kind text not null check (source_kind in ('create','corroborate','tag_decision',
    'tag_outcome','user','revert')),
  source_id uuid,
  actor_user_id uuid,
  case_key text check (char_length(case_key) <= 200),
  created_at timestamptz not null default now(),
  -- The same source counts once per lesson (a repeated send changes nothing).
  -- Only the creation event may lack a source; every other count names what it counts.
  check (source_kind = 'create' or source_id is not null),
  unique nulls not distinct (bullet_id, source_kind, source_id),
  foreign key (bullet_id, fund_id)
    references public.brain_playbook_bullets(id, fund_id) on delete cascade
);
create index brain_bullet_events_bullet_idx on public.brain_bullet_events (bullet_id, created_at);
create index brain_bullet_events_fund_idx on public.brain_bullet_events (fund_id);

-- The independent confirmations of a lesson: the 'create' and 'corroborate' events count
-- once per user and once per case, so the number is the smaller of the distinct users and the
-- distinct cases (two confirmations by the same user, or on the same case, are one).
create or replace function public.brain_bullet_independent_confirmations(
  _fund_id uuid,
  _bullet_id uuid
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select least(count(distinct e.actor_user_id), count(distinct e.case_key))::int
  from public.brain_bullet_events e
  where e.fund_id = _fund_id and e.bullet_id = _bullet_id
    and e.source_kind in ('create', 'corroborate')
    and e.actor_user_id is not null and e.case_key is not null
$$;

-- pb-00001, pb-00002 ... per fund. The advisory lock keeps two inserts in one fund from taking
-- the same number; the unique (fund_id, short_id) stays as the last guard.
create or replace function public.brain_bullets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next int;
begin
  if tg_op = 'INSERT' then
    if new.short_id is null then
      perform pg_advisory_xact_lock(hashtextextended('brain_pb:' || new.fund_id::text, 0));
      select coalesce(max(substring(b.short_id from 4)::int), 0) + 1 into v_next
      from public.brain_playbook_bullets b where b.fund_id = new.fund_id;
      new.short_id := 'pb-' || lpad(v_next::text, 5, '0');
    end if;
    if new.status = 'active' and new.approved_by is null then
      raise exception 'brain_playbook_bullets: a lesson becomes active only when it is approved or confirmed';
    end if;
  else
    if new.fund_id <> old.fund_id or new.short_id <> old.short_id then
      raise exception 'brain_playbook_bullets: fund and short id cannot change';
    end if;
    if new.status = 'active' and old.status <> 'active' and new.approved_by is null
       and public.brain_bullet_independent_confirmations(new.fund_id, new.id) < 2 then
      raise exception 'brain_playbook_bullets: a lesson needs a human approval or two independent confirmations to become active';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger brain_bullets_guard_trg
  before insert or update on public.brain_playbook_bullets
  for each row execute function public.brain_bullets_guard();

-- helpful/harmful are the sums of the events' deltas (never edited by hand).
create or replace function public.brain_bullet_event_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.brain_playbook_bullets b
     set helpful = b.helpful + new.delta_helpful,
         harmful = b.harmful + new.delta_harmful,
         updated_at = now()
   where b.id = new.bullet_id and b.fund_id = new.fund_id;
  return new;
end;
$$;
create trigger brain_bullet_event_apply_trg
  after insert on public.brain_bullet_events
  for each row execute function public.brain_bullet_event_apply();

-- The same after a GDPR change or delete of an event, so the counters stay the sum of the events.
create or replace function public.brain_bullet_event_unapply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.brain_playbook_bullets b
     set helpful = greatest(0, b.helpful - old.delta_helpful + case when tg_op = 'UPDATE' then new.delta_helpful else 0 end),
         harmful = greatest(0, b.harmful - old.delta_harmful + case when tg_op = 'UPDATE' then new.delta_harmful else 0 end),
         updated_at = now()
   where b.id = old.bullet_id and b.fund_id = old.fund_id;
  return coalesce(new, old);
end;
$$;
create trigger brain_bullet_event_unapply_trg
  after update or delete on public.brain_bullet_events
  for each row execute function public.brain_bullet_event_unapply();

-- Append-only: a cascade (the lesson or the fund is deleted) or the GDPR functions may change it.
create or replace function public.brain_bullet_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('brain.gdpr', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE'
     and (pg_trigger_depth() > 1
          or not exists (select 1 from public.brain_playbook_bullets b where b.id = old.bullet_id)) then
    return old;
  end if;
  raise exception 'brain_bullet_events is append-only';
end;
$$;
create trigger brain_bullet_events_append_only_trg
  before update or delete on public.brain_bullet_events
  for each row execute function public.brain_bullet_events_append_only();

-- ---------------------------------------------------------------------------
-- 3. Hvilke lektioner var i kontekst for en analyse
-- ---------------------------------------------------------------------------
alter table public.analysis_runs
  add column playbook_bullet_ids uuid[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 4. Rettigheder: medlemmer læser, kun serveren skriver
-- ---------------------------------------------------------------------------
revoke all on public.brain_pages, public.brain_page_versions, public.brain_playbook_bullets,
  public.brain_bullet_events from public, anon, authenticated;
grant select on public.brain_pages, public.brain_page_versions, public.brain_playbook_bullets,
  public.brain_bullet_events to authenticated;
grant all on public.brain_pages, public.brain_page_versions, public.brain_playbook_bullets,
  public.brain_bullet_events to service_role;
revoke all on sequence public.brain_bullet_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.brain_bullet_events_id_seq to service_role;

alter table public.brain_pages enable row level security;
alter table public.brain_page_versions enable row level security;
alter table public.brain_playbook_bullets enable row level security;
alter table public.brain_bullet_events enable row level security;

create policy brain_pages_select_member on public.brain_pages
  for select to authenticated using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_page_versions_select_member on public.brain_page_versions
  for select to authenticated using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_playbook_bullets_select_member on public.brain_playbook_bullets
  for select to authenticated using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_bullet_events_select_member on public.brain_bullet_events
  for select to authenticated using (public.is_fund_member((select auth.uid()), fund_id));

revoke all on function public.brain_bullet_independent_confirmations(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.brain_bullet_independent_confirmations(uuid, uuid) to service_role;
revoke all on function public.brain_pages_guard(), public.brain_pages_history(),
  public.brain_bullets_guard(), public.brain_bullet_event_apply(),
  public.brain_bullet_events_append_only(), public.brain_bullet_event_unapply()
  from public, anon, authenticated;

commit;
