-- 0098 · Gemt instruktionsflag på episoden.
--
-- Chatten finder instruktioner til en AI i en kilde med mønstre, når et værktøj viser teksten
-- . Det dækker kun det stykke, der vises: står instruktionen i et andet stykke af samme
-- dokument, eller ser mønstrene den ikke, får modellen intet flag. L1-udtrækket (der allerede
-- læser hele episoden) kører nu mønstrene på hele teksten og spørger sin model, om teksten
-- henvender sig til en AI; begrundelserne gemmes her og følger alle episodens stykker og fakta.
-- Null = ikke tjekket (eller intet fundet). Kun begrundelseskoder, aldrig tekst fra kilden.
-- Additiv; ingen backfill (gamle episoder har stadig mønstertjekket ved visning).

begin;
set local lock_timeout = '5s';

alter table public.brain_episodes
  add column if not exists instruction_flag text[]
    check (instruction_flag is null or cardinality(instruction_flag) between 1 and 10);

comment on column public.brain_episodes.instruction_flag is
  'Hvorfor episoden ser ud til at indeholde instruktioner til en AI (mønsterkoder og "model"), sat af L1-udtrækket (T-703). Null = intet fundet eller ikke tjekket.';

commit;
