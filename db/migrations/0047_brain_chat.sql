-- 0047 · Brain-chat: tråde, beskeder og feedback.
--
-- brain_threads: en samtale; privat (kun ejeren) eller team (hele fonden), valgfrit knyttet til en
-- case. brain_messages og brain_feedback følger trådens synlighed (RLS via exists på en synlig
-- tråd). Alle skrivninger sker i serveren (service_role): brugere har kun select. Cases uden for
-- fonden kan ikke knyttes (sammensat fremmednøgle). Opbevaring: brain_retention (0043) sletter
-- tråde uden aktivitet i 24 måneder; beskeder og feedback følger med (cascade).
-- brain_retrieval_events (0043) er fortsat kun for service_role.
--
-- Additiv og bagudkompatibel.

create table public.brain_threads (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid,
  title text check (title is null or char_length(title) <= 200),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  -- PG15+: only case_id is cleared when the case goes, fund_id stays (same-fund rule).
  foreign key (case_id, fund_id) references public.cases(id, fund_id) on delete set null (case_id)
);
create index brain_threads_owner_idx on public.brain_threads (fund_id, user_id, last_activity_at desc);
create index brain_threads_case_idx on public.brain_threads (case_id) where case_id is not null;
create index brain_threads_activity_idx on public.brain_threads (fund_id, last_activity_at);

create table public.brain_messages (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 100000),
  tool_calls jsonb check (tool_calls is null or jsonb_typeof(tool_calls) = 'array'),
  -- [{n, kind: 'chunk'|'fact'|'page'|'bullet'|'case'|'event'|'web', id, label, quote}]
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  used_web boolean not null default false,
  model text check (model is null or char_length(model) <= 100),
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  foreign key (thread_id, fund_id) references public.brain_threads(id, fund_id) on delete cascade
);
create index brain_messages_thread_idx on public.brain_messages (thread_id, created_at);

create table public.brain_feedback (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  message_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('useful', 'wrong', 'incomplete')),
  wrong_citation_ns int[] not null default '{}',
  comment text check (comment is null or char_length(comment) <= 1000),
  promote_to_eval boolean not null default false,
  created_at timestamptz not null default now(),
  unique (message_id, user_id),
  foreign key (message_id, fund_id) references public.brain_messages(id, fund_id) on delete cascade
);

-- A message keeps its thread's last activity (the retention job reads it).
create or replace function public.brain_messages_touch_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.brain_threads t
     set last_activity_at = greatest(t.last_activity_at, new.created_at)
   where t.id = new.thread_id and t.fund_id = new.fund_id;
  return null;
end;
$$;
revoke all on function public.brain_messages_touch_thread() from public, anon, authenticated;

create trigger brain_messages_touch_thread
  after insert on public.brain_messages
  for each row execute function public.brain_messages_touch_thread();

-- Rights: signed-in users read (within RLS); only the server writes.
revoke all on public.brain_threads, public.brain_messages, public.brain_feedback
  from public, anon, authenticated;
grant select on public.brain_threads, public.brain_messages, public.brain_feedback to authenticated;
grant all on public.brain_threads, public.brain_messages, public.brain_feedback to service_role;

alter table public.brain_threads enable row level security;
alter table public.brain_messages enable row level security;
alter table public.brain_feedback enable row level security;

-- Own threads, and the team's threads for every member of the fund.
create policy brain_threads_select on public.brain_threads
  for select to authenticated
  using (
    public.is_fund_member((select auth.uid()), fund_id)
    and (user_id = (select auth.uid()) or visibility = 'team')
  );

-- Messages and feedback are visible through a visible thread (the thread policy applies inside).
create policy brain_messages_select on public.brain_messages
  for select to authenticated
  using (exists (
    select 1 from public.brain_threads t
     where t.id = brain_messages.thread_id and t.fund_id = brain_messages.fund_id));

create policy brain_feedback_select on public.brain_feedback
  for select to authenticated
  using (exists (
    select 1 from public.brain_messages m
     where m.id = brain_feedback.message_id and m.fund_id = brain_feedback.fund_id));
