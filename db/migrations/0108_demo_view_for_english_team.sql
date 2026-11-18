-- Demovisningen (0106) slås til for det engelske demoteam "Interlect Demo" og kun det.
-- Ingen knap: en kunde kan hverken se eller ændre kolonnen for andre (brugere må kun rette
-- fondens navn direkte, 0032), og nye fonde starter med demo_view = false. Findes holdet ikke
-- (en ny installation), sker der intet. Idempotent.

begin;

update public.funds
   set demo_view = true
 where slug = 'interlect-demo'
   and demo_view is distinct from true;

commit;
