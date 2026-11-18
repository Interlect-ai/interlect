-- 0076 · Visningsvaluta for kreditmåleren.
--
-- Regnskabet (ai_credit_ledger, ai_reserve, lofter) forbliver i kroner. Kun visningen følger
-- installationens valuta: DKK for danske kunder, EUR for øvrige. Omregningen sker med en fast
-- kurs i samme række (ingen live-kurs i 1.0): `dkk_per_display_unit` er hvor mange kroner én
-- visningsenhed er værd (1 for DKK, fx 7,46 for EUR). Standarden er DKK og 1, så intet ændrer
-- sig, før en installation får EUR (customer:settings).

begin;
set local lock_timeout = '5s';

alter table public.ai_settings
  add column if not exists display_currency text not null default 'DKK',
  add column if not exists dkk_per_display_unit numeric not null default 1;

alter table public.ai_settings
  drop constraint if exists ai_settings_display_currency_check,
  drop constraint if exists ai_settings_dkk_per_display_unit_check;

alter table public.ai_settings
  add constraint ai_settings_display_currency_check
    check (display_currency in ('DKK', 'EUR')),
  add constraint ai_settings_dkk_per_display_unit_check
    check (dkk_per_display_unit > 0 and dkk_per_display_unit <= 100 and
           (display_currency <> 'DKK' or dkk_per_display_unit = 1));

commit;
