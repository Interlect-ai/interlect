-- 0036 · AI-niveau og prisloft pr. fond.
--
-- Hver fond vælger et niveau (Let, Middel, Tung) for screening og for dyb analyse, og kan
-- bekræfte sit eget prisloft pr. kørsel i kroner. Standard er Middel uden eget loft (loftet
-- følger så niveauets standard i koden, src/lib/analysis/model-tiers.ts). Hver kørsel gemmer
-- det niveau og det loft, den brugte, så en analyse altid kan forklares bagefter.
--
-- Additiv og bagudkompatibel (preview og produktion deler databasen): kun nye kolonner med
-- standardværdi, ingen omdøbning, ingen ændret funktionssignatur. Ældre kode ignorerer dem.
-- Fondsindstillinger skrives kun af serveren (UPDATE på funds er ikke givet til authenticated,
-- 0032), og hver ændring står i audit_events (hvem, hvornår, fra -> til).

alter table public.funds
  add column screening_tier text not null default 'medium'
    constraint funds_screening_tier_check check (screening_tier in ('light', 'medium', 'heavy')),
  add column deep_tier text not null default 'medium'
    constraint funds_deep_tier_check check (deep_tier in ('light', 'medium', 'heavy')),
  -- Null = niveauets standardloft. Et tal er fondens bekræftede loft (hårde grænser i koden
  -- og her, så en tastefejl aldrig kan brænde penge af).
  add column screening_cap_dkk numeric(8, 2)
    constraint funds_screening_cap_check check (screening_cap_dkk is null or (screening_cap_dkk >= 1 and screening_cap_dkk <= 100)),
  add column deep_cap_dkk numeric(8, 2)
    constraint funds_deep_cap_check check (deep_cap_dkk is null or (deep_cap_dkk >= 5 and deep_cap_dkk <= 500));

comment on column public.funds.screening_tier is
  'AI-niveau for screening: light, medium (standard) eller heavy. Påvirker kun nye kørsler.';
comment on column public.funds.deep_tier is
  'AI-niveau for dyb analyse: light, medium (standard) eller heavy. Påvirker kun nye kørsler.';
comment on column public.funds.screening_cap_dkk is
  'Fondens bekræftede prisloft pr. screening i kr. Null = niveauets standardloft.';
comment on column public.funds.deep_cap_dkk is
  'Fondens bekræftede prisloft pr. dyb analyse i kr. Null = niveauets standardloft.';

alter table public.analysis_runs
  add column ai_tier text
    constraint analysis_runs_ai_tier_check check (ai_tier is null or ai_tier in ('light', 'medium', 'heavy')),
  add column cost_cap_dkk numeric(8, 2);

comment on column public.analysis_runs.ai_tier is
  'Niveauet kørslen brugte (null på kørsler fra før R-9b, som brugte Let til screening og Middel til dyb analyse).';
comment on column public.analysis_runs.cost_cap_dkk is
  'Prisloftet i kr. kørslen blev sat op med; serveren stopper kørslen ved det.';
