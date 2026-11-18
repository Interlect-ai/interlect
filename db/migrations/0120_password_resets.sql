-- 0120 · Engangslink til ny adgangskode (= A).
--
-- Installationerne sender ingen mails (ingen SMTP i 1.0), så en person, der har glemt sin
-- adgangskode, kunne ikke selv komme ind igen. En Admin laver nu et engangslink til personen
-- (som ved invitationen), og personen vælger selv sin nye adgangskode; Admin ser den aldrig.
--
-- password_resets følger invitations: kun sha256 af tokenet gemmes (aldrig selve tokenet), et
-- link gælder i 48 timer og kan bruges én gang, og et nyt link tilbagekalder de ældre til samme
-- person. Kun serveren (service_role) læser og skriver; browserens roller har ingen adgang, så
-- hverken tokenhash eller e-mail kan hentes over REST.
-- Ingen data ændres.

begin;
set local lock_timeout = '5s';

create table public.password_resets (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email_normalized text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index password_resets_user_idx on public.password_resets (user_id, created_at desc);
-- One open link per person, also when two Admins make one at the same moment.
create unique index password_resets_one_open_idx on public.password_resets (user_id)
  where used_at is null and revoked_at is null;
create index password_resets_fund_idx on public.password_resets (fund_id, created_at desc);

revoke all on table public.password_resets from public, anon, authenticated;
grant all on table public.password_resets to service_role;
alter table public.password_resets enable row level security;

-- Samme begrænsende policy som alle tabeller med RLS (0094).
create policy mfa_required on public.password_resets as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

commit;
