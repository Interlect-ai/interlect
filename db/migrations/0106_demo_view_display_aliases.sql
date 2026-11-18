-- (Brain-delen, b): demovisning. Et team kan vise opdigtede navne for selskaber og
-- personer overalt, mens dataene under er rigtige (registrene giver kun tal for rigtige selskaber).
--
-- 1. funds.demo_view: slået fra som standard; kun det engelske demoteam slår den til.
-- 2. display_aliases: ét opdigtet navn pr. rigtigt navn og team (flere rigtige navne, fx mærke- og
--    juridisk navn på samme selskab, kan dele ét alias). Serveren fylder den op, når
--    visningen bruges, og skifter aldrig et navn, der allerede står der (samme navn alle steder).
-- 3. Medlemmer kan læse, kun serveren skriver. Ingen rigtige data ændres: aliasser lægges på
--    tekst på vej ud til skærmen (src/lib/display/), aldrig i evidens, analyser eller modelkald.

begin;

set local search_path = public, extensions;

alter table public.funds
  add column if not exists demo_view boolean not null default false;

create table public.display_aliases (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  kind text not null check (kind in ('company', 'person')),
  real_name text not null check (length(btrim(real_name)) between 1 and 300),
  alias text not null check (length(btrim(alias)) between 1 and 300),
  -- Nøglen til "ét alias pr. rigtigt navn" (PostgREST kan ikke bruge et udtryk som konfliktmål).
  real_key text generated always as (lower(btrim(real_name))) stored,
  created_at timestamptz not null default now(),
  constraint display_aliases_one_per_name unique (fund_id, real_key)
);

grant select on public.display_aliases to authenticated;
grant all on public.display_aliases to service_role;
alter table public.display_aliases enable row level security;

create policy "display_aliases_select_member" on public.display_aliases
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

-- Som alle tabeller (0094): kræver MFA, når brugeren har slået det til.
drop policy if exists mfa_required on public.display_aliases;
create policy mfa_required on public.display_aliases as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

commit;
