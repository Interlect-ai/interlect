-- 0096 · Brugerens behandling af en indsigt i Lært.
--
-- Indsigter uden en lektion (modsigelser, forældet viden, mønstre, ugens overblik ...) kunne ikke
-- markeres som set eller afvises, så de blev stående i Lært, til de var for gamle til de nyeste
-- 100. Funktionen sætter `brain_insights.status` til 'seen' eller 'dismissed' som brugerens egen
-- handling og skriver den i brain_log som user:<id> i samme transaktion. Indsigter om en lektion
-- (`lesson_candidate`) afgøres stadig gennem lektionen (brain_lesson_review, 0081), så lektion og
-- indsigt ikke kommer ud af trit. Kun service_role kan kalde den; serverfunktionen har tjekket
-- `configure_fund`. Additiv.

begin;
set local lock_timeout = '5s';

create or replace function public.brain_insight_review(
  _fund_id uuid,
  _user_id uuid,
  _insight_id uuid,
  _action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insight public.brain_insights%rowtype;
  v_status text;
begin
  if _fund_id is null or _user_id is null or _insight_id is null
     or _action is null or _action not in ('seen', 'dismiss') then
    raise exception 'brain_insight_review: fund, user, insight and a known action are required';
  end if;

  select * into v_insight from public.brain_insights i
   where i.id = _insight_id and i.fund_id = _fund_id for update;
  if not found then
    return jsonb_build_object('skipped', 'gone');
  end if;
  if v_insight.kind = 'lesson_candidate' then
    return jsonb_build_object('skipped', 'lesson');
  end if;

  v_status := case when _action = 'dismiss' then 'dismissed' else 'seen' end;
  if v_insight.status = v_status then
    return jsonb_build_object('id', v_insight.id, 'status', v_status);
  end if;
  if v_insight.status not in ('new', 'seen') then
    return jsonb_build_object('skipped', 'decided');
  end if;

  update public.brain_insights i
     set status = v_status,
         decided_by = case when v_status = 'dismissed' then _user_id else i.decided_by end,
         decided_at = case when v_status = 'dismissed' then now() else i.decided_at end
   where i.id = v_insight.id and i.fund_id = _fund_id;

  insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
    reason)
  values (_fund_id, 'user:' || _user_id::text,
    case when v_status = 'dismissed' then 'reject' else 'update' end,
    'insight', v_insight.id,
    jsonb_build_object('status', v_insight.status, 'kind', v_insight.kind),
    jsonb_build_object('status', v_status, 'kind', v_insight.kind),
    case when v_status = 'dismissed' then 'Afvist af en bruger' else 'Set af en bruger' end);

  return jsonb_build_object('id', v_insight.id, 'status', v_status);
end;
$$;

revoke all on function public.brain_insight_review(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.brain_insight_review(uuid, uuid, uuid, text) to service_role;

commit;
