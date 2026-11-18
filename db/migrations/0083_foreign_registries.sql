-- 0083 · Udenlandske selskabsregistre, platform.
--
--   * Indtil nu kunne et selskab kun have et dansk CVR-nummer (companies.cvr_number, 8 cifre), og
--     regnskaber kun komme fra Erhvervsstyrelsens XBRL (financial_statements.cvr_number, 8 cifre).
--   * Nu kan et selskab i stedet have et nummer i et udenlandsk register: Norge (org.nr., 9 cifre,
--     Brønnøysundregistrene) og Sverige (org.nr., 10 cifre, Bolagsverket; bruges). Et
--     selskab har højst ét af de to: dansk CVR eller et udenlandsk nummer.
--   * Regnskaber får registrets land (registry_country, standard DK, så alle eksisterende rækker er
--     danske uden opdatering). Kolonnen cvr_number beholder sit navn, så den danske vej er uændret,
--     men holder nu registernummeret i det land. Formatet tjekkes pr. land, og de nye kilder er
--     Regnskapsregisterets JSON (registry_json) og svensk iXBRL (ixbrl_structured).
--   * Nøglen (case_id, cvr_number, period_end) gælder stadig: numrene har forskelligt antal cifre
--     pr. land og kan ikke falde sammen.
--
-- Additiv: nye kolonner og udskiftede check-regler. Ingen data ændres, og skriverettighederne er
-- uændrede (regnskaber skrives kun af serveren, 0030).

begin;

set local lock_timeout = '5s';

alter table public.companies
  add column registry_country char(2),
  add column registry_number text,
  -- A case expression, so a number without a country is false, not null (a null check passes).
  add constraint companies_registry_check check (
    case
      when registry_number is null then registry_country is null
      when registry_country = 'NO' then registry_number ~ '^[89][0-9]{8}$'
      when registry_country = 'SE' then registry_number ~ '^[0-9]{10}$'
      else false
    end
  ),
  add constraint companies_one_registry_check check (cvr_number is null or registry_number is null);

comment on column public.companies.registry_country is
  'Land for et udenlandsk registernummer (NO, SE). Danske selskaber bruger cvr_number.';
comment on column public.companies.registry_number is
  'Selskabets nummer i det udenlandske register, kun cifre (NO: 9, SE: 10).';

create index companies_fund_registry_idx on public.companies (fund_id, registry_country, registry_number)
  where registry_number is not null;

alter table public.financial_statements
  add column registry_country char(2) not null default 'DK',
  drop constraint financial_statements_cvr_number_check,
  add constraint financial_statements_registry_number_check check (
    (registry_country = 'DK' and cvr_number ~ '^[0-9]{8}$')
    or (registry_country = 'NO' and cvr_number ~ '^[89][0-9]{8}$')
    or (registry_country = 'SE' and cvr_number ~ '^[0-9]{10}$')
  ),
  drop constraint financial_statements_source_kind_check,
  add constraint financial_statements_source_kind_check
    check (source_kind in ('xbrl_structured', 'registry_json', 'ixbrl_structured'));

comment on column public.financial_statements.cvr_number is
  'Registernummeret i registry_country (DK: CVR, NO og SE: org.nr.).';
comment on column public.financial_statements.registry_country is
  'Registrets land: DK (Erhvervsstyrelsen), NO (Brønnøysundregistrene), SE (Bolagsverket).';

commit;
