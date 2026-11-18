-- 0087 · Registre 4: Tyskland, Spanien, Italien, platform.
--
--   * De tre lande har intet gratis API i deres eget register (kun gratis kilder), så
--     selskabet kendes gennem GLEIF, og nøglen er dets LEI (ISO 17442: 18 tegn A–Z/0–9 + 2
--     kontrolcifre). Et tysk HRB-nummer er kun entydigt sammen med sit amtsgericht, og GLEIF's
--     spanske poster har tre slags numre, så landets eget nummer bruges kun til at finde LEI'en.
--   * Kun selskabets formatregel udvides. Regnskaber gemmes ikke for de tre lande (tallene er
--     "ikke tilgængelige i registret"), så `financial_statements` er uændret og afviser stadig DE,
--     ES og IT. Ingen data ændres, ingen skriverettigheder ændres.
--
-- Additiv: udskiftet check-regel.

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
      when registry_country = 'FR' then registry_number ~ '^[0-9]{9}$'
      when registry_country = 'PL' then registry_number ~ '^[0-9]{10}$'
      when registry_country = 'NL' then registry_number ~ '^[0-9]{8}$'
      when registry_country in ('DE', 'ES', 'IT') then registry_number ~ '^[0-9A-Z]{18}[0-9]{2}$'
      else false
    end
  );

comment on column public.companies.registry_country is
  'Land for et udenlandsk registernummer (NO, SE, FI, EE, LV, FR, PL, NL, DE, ES, IT). Danske selskaber bruger cvr_number.';
comment on column public.companies.registry_number is
  'Selskabets nummer i det udenlandske register (NO: 9 cifre, SE: 10, FI: 1234567-8, EE: 8, LV: 11, FR: SIREN 9, PL: KRS 10, NL: KVK 8; DE, ES, IT: LEI fra GLEIF, 20 tegn).';

commit;
