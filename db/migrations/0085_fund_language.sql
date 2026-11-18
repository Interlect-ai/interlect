-- 0085 · Fondens sprog.
--
--   * Én indstilling pr. fond (team): 'da' (dansk) eller 'en' (English). Valget styrer hele
--     systemet: brugerfladen og alt, AI skriver (screening, dyb analyse, syntese, Brains sider).
--     Brain-chatten svarer på det sprog, brugeren skriver på, uanset indstillingen.
--   * Installationens standard for nye fonde står i ai_settings.default_language (standard 'da';
--     customer:new sætter den). En ny fond uden sprog får installationens standard af en trigger.
--   * Eksisterende fonde får 'da', så intet ændrer sig, før en Admin vælger English.
--   * Kun serveren ændrer sproget (efter et rettighedstjek, som de øvrige fondsindstillinger,
--     0032); brugere kan stadig kun rette navnet direkte.
--
-- Additiv: nye kolonner med standardværdi og en trigger. Ingen data ændres.

begin;

set local lock_timeout = '5s';

alter table public.ai_settings
  add column if not exists default_language text not null default 'da';

alter table public.ai_settings
  drop constraint if exists ai_settings_default_language_check;
alter table public.ai_settings
  add constraint ai_settings_default_language_check check (default_language in ('da', 'en'));

alter table public.funds
  add column if not exists language text not null default 'da';

alter table public.funds
  drop constraint if exists funds_language_check;
alter table public.funds
  add constraint funds_language_check check (language in ('da', 'en'));

comment on column public.funds.language is
  'Fondens sprog (D17): da eller en. Styrer brugerfladen og alt, AI skriver. Ændres kun af serveren.';
comment on column public.ai_settings.default_language is
  'Sproget nye fonde starter med (D17), sat af customer:new. Standard da.';

-- A new fund starts in the installation's language. The column default ('da') is the fallback
-- when the settings row is missing. An insert cannot be told apart from the default, so a fund
-- that must be Danish in an English installation is set afterwards (setFundLanguage).
create or replace function private.fund_default_language()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_language text;
begin
  select s.default_language into v_language from public.ai_settings s where s.id;
  if v_language is not null and new.language = 'da' and v_language <> 'da' then
    new.language := v_language;
  end if;
  return new;
end;
$$;

revoke all on function private.fund_default_language() from public, anon, authenticated;

drop trigger if exists funds_default_language on public.funds;
create trigger funds_default_language
  before insert on public.funds
  for each row execute function private.fund_default_language();

commit;
