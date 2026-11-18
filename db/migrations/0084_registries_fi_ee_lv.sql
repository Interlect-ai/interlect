-- 0084 · Registre 2: Finland, Estland, Letland, platform.
--
--   * 0083 gav et selskab ét udenlandsk registernummer (NO, SE). Nu kommer Finland (Y-tunnus,
--     skrevet 1234567-8), Estland (registerkode, 8 cifre) og Letland (reg.nr., 11 cifre og starter
--     på 4, 5 eller 9, så en personkode aldrig kan gemmes). Litauen følger.
--   * Kun formatreglerne udvides, så `registry_country` og `cvr_number` kan holde de nye numre
--     (regnskaber for Finland og Letland gemmes i samme tabel som Norges og Sveriges). Ingen data
--     ændres, ingen skriverettigheder ændres (regnskaber skrives kun af serveren, 0030).
--   * Kilderne er stadig `registry_json` (Estland og Letland) og `xbrl_structured` (Finlands
--     XBRL), så `source_kind` er uændret.
--
-- Additiv: udskiftede check-regler. Nøglen (case_id, cvr_number, period_end) gælder stadig.

begin;

set local lock_timeout = '5s';

alter table public.companies
  drop constraint companies_registry_check,
  -- A case expression, so a number without a country is false, not null (a null check passes).
  add constraint companies_registry_check check (
    case
      when registry_number is null then registry_country is null
      when registry_country = 'NO' then registry_number ~ '^[89][0-9]{8}$'
      when registry_country = 'SE' then registry_number ~ '^[0-9]{10}$'
      when registry_country = 'FI' then registry_number ~ '^[0-9]{7}-[0-9]$'
      when registry_country = 'EE' then registry_number ~ '^[0-9]{8}$'
      when registry_country = 'LV' then registry_number ~ '^[459][0-9]{10}$'
      else false
    end
  );

comment on column public.companies.registry_country is
  'Land for et udenlandsk registernummer (NO, SE, FI, EE, LV). Danske selskaber bruger cvr_number.';
comment on column public.companies.registry_number is
  'Selskabets nummer i det udenlandske register (NO: 9 cifre, SE: 10, FI: 1234567-8, EE: 8, LV: 11).';

alter table public.financial_statements
  drop constraint financial_statements_registry_number_check,
  add constraint financial_statements_registry_number_check check (
    (registry_country = 'DK' and cvr_number ~ '^[0-9]{8}$')
    or (registry_country = 'NO' and cvr_number ~ '^[89][0-9]{8}$')
    or (registry_country = 'SE' and cvr_number ~ '^[0-9]{10}$')
    or (registry_country = 'FI' and cvr_number ~ '^[0-9]{7}-[0-9]$')
    or (registry_country = 'EE' and cvr_number ~ '^[0-9]{8}$')
    or (registry_country = 'LV' and cvr_number ~ '^[459][0-9]{10}$')
  );

comment on column public.financial_statements.registry_country is
  'Registrets land: DK (Erhvervsstyrelsen), NO (Brønnøysundregistrene), SE (Bolagsverket), FI (PRH), EE (RIK), LV (data.gov.lv).';

commit;
