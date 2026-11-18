-- Sikkerhed (forsvar i dybden): Supabases standardrettigheder giver anon og authenticated
-- alle tabelrettigheder på nye tabeller i public. RLS er slået til på alle tabeller, og
-- ingen politik gælder anon, så data kan ikke læses eller skrives af anon i dag. Men
-- TRUNCATE, REFERENCES og TRIGGER er ikke omfattet af RLS, og en fremtidig politik "to
-- public" ville straks åbne for anon. Appen bruger aldrig anon til tabeller (login kræves),
-- og authenticated bruger kun select/insert/update/delete bag RLS.
--
-- 1. Fjern anons tabelrettigheder på alle eksisterende tabeller i public.
-- 2. Fjern TRUNCATE, REFERENCES og TRIGGER fra authenticated.
-- 3. Ret standardrettighederne for tabeller, som postgres (migrationskøreren) opretter
--    fremover, så nye tabeller får samme stramme udgangspunkt.
-- 4. Nye funktioner kan ikke længere kaldes af anon eller PUBLIC som standard (tidligere
--    blev det fjernet i hånden i hver migration). authenticated og service_role beholder
--    deres standardret i public, så RLS-hjælpefunktioner virker som før.

begin;

revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- PUBLIC-retten til funktioner er en global standard og kan kun fjernes uden "in schema".
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

commit;
