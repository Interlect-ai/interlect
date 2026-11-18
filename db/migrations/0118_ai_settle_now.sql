-- 0118 · Kreditmåleren og customer:usage viser det reelle forbrug.
--
-- ai_settle_analysis_runs og ai_release_stale (0071, 0077, 0114) kørte kun inde i ai_reserve: en
-- færdig kørsel stod til hele sin reservation (fx en screening til ca. 1,9 kr. som 10,64 kr.), til
-- nogen i installationen startede noget nyt, og ved månedsskiftet blev uafregnede kørsler
-- faktureret til loftet. ai_settle_now gør det samme som ai_reserve's selvhelbredelse og kaldes af
-- kreditmåleren og af customer:usage og customer:settings, før de læser kreditbogen.
--
-- Ingen tabeller ændres. Kun service_role (og ejeren, som kundescriptsene forbinder som).

begin;

set local lock_timeout = '5s';

create or replace function public.ai_settle_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settled integer;
  v_released integer;
begin
  -- Samme rækkefølge som ai_reserve: færdige kørsler afregnes, så hængende reservationer frigives.
  -- Begge tager ai_settings-låsen.
  v_settled := public.ai_settle_analysis_runs();
  v_released := public.ai_release_stale(interval '3 hours');
  return jsonb_build_object('settled', v_settled, 'released', v_released);
end;
$$;

revoke all on function public.ai_settle_now() from public, anon, authenticated;
grant execute on function public.ai_settle_now() to service_role;

commit;
