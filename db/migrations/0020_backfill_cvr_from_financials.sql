-- Fase B: selskaber, hvis offentlige regnskaber allerede er hentet på et CVR-nummer,
-- får det CVR-nummer på selve selskabet. Kun når casen har præcis ét CVR i sine
-- regnskaber, og kun når feltet er tomt. Land sættes til DK, medmindre et menneske
-- har rettet det. Identiteten vurderes fuldt ud ved næste screening.

begin;

with single_cvr as (
  select ca.company_id, min(fs.cvr_number) as cvr_number
  from public.financial_statements fs
  join public.cases ca on ca.id = fs.case_id and ca.fund_id = fs.fund_id
  group by ca.company_id
  having count(distinct fs.cvr_number) = 1
)
update public.companies co
set cvr_number = single_cvr.cvr_number,
    hq_country = case when co.profile_source ->> 'hq_country' = 'human' then co.hq_country else 'DK' end,
    profile_source = case
      when co.profile_source ->> 'hq_country' = 'human' then co.profile_source
      else co.profile_source || '{"hq_country": "cvr"}'::jsonb
    end
from single_cvr
where co.id = single_cvr.company_id
  and co.cvr_number is null
  and single_cvr.cvr_number ~ '^[0-9]{8}$';

commit;
