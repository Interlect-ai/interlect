-- P3 (masterplan): en analytiker kan foreslå ændringer til fondsopsætningen uden selv at
-- kunne ændre den. Forslagene er synlige for hele fondens team; en partner eller
-- administrator markerer dem som løst. Et forslag ændrer aldrig opsætningen eller analyser.
-- Forslag kan ikke rettes eller slettes (princip 13); kun status skifter, og databasen
-- sætter selv hvem og hvornår.

begin;

create table public.fund_config_suggestions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null))
);

create index fund_config_suggestions_fund_idx
  on public.fund_config_suggestions(fund_id, status, created_at desc);
create index fund_config_suggestions_author_idx on public.fund_config_suggestions(author_id);
create index fund_config_suggestions_resolved_by_idx
  on public.fund_config_suggestions(resolved_by);

-- Løsning og genåbning stemples af databasen, så ingen kan vælge et andet tidspunkt eller
-- løse på en andens vegne.
create or replace function public.stamp_fund_config_suggestion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' then
    if old.status is distinct from 'resolved' then
      new.resolved_by := auth.uid();
      new.resolved_at := now();
    else
      new.resolved_by := old.resolved_by;
      new.resolved_at := old.resolved_at;
    end if;
  else
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_fund_config_suggestion() from public, anon, authenticated;

-- Kun ved ændring af status: "on delete set null" på resolved_by er også en UPDATE, og den
-- må triggeren ikke rulle tilbage.
create trigger fund_config_suggestions_stamp
before update of status on public.fund_config_suggestions
for each row execute function public.stamp_fund_config_suggestion();

revoke all on public.fund_config_suggestions from public, anon, authenticated;
grant select on public.fund_config_suggestions to authenticated;
-- Ved oprettelse vælger klienten kun fond, forfatter (sig selv) og tekst.
grant insert (fund_id, author_id, body) on public.fund_config_suggestions to authenticated;
-- Kun status kan ændres; tekst, forfatter og fond står fast, og tidsstemplerne sættes af
-- triggeren.
grant update (status) on public.fund_config_suggestions to authenticated;
grant all on public.fund_config_suggestions to service_role;

alter table public.fund_config_suggestions enable row level security;

create policy "fund_config_suggestions_select_member" on public.fund_config_suggestions
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

create policy "fund_config_suggestions_insert_team" on public.fund_config_suggestions
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and status = 'open'
  and resolved_by is null
  and resolved_at is null
  and public.is_fund_member((select auth.uid()), fund_id)
  and (
    public.has_fund_role((select auth.uid()), fund_id, 'analyst')
    or public.has_fund_role((select auth.uid()), fund_id, 'partner')
    or public.has_fund_role((select auth.uid()), fund_id, 'administrator')
  )
);

-- Samme regel som fondsopsætningen (0021): partner eller administrator.
create policy "fund_config_suggestions_resolve_partner" on public.fund_config_suggestions
for update to authenticated
using (public.can_configure_fund((select auth.uid()), fund_id))
with check (public.can_configure_fund((select auth.uid()), fund_id));

commit;
