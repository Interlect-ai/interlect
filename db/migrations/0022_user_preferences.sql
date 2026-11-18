-- P2: brugeren kan skjule moduler og sektioner i analyserne, og
-- valget huskes pr. bruger på tværs af enheder. Én række pr. bruger; kun brugeren selv
-- kan læse og ændre sin række. Indstillingerne er rene visningsvalg og påvirker aldrig
-- analyser, scorer eller andre brugere.

begin;

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Nøgler for skjulte sektioner, fx "screening.economy": højst 100 nøgler, kun små
  -- bogstaver, tal, punktum, bindestreg og understreg, samlet højst 4.000 tegn.
  hidden_sections text[] not null default '{}'
    check (
      cardinality(hidden_sections) <= 100
      and (
        cardinality(hidden_sections) = 0
        or (
          array_ndims(hidden_sections) = 1
          and array_position(hidden_sections, null) is null
          and array_to_string(hidden_sections, ',') ~ '^[a-z0-9._-]{1,80}(,[a-z0-9._-]{1,80})*$'
        )
      )
    ),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

-- Standardrettighederne giver authenticated mere end nødvendigt; start fra nul.
revoke all on public.user_preferences from public, anon, authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

create policy "user_preferences_select_self" on public.user_preferences
for select to authenticated
using (user_id = (select auth.uid()));

create policy "user_preferences_insert_self" on public.user_preferences
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "user_preferences_update_self" on public.user_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

commit;
