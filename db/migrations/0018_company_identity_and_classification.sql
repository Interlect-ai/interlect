-- Fase B: sikker identitet og maskinlæsbar klassifikation.
--
-- 1. Identitet på selskabet: CVR, alle kendte domæner og en identitetsstatus, som
--    kode beregner ud fra match-signaler (B4). Et menneske kan bekræfte eller afvise.
-- 2. Founder-verifikation (B5): verificeret / delvist / kun påstået, med evidens.
-- 3. Land og sektor som nøgler (B6), så Overblik kan tælle og tesen kan matches.
--    Fritekstfelterne (geography, sector) bevares som kildetekst.
--
-- Alt er additivt. Nye kolonner arver tabellernes eksisterende fund-scoped RLS.

begin;

create table public.sector_taxonomy (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  label_da text not null,
  parent_key text references public.sector_taxonomy (key),
  sort integer not null default 0
);

insert into public.sector_taxonomy (key, label_da, sort) values
  ('software_b2b', 'B2B-software', 10),
  ('fintech', 'Fintech', 20),
  ('healthtech', 'Healthtech og life science', 30),
  ('climate_energy', 'Klima og energi', 40),
  ('deeptech_hardware', 'Deeptech og hardware', 50),
  ('robotics_manufacturing', 'Robotter og produktion', 60),
  ('mobility', 'Mobilitet og logistik', 70),
  ('consumer_marketplace', 'Forbruger og markedspladser', 80),
  ('foodtech', 'Foodtech og landbrug', 90),
  ('proptech', 'Proptech og byggeri', 100),
  ('edtech', 'Edtech', 110),
  ('security', 'Sikkerhed og forsvar', 120),
  ('media_gaming', 'Medier og gaming', 130),
  ('other', 'Andet', 999);

alter table public.sector_taxonomy enable row level security;
create policy sector_taxonomy_read on public.sector_taxonomy
  for select to authenticated using (true);
grant select on public.sector_taxonomy to authenticated;
grant all on public.sector_taxonomy to service_role;

alter table public.companies
  add column cvr_number text check (cvr_number is null or cvr_number ~ '^[0-9]{8}$'),
  add column domains text[] not null default '{}',
  add column identity_status text not null default 'unverified'
    check (identity_status in ('unverified', 'uncertain', 'probable', 'confirmed', 'rejected', 'not_danish')),
  add column identity_confidence numeric
    check (identity_confidence is null or identity_confidence between 0 and 1),
  -- Signalerne bag matchet (brand↔domæne, domæne↔CVR, founders↔CVR-deltagere osv.),
  -- så kortet "Er dette det rigtige selskab?" kan vise hvorfor.
  add column identity_signals jsonb not null default '{}'::jsonb,
  add column identity_confirmed_by uuid references auth.users (id) on delete set null,
  add column identity_confirmed_at timestamptz,
  add column hq_country char(2) check (hq_country is null or hq_country ~ '^[A-Z]{2}$'),
  add column operating_countries char(2)[] not null default '{}',
  add column sector_key text references public.sector_taxonomy (key),
  -- Hvem satte klassifikationen: {"hq_country": "cvr", "sector_key": "ai"}.
  -- En menneskelig rettelse ("human") overskrives aldrig af AI eller CVR.
  add column profile_source jsonb not null default '{}'::jsonb;

create index companies_fund_cvr_idx on public.companies (fund_id, cvr_number)
  where cvr_number is not null;

alter table public.company_people
  add column verification_status text not null default 'claimed'
    check (verification_status in ('verified', 'partial', 'claimed')),
  add column registry_role text,
  add column verification_evidence jsonb not null default '{}'::jsonb;

alter table public.fund_mandates
  add column geography_codes char(2)[] not null default '{}',
  add column sector_keys text[] not null default '{}';

commit;
