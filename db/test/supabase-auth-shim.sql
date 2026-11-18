-- Kun til lokale tests (scripts/local-db.mjs). Aldrig en migration.
--
-- I en rigtig Supabase-installation opretter Auth-tjenesten (GoTrue) selv auth.mfa_factors.
-- Billedet supabase/postgres har kun databasens del af skemaet auth, så de kolonner, 0094 og
-- test:rls bruger, efterlignes her. Findes tabellen allerede, røres den ikke.
-- Køres som supabase_admin af scripts/local-db.mjs.

begin;

set local client_min_messages = warning;

create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on auth.mfa_factors to postgres;

commit;
