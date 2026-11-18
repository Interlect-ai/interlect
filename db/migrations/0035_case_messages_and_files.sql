-- Redesignet: Beskeder på casen (live) og fanen Filer med søgning og
-- kobling til tasks. Plan: (0035).
--
-- 1. case_messages: alle roller må skrive (også Læser), kun forfatteren retter eller sletter egen
--    besked (blød sletning). Systemlinjer (fx "svar på en task") har kind 'system'. Serveren
--    skriver; brugere læser, også via Realtime, hvor RLS afgør, hvem der får hvad.
-- 2. documents får task_id (fil vedhæftet et task-svar), extracted_text og search_fts
--    (filnavn + dansk tekst) med GIN-indeks. Eksisterende decks får deres tekst fra de gemte
--    sider (evidence_items.excerpt), så de også kan findes (læring 27. sep: nye kolonner skal også
--    fyldes for gamle rækker).
-- 3. search_case_documents: søgning i Filer (security invoker, medlemskab tjekkes først).
-- 4. Brugere kan ikke længere oprette eller rette dokumenter direkte (serveren gør det).

begin;

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Beskeder
-- ---------------------------------------------------------------------------

create table public.case_messages (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  author_id uuid not null references auth.users (id) on delete restrict,
  kind text not null default 'user' check (kind in ('user', 'system')),
  body text not null check (char_length(body) between 1 and 5000),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint case_messages_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade
);

create index case_messages_case_idx on public.case_messages (fund_id, case_id, created_at);

create trigger case_messages_touch_case
after insert on public.case_messages
for each row execute function public.touch_case_last_action();

grant select on public.case_messages to authenticated;
grant all on public.case_messages to service_role;
alter table public.case_messages enable row level security;

create policy "case_messages_select_member" on public.case_messages
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

-- Live-opdatering pr. case. Publikationen findes i Supabase; på en database uden den (fx en ren
-- Postgres) springes trinnet over i stedet for at fejle.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.case_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Filer: kobling til tasks og søgning
-- ---------------------------------------------------------------------------

alter table public.case_tasks add constraint case_tasks_id_fund_key unique (id, fund_id);

alter table public.documents
  add column task_id uuid,
  add column extracted_text text check (extracted_text is null or char_length(extracted_text) <= 200000),
  add constraint documents_task_same_fund
    foreign key (task_id, fund_id) references public.case_tasks (id, fund_id)
    on delete set null (task_id);

update public.documents d
set extracted_text = left(pages.text, 200000)
from (
  select e.document_id, string_agg(e.excerpt, E'\n\n' order by e.slide_ref nulls last) as text
  from public.evidence_items e
  where e.document_id is not null and e.excerpt is not null
  group by e.document_id
) as pages
where pages.document_id = d.id and d.extracted_text is null;

alter table public.documents
  add column search_fts tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(file_name, '')), 'A') ||
    setweight(to_tsvector('danish', coalesce(extracted_text, '')), 'B')
  ) stored;

create index documents_fts_idx on public.documents using gin (search_fts);

-- Dokumenter skrives kun af serveren og register_pitch_deck (security definer). Brugerne kunne
-- rette alle kolonner direkte (0004), også den nye kobling til tasks; det lukkes her.
drop policy "documents_insert_team" on public.documents;
drop policy "documents_update_team" on public.documents;
revoke insert, update, delete on public.documents from authenticated;
create index documents_task_idx on public.documents (task_id) where task_id is not null;

-- Søgning i Filer. Filnavne er indekseret uden sprog, teksten på dansk, så søgningen spørger
-- begge veje. Kaldes som brugeren (RLS gælder), og medlemskab tjekkes først (Brain §15).
create or replace function public.search_case_documents(
  _fund_id uuid,
  _query text,
  _case_id uuid default null,
  _limit integer default 50
)
returns table (
  id uuid,
  case_id uuid,
  file_name text,
  kind text,
  task_id uuid,
  created_at timestamptz,
  rank real,
  snippet text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query tsquery;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden';
  end if;
  v_query := websearch_to_tsquery('simple', coalesce(_query, ''))
          || websearch_to_tsquery('danish', coalesce(_query, ''));
  return query
  select d.id, d.case_id, d.file_name, d.kind, d.task_id, d.created_at,
         ts_rank(d.search_fts, v_query) as rank,
         case when d.extracted_text is null then null
              else ts_headline('danish', d.extracted_text, v_query,
                               'MaxFragments=1, MaxWords=24, MinWords=8, StartSel=«, StopSel=»')
         end as snippet
  from public.documents d
  where d.fund_id = _fund_id
    and (_case_id is null or d.case_id = _case_id)
    and d.search_fts @@ v_query
  order by rank desc, d.created_at desc
  limit least(greatest(coalesce(_limit, 50), 1), 200);
end;
$$;

revoke all on function public.search_case_documents(uuid, text, uuid, integer) from public, anon;
grant execute on function public.search_case_documents(uuid, text, uuid, integer)
  to authenticated, service_role;

commit;
