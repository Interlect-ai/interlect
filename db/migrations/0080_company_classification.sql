-- 0080 · Sektor og land som nøgler ud fra selskabets egen tekst, platform.
--
--   * Overblikkets "Sektor og fase" og "Geografi" tæller companies.sector_key og hq_country (0018),
--     men ingen kode skrev sector_key, og hq_country blev kun sat fra CVR (DK). Rigtige cases
--     stod derfor som "Ikke klassificeret" og "uden kendt land", selvom selskabets fritekst
--     (sector, geography; fra Opret case eller screeningens offentlige profil) sagde det.
--   * Nu sætter databasen selv nøglerne, hver gang teksten skrives (en trigger, så alle veje er
--     dækket: Opret case, screeningens profil, CSV-import og kommende kode), og migrationen
--     klassificerer de eksisterende selskaber én gang.
--   * Facit er en fast liste af hele ord pr. sektor i sector_taxonomy og pr. land (dansk og
--     engelsk, byer med). Ingen AI og intet gæt: en tekst uden et kendt ord giver ingen nøgle, og
--     Overblik tæller den som ukendt. Sektor: nævner teksten flere, vinder en branche (fx fintech)
--     over den generelle "B2B-software", og ellers den først nævnte ("B2B-software / fintech" er
--     fintech). Land: ét land (også som by eller en kode alene, "DK") er svaret; nævner teksten
--     flere, gælder kun det, den kalder hovedkontor ("hovedkontor i", "HQ", "headquartered"),
--     ellers er landet ukendt.
--   * Et menneskes valg (profile_source "human") og CVR's land ("cvr") overskrives aldrig. Hvad
--     teksten har sat ("text", eller "backfill" fra 0019), følger teksten, når den ændres.
--
-- Additiv: to rene funktioner, en trigger og en engangsfunktion i private; ingen tabel eller
-- kolonne ændres.

begin;

set local lock_timeout = '5s';

-- The sector key a free text names, or null. Pure, so it is tested on its own. Whole words (or
-- explicit Danish stems such as "betaling" for "betalingsløsninger"), so "hospitality",
-- "mediation" or "marketing automation" do not count as health, media or robots.
create or replace function private.company_sector_key(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with t as (
    select lower(regexp_replace(coalesce(p_text, ''), '[_/|,;:()-]+', ' ', 'g')) as s
  ),
  rules (key, vertical, pattern) as (values
    ('fintech', true,
      '\m(fintech|insurtech|regtech|wealthtech|paytech|neobanks?\M|betaling|payments?\M|banking\M|banks?\M|forsikring|insurance\M|lending\M|udlån|kreditkort|credit cards?\M|finansiel|financial services|kryptovaluta|cryptocurrenc|crypto\M|regnskab|accounting\M|bogføring|bookkeeping|fakturer|invoicing\M|expense management|spend management|udgiftsstyring|pension|opsparing|savings\M)'),
    ('healthtech', true,
      '\m(healthtech|health\M|healthcare|health care|digital health|medtech|biotech|life sciences?\M|lifescience|sundhed|medicin|medical\M|pharma|farma|diagnos|hospital(s|er)?\M|klinisk|clinical\M|patient(s|er)?\M|terapi|therapeut|telemedicin|telehealth\M)'),
    ('climate_energy', true,
      '\m(climate\M|climatetech|klima|cleantech|greentech|energi|energy\M|solenergi|solceller|solar\M|vindenergi|vindmølle|wind (power|energy|turbines?)\M|batteri|batter(y|ies)\M|co2\M|carbon\M|decarboni|hydrogen\M|brint|varmepumpe|heat pumps?\M|elektrificering|electrification\M|air capture)'),
    ('deeptech_hardware', true,
      '\m(deeptech|deep tech|hardware\M|halvleder|semiconductors?\M|quantum\M|kvante|fotonik|photonics?\M|sensor|chips?\M|space tech|spacetech|rumfart|satellit|satellites?\M|radar\M)'),
    ('robotics_manufacturing', true,
      '\m(robot|cobots?\M|manufacturing\M|industrial\M|industri 4|3d print|cnc\M|factor(y|ies)\M|fabrik(ker)?\M|machinery\M)'),
    ('mobility', true,
      '\m(mobility\M|mobilitet|logistik|logistics\M|transport|shipping\M|fragt|freight\M|supply chain|forsyningskæde|elbil|electric vehicles?\M|ev charging|ladestander|fleets?\M|flåde|ride hailing|trucking\M|last mile)'),
    ('consumer_marketplace', true,
      '\m(marketplaces?\M|markedsplads|consumer\M|forbruger|d2c\M|dtc\M|e handel|e commerce\M|ecommerce\M|webshop|legetøj|toys?\M|fashion\M|tøj\M|clothing\M|apparel\M)'),
    ('foodtech', true,
      '\m(foodtech|food\M|fødevare|landbrug|agritech|agtech|agricultur|akvakultur|aquaculture\M|restaurant|alternative proteins?\M|plantebaser|plant based|farming\M|meal kits?\M)'),
    ('proptech', true,
      '\m(proptech|contech|ejendom|real estate|byggeri|construction\M|bolig|housing\M|facility management)'),
    ('edtech', true,
      '\m(edtech|uddannelse|education\M|e learning|elearning|læring|skoler?\M|schools?\M|undervisning|language learning)'),
    ('security', true,
      '\m(cybersikkerhed|cybersecurity|cyber\M|cyber security|it sikkerhed|informationssikkerhed|security\M|sikkerhed\M|forsvar\M|defence\M|defense\M)'),
    ('media_gaming', true,
      '\m(media\M|medier\M|mediehus|gaming\M|games?\M|game studio|spil\M|spiludvikl|computerspil|musik|music\M|music streaming|video streaming|underholdning|entertainment\M)'),
    ('software_b2b', false,
      '\m(b2b\M|saas\M|software\M|enterprise software|devtools\M|developer tools|udvikler|ai\M|kunstig intelligens|artificial intelligence|machine learning|maskinlæring|cloud\M|data\M|analytics\M|platform\M|workflow|automation\M|automatisering|hr tech|hrtech|api\M|computerprogrammering|softwareudvikling)')
  ),
  hits as (
    select r.key, r.vertical, regexp_instr(t.s, r.pattern, 1, 1, 0, 'i') as at
    from rules r cross join t
  )
  select key from hits where at > 0 order by vertical desc, at, key limit 1;
$$;

-- The country (ISO 3166-1 alpha-2) of the head office a free text names, or null. One country
-- named (also as a city or a code on its own) is the answer. Several: only the one next to
-- "hovedkontor", "hovedsæde", "HQ" or "headquartered" ("København HQ", "HQ i Oslo"); without
-- such a word it is unknown, never a guess.
create or replace function private.company_country_code(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with t as (
    select upper(btrim(coalesce(p_text, ''))) as code,
           lower(regexp_replace(coalesce(p_text, ''), '[_/|,;:()-]+', ' ', 'g')) as s
  ),
  rules (code, pattern) as (values
    ('DK', '\m(danmark|denmark|dansk|danish|københavn|kobenhavn|copenhagen|aarhus|århus|odense|aalborg)'),
    ('SE', '\m(sverige|sweden|svensk|swedish|stockholm|göteborg|goteborg|gothenburg|malmö|malmo|uppsala|sundbyberg)'),
    ('NO', '\m(norge|norway|norsk|norwegian|oslo\M|bergen\M|trondheim|stavanger)'),
    ('FI', '\m(finland|finsk|finnish|helsinki|helsingfors|espoo|tampere)'),
    ('IS', '\m(iceland|islandsk|icelandic|reykjav)'),
    ('DE', '\m(tyskland|germany|deutschland|tysk\M|german\M|berlin\M|münchen|munich|hamburg\M|frankfurt\M)'),
    ('GB', '\m(storbritannien|united kingdom|england\M|uk\M|britisk|british\M|london\M|manchester\M|edinburgh|skotland|scotland\M)'),
    ('NL', '\m(holland\M|nederland|netherlands|hollandsk|dutch\M|amsterdam|rotterdam|utrecht|eindhoven)'),
    ('FR', '\m(frankrig|france\M|fransk|french\M|paris\M|lyon\M)'),
    ('ES', '\m(spanien|spain\M|spansk|spanish\M|madrid\M|barcelona\M)'),
    ('IT', '\m(italien|italy\M|italiensk|italian\M|milano\M|milan\M)'),
    ('CH', '\m(schweiz|switzerland|swiss\M|zürich|zurich|genève|geneve|geneva|lausanne)'),
    ('AT', '\m(østrig|austria\M|austrian\M|wien\M|vienna\M)'),
    ('BE', '\m(belgien|belgium|belgisk|belgian\M|bruxelles|brussels\M|antwerpen|antwerp\M|ghent\M|gent\M)'),
    ('IE', '\m(irland\M|ireland\M|irsk\M|irish\M|dublin\M)'),
    ('PT', '\m(portugal\M|portugisisk|portuguese\M|lissabon|lisbon\M)'),
    ('PL', '\m(polen\M|poland\M|polsk\M|polish\M|warszawa|warsaw\M|kraków|krakow)'),
    ('EE', '\m(estland|estonia\M|estisk|estonian\M|tallinn|tartu\M)'),
    ('LV', '\m(letland|latvia\M|riga\M)'),
    ('LT', '\m(litauen|lithuania\M|vilnius)'),
    ('US', '\m(usa\M|united states|new york|san francisco|silicon valley|boston\M|californi|florida\M|texas\M)'),
    ('CA', '\m(canada\M|canadisk|canadian\M|toronto\M|vancouver\M|montreal\M)'),
    ('AU', '\m(australi|sydney\M|melbourne\M)'),
    ('IL', '\m(israel\M|tel aviv)'),
    ('SG', '\m(singapore\M)'),
    ('IN', '\m(indien\M|india\M|bangalore|bengaluru)')
  ),
  hits as (
    select r.code,
           regexp_instr(t.s, r.pattern, 1, 1, 0, 'i') as at,
           regexp_instr(t.s, r.pattern, 1, 1, 1, 'i') as after
    from rules r cross join t
  ),
  found as (select * from hits where at > 0),
  -- "hovedkontor i Oslo", "headquartered in Oslo": the country comes after the word.
  word as (
    select regexp_instr(t.s, '\m(hovedkontor|hovedsæde|headquarter)', 1, 1, 1, 'i') as after
    from t
  ),
  -- "HQ in London", "HQ: Oslo" (right after it), else "Copenhagen HQ" (right before it).
  hq as (
    select regexp_instr(t.s, '\mhq\M', 1, 1, 0, 'i') as at,
           regexp_instr(t.s, '\mhq\M', 1, 1, 1, 'i') as after
    from t
  )
  select coalesce(
    -- A known code on its own ("DK"), as the seed data and some imports write it.
    (select r.code from rules r cross join t where r.code = t.code),
    -- Exactly one country named.
    (select min(code) from found having count(*) = 1),
    -- Several: only the one the text names as the head office. Otherwise unknown.
    (select f.code from found f cross join word w
      where w.after > 0 and f.at >= w.after and f.at - w.after <= 25
      order by f.at limit 1),
    (select f.code from found f cross join hq h
      where h.at > 0 and f.at >= h.after and f.at - h.after <= 5
      order by f.at limit 1),
    (select f.code from found f cross join hq h
      where h.at > 0 and f.after <= h.at and h.at - f.after <= 2
      order by f.after desc limit 1)
  );
$$;

revoke all on function private.company_sector_key(text) from public, anon, authenticated;
revoke all on function private.company_country_code(text) from public, anon, authenticated;
grant execute on function private.company_sector_key(text) to service_role;
grant execute on function private.company_country_code(text) to service_role;

-- Sets the keys whenever the text is written. A human's choice is never overwritten, and CVR's
-- country only by CVR or a human.
create or replace function private.companies_classify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb := coalesce(new.profile_source, '{}'::jsonb);
begin
  if (v_source ->> 'sector_key') is distinct from 'human'
     and (tg_op = 'INSERT' or new.sector is distinct from old.sector) then
    new.sector_key := private.company_sector_key(new.sector);
    v_source := case when new.sector_key is null then v_source - 'sector_key'
                     else v_source || jsonb_build_object('sector_key', 'text') end;
  end if;
  if (v_source ->> 'hq_country') is distinct from 'human'
     and (new.hq_country is null or (v_source ->> 'hq_country') in ('text', 'backfill'))
     and (tg_op = 'INSERT' or new.geography is distinct from old.geography
          or new.hq_country is null) then
    new.hq_country := private.company_country_code(new.geography);
    v_source := case when new.hq_country is null then v_source - 'hq_country'
                     else v_source || jsonb_build_object('hq_country', 'text') end;
  end if;
  new.profile_source := v_source;
  return new;
end;
$$;

revoke all on function private.companies_classify() from public, anon, authenticated;

drop trigger if exists companies_classify on public.companies;
create trigger companies_classify
  before insert or update of sector, geography, hq_country on public.companies
  for each row execute function private.companies_classify();

-- Once over the companies already there (and again by hand if the lists grow): only empty keys,
-- never a human's or CVR's. Returns how many got a sector and a country.
create or replace function private.companies_classify_backfill()
returns table (sectors integer, countries integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.companies c
     set sector_key = private.company_sector_key(c.sector),
         profile_source = coalesce(c.profile_source, '{}'::jsonb)
           || jsonb_build_object('sector_key', 'text')
   where c.sector_key is null
     and (c.profile_source ->> 'sector_key') is distinct from 'human'
     and private.company_sector_key(c.sector) is not null;
  get diagnostics sectors = row_count;
  update public.companies c
     set hq_country = private.company_country_code(c.geography),
         profile_source = coalesce(c.profile_source, '{}'::jsonb)
           || jsonb_build_object('hq_country', 'text')
   where c.hq_country is null
     and (c.profile_source ->> 'hq_country') is distinct from 'human'
     and private.company_country_code(c.geography) is not null;
  get diagnostics countries = row_count;
  return next;
end;
$$;

revoke all on function private.companies_classify_backfill() from public, anon, authenticated;
grant execute on function private.companies_classify_backfill() to service_role;

select * from private.companies_classify_backfill();

commit;
