-- Fase B6: engangsudfyldning af land (hq_country) og sektor (sector_key) på eksisterende
-- selskaber ud fra den fritekst, research allerede har gemt. Deterministisk, ingen AI:
-- det FØRSTE land, teksten nævner, er hovedsædet. Kun tomme felter udfyldes, og kilden
-- markeres som "backfill", så en senere menneskelig rettelse altid vinder.
-- Selskaber uden tekst forbliver ukendte (princip 7).

begin;

with country(code, pattern) as (values
  ('DK', 'danmark|denmark|københavn|kobenhavn|copenhagen|aarhus|odense|aalborg'),
  ('SE', 'sverige|sweden|stockholm|göteborg|gothenburg|malmö|sundbyberg'),
  ('NO', 'norge|norway|oslo'),
  ('FI', 'finland|helsinki'),
  ('US', '\musa\M|united states|new york|san francisco|california|florida|tennessee'),
  ('BE', 'belgi|ghent|gent\M|brussel|bruxelles'),
  ('CH', 'schweiz|switzerland|zürich|zurich|geneve|geneva'),
  ('AU', 'australi|sydney|melbourne'),
  ('NL', 'nederland|netherlands|amsterdam'),
  ('DE', 'tyskland|germany|deutschland|berlin|münchen|munich'),
  ('GB', 'storbritannien|united kingdom|england|london'),
  ('FR', 'frankrig|france|paris')
),
first_country as (
  select co.id, (
    select country.code from country
    where regexp_instr(lower(co.geography), country.pattern) > 0
    order by regexp_instr(lower(co.geography), country.pattern)
    limit 1
  ) as code
  from public.companies co
  where co.hq_country is null and co.geography is not null
)
update public.companies co
set hq_country = first_country.code,
    profile_source = co.profile_source || '{"hq_country": "backfill"}'::jsonb
from first_country
where co.id = first_country.id and first_country.code is not null;

with sector(key, pattern, priority) as (values
  ('fintech', 'fintech|spend management|betaling|payment', 1),
  ('healthtech', 'health|sundhed|medtech|life science', 2),
  ('climate_energy', 'energi|energy|klima|climate|carbon|air capture', 3),
  ('robotics_manufacturing', 'robot|cobot|manufactur|machinery|produktion', 4),
  ('deeptech_hardware', 'radar|deep ?tech|sensor|hardware', 5),
  ('mobility', 'mobility|ride-hailing|logisti|transport', 6),
  ('consumer_marketplace', 'consumer|marketplace|forbruger', 7),
  ('foodtech', 'food|agri', 8),
  ('proptech', 'proptech|real estate|ejendom|construction|byggeri', 9),
  ('edtech', 'edtech|education|uddannelse', 10),
  ('security', 'security|sikkerhed|defen', 11),
  ('media_gaming', 'media|gaming|\mgame', 12),
  ('software_b2b', 'software|saas|b2b', 13)
),
first_sector as (
  select co.id, (
    select sector.key from sector
    where lower(co.sector) ~ sector.pattern
    order by sector.priority
    limit 1
  ) as key
  from public.companies co
  where co.sector_key is null and co.sector is not null
)
update public.companies co
set sector_key = first_sector.key,
    profile_source = co.profile_source || '{"sector_key": "backfill"}'::jsonb
from first_sector
where co.id = first_sector.id and first_sector.key is not null;

commit;
