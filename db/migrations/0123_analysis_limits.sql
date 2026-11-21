-- 0123 · Analysegrænser på serveren (spor B2, produktejeren).
--
-- Bygger videre på felterne fra 0036:
--
--   1. funds.analysis_limit_action: hvad der sker, når en fuld analyse ikke passer inden for
--      grænsen ('shrink' = gør den mindre, standard; 'ask' = spørg først).
--   2. funds.monthly_cap_dkk: teamets valgfri månedsgrænse for analyser (null = ingen; 0–10.000 kr.).
--      Håndhæves.
--   3. ai_settings.platform_*_cap_dkk: det hårde loft pr. installation. Et team kan aldrig sætte
--      mere, og en grænse, der står højere fra før, gælder kun op til loftet. Standard er de faste
--      grænser, der gjaldt indtil nu (100 og 500 kr. pr. kørsel). Sættes med customer:settings.
--   4. analysis_runs.usd_to_dkk: kursen, kørslen blev sat op med. Én kurs (ai_settings.usd_to_dkk)
--      omregner nu både loftet og bogføringen, så et loft på 35 kr. også reserverer 35 kr. (før:
--      omregnet med 6,46 og bogført med 6,9, altså 37,26 kr.). Kursen gemmes, så en kørsel, der
--      genoptages, beholder sit budget; null = kørsel fra før denne migration (6,46).
--
-- Kroner er kun for Admin og Lead (beslutningslog 2. nov), og de læser dem gennem serveren. Browserens
-- rolle mister derfor læseretten til beløbene: authenticated havde SELECT på hele funds (0001) og på
-- analysis_runs.cost_cap_dkk (0115), så et Medlem eller en Læser kunne hente grænserne med ét
-- REST-kald. En ny kolonne på funds er herefter lukket for browseren, til den står i en grant her.
-- UPDATE er uændret (0032). Ingen data ændres.

begin;

set local lock_timeout = '5s';

alter table public.funds
  add column analysis_limit_action text not null default 'shrink'
    constraint funds_analysis_limit_action_check check (analysis_limit_action in ('shrink', 'ask')),
  add column monthly_cap_dkk numeric(10, 2)
    constraint funds_monthly_cap_check
      check (monthly_cap_dkk is null or (monthly_cap_dkk >= 0 and monthly_cap_dkk <= 10000));

comment on column public.funds.analysis_limit_action is
  'Når en fuld analyse ikke passer inden for grænsen: shrink (gør den mindre) eller ask (spørg først).';
comment on column public.funds.monthly_cap_dkk is
  'Teamets valgfri månedsgrænse for screeninger og dybe analyser i kr. Null = ingen.';

alter table public.ai_settings
  add column platform_screening_cap_dkk numeric not null default 100
    check (platform_screening_cap_dkk >= 1 and platform_screening_cap_dkk <= 100),
  add column platform_deep_cap_dkk numeric not null default 500
    check (platform_deep_cap_dkk >= 5 and platform_deep_cap_dkk <= 500),
  add column platform_monthly_cap_dkk numeric not null default 10000
    check (platform_monthly_cap_dkk >= 0 and platform_monthly_cap_dkk <= 10000);

comment on column public.ai_settings.platform_screening_cap_dkk is
  'Hårdt loft pr. installation: det højeste en screening må koste i kr., uanset teamets grænse.';
comment on column public.ai_settings.platform_deep_cap_dkk is
  'Hårdt loft pr. installation: det højeste en dyb analyse må koste i kr., uanset teamets grænse.';
comment on column public.ai_settings.platform_monthly_cap_dkk is
  'Hårdt loft pr. installation: den højeste månedsgrænse, et team må sætte i kr.';

alter table public.analysis_runs
  add column usd_to_dkk numeric
    constraint analysis_runs_usd_to_dkk_check check (usd_to_dkk is null or (usd_to_dkk > 0 and usd_to_dkk <= 100));

comment on column public.analysis_runs.usd_to_dkk is
  'Kursen fra ai_settings, kørslen blev sat op med. Null = kørsel fra før 0123 (6,46).';

revoke select on table public.funds from authenticated;
grant select (id, name, slug, created_at, updated_at, member_can_decide, member_can_publish,
  screening_tier, deep_tier, language, demo_view)
  on public.funds to authenticated;

revoke select (cost_cap_dkk) on public.analysis_runs from authenticated;

commit;
