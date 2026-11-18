-- 0116 · Kreditter: hvert trin gemmer, hvad det har trukket mod budgettet (Brain).
--
-- Fundet: den holdbare dybe analyse (deep-worker.server.ts) gemmer ikke sit loft
-- over forbruget (validation_result.budget.chargedUsd), så afregningen fra 0114 har intet loft at
-- afregne en ukendt pris til, og kørslen bogføres til hele reservationen (staging, 30 dage: 2 af 11
-- gennemførte dybe analyser, 37,26 kr.). En kørsel, der fejler eller frigives som hængende,
-- bogføres omvendt kun til de kendte priser, eller til 0 kr., når ingen pris er kendt.
--
-- Den dybe analyse kører i flere funktioner efter hinanden (research, kildeark, specialister,
-- syntese), så kørslens loft kan kun lægges sammen af trinnene. Hvert trin gemmer derfor sit:
--
--   charged_cost = trinnets pris, når den er kendt, ellers maksimum for hvert kald uden pris
--                  (samme regel som budgetCharge i koden). Null: trinnet har ikke kørt, eller det
--                  blev gemt før denne migration (så tæller actual_cost som før).
--
-- Koden lægger trinnene sammen ved afslutning, fejl og frigivelse og skriver summen i
-- validation_result.budget.chargedUsd, som ai_settle_analysis_runs (0114) allerede læser. Ingen
-- funktion eller policy ændres.
--
-- Rettigheder: kolonnen er intern som actual_cost. Efter 0115 (kolonne-grants) har
-- browserens rolle kun SELECT på en navngiven liste af kolonner, så den nye kolonne er lukket.

begin;

set local lock_timeout = '5s';

alter table public.analysis_run_steps
  add column charged_cost numeric check (charged_cost is null or charged_cost >= 0);

comment on column public.analysis_run_steps.charged_cost is
  'USD the step charged against its budget: its price when known, else the maximum of each call without one (T-784).';

commit;
