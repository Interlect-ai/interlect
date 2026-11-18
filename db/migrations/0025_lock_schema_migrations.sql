-- Sikkerhed: migrationsloggen public.schema_migrations blev oprettet af
-- scripts/run-migrations.mjs uden RLS, så Supabase-standardrettighederne gav anon og
-- authenticated fuld adgang via REST-API'et. Med den offentlige nøgle kunne man tilføje en
-- række (så en migration springes over) eller slette rækker (så gamle migrationer køres
-- igen). Kun køreren, der forbinder som postgres (ejeren), skal kunne læse og skrive den.

begin;

alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from public, anon, authenticated, service_role;

commit;
