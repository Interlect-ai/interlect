-- (TS-15, produktejeren): "For nu bruger vi kun ægte navne og ægte setups i vores demo."
-- Demovisningen (0106, slået til i 0108) slås fra for "Interlect Demo", så teamet viser selskabernes
-- og personernes rigtige navne. Holdet findes på slug, ikke navn. Intet slettes: display_aliases og
-- koden bag demovisningen bliver stående (oprydning er en egen ticket). Findes holdet ikke (en ny
-- installation), sker der intet. Idempotent.

begin;

update public.funds
   set demo_view = false
 where slug = 'interlect-demo'
   and demo_view is distinct from false;

commit;
