-- 0081 · Brugerens behandling af lektioner (til Lært og Playbook).
--
-- Godkend, afvis, ret, pensionér og tilføj en lektion som brugerens egen handling. Funktionen
-- gør det i én transaktion og lader databasens regler (0062) stå ved magt: en lektion bliver
-- kun aktiv ved godkendelse, og approved_by/approved_at sættes sammen. Alt står i brain_log som
-- user:<id>, og hver handling får en række i brain_bullet_events (kind 'user', tæller 0), så
-- "Hvorfor?" kan vise den. En lektion, der rettes, beholder sin embedding (en lille omskrivning
-- ligger tæt på den gamle). Kun service_role kan kalde den; serverfunktionen har tjekket
-- `configure_fund`. Indsigten `lesson_candidate`, der hører til lektionen, lukkes med.

begin;
set local lock_timeout = '5s';

create or replace function public.brain_lesson_review(
  _fund_id uuid,
  _user_id uuid,
  _action text,
  _bullet_id uuid,
  _text text,
  _section text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bullet public.brain_playbook_bullets%rowtype;
  v_text text := nullif(btrim(coalesce(_text, '')), '');
  v_actor text := 'user:' || _user_id::text;
  v_status text;
  v_log_action text;
  v_reason text;
begin
  if _fund_id is null or _user_id is null
     or _action is null or _action not in ('approve', 'reject', 'edit', 'retire', 'add') then
    raise exception 'brain_lesson_review: fund, user and a known action are required';
  end if;
  if v_text is not null and char_length(v_text) > 500 then
    raise exception 'brain_lesson_review: text too long';
  end if;

  if _action = 'add' then
    if v_text is null or _section is null then
      raise exception 'brain_lesson_review: text and section are required';
    end if;
    insert into public.brain_playbook_bullets (fund_id, section, text, status, origin, approved_by,
      approved_at)
    values (_fund_id, _section, v_text, 'active', 'user', _user_id, now())
    returning * into v_bullet;
    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after, reason)
    values (_fund_id, v_actor, 'insert', 'bullet', v_bullet.id,
      jsonb_build_object('short_id', v_bullet.short_id, 'section', v_bullet.section,
        'text', v_bullet.text, 'status', 'active'),
      'Tilføjet af en bruger');
    insert into public.brain_bullet_events (fund_id, bullet_id, reason, source_kind, source_id,
      actor_user_id)
    values (_fund_id, v_bullet.id, 'Tilføjet af en bruger', 'user', gen_random_uuid(), _user_id);
    return jsonb_build_object('id', v_bullet.id, 'shortId', v_bullet.short_id, 'status', 'active');
  end if;

  select * into v_bullet from public.brain_playbook_bullets b
   where b.id = _bullet_id and b.fund_id = _fund_id for update;
  if not found then
    return jsonb_build_object('skipped', 'gone');
  end if;

  if _action = 'approve' then
    if v_bullet.status <> 'candidate' then
      return jsonb_build_object('skipped', 'not_candidate');
    end if;
    v_status := 'active';
    v_log_action := 'approve';
    v_reason := 'Godkendt af en bruger';
  elsif _action = 'reject' then
    if v_bullet.status not in ('candidate', 'active') then
      return jsonb_build_object('skipped', 'not_open');
    end if;
    v_status := 'rejected';
    v_log_action := 'reject';
    v_reason := 'Afvist af en bruger';
  elsif _action = 'retire' then
    if v_bullet.status <> 'active' then
      return jsonb_build_object('skipped', 'not_active');
    end if;
    v_status := 'retired';
    v_log_action := 'retire';
    v_reason := 'Pensioneret af en bruger';
  else
    if v_text is null then
      raise exception 'brain_lesson_review: text is required';
    end if;
    if v_bullet.status not in ('candidate', 'active') then
      return jsonb_build_object('skipped', 'not_open');
    end if;
    if v_text = v_bullet.text then
      return jsonb_build_object('skipped', 'unchanged');
    end if;
    -- A user's rewrite of a candidate is also the approval ("Ret tekst, godkend", 08 §3).
    v_status := 'active';
    v_log_action := 'update';
    v_reason := 'Rettet af en bruger';
  end if;

  update public.brain_playbook_bullets b
     set status = v_status,
         text = case when _action = 'edit' then v_text else b.text end,
         approved_by = case when v_status = 'active' then coalesce(b.approved_by, _user_id)
                            else b.approved_by end,
         approved_at = case when v_status = 'active' then coalesce(b.approved_at, now())
                            else b.approved_at end
   where b.id = v_bullet.id and b.fund_id = _fund_id;

  insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
    reason)
  values (_fund_id, v_actor, v_log_action, 'bullet', v_bullet.id,
    jsonb_build_object('status', v_bullet.status, 'text', v_bullet.text),
    jsonb_build_object('status', v_status, 'text', coalesce(v_text, v_bullet.text)),
    v_reason);

  insert into public.brain_bullet_events (fund_id, bullet_id, reason, source_kind, source_id,
    actor_user_id)
  values (_fund_id, v_bullet.id, v_reason, 'user', gen_random_uuid(), _user_id);

  -- The insight that asked for this decision is done.
  update public.brain_insights i
     set status = case when _action = 'reject' then 'dismissed' else 'accepted' end,
         decided_by = _user_id, decided_at = now()
   where i.fund_id = _fund_id and i.dedupe_key = 'lesson_candidate:' || v_bullet.id::text
     and i.status in ('new', 'seen');

  return jsonb_build_object('id', v_bullet.id, 'status', v_status);
end;
$$;

revoke all on function public.brain_lesson_review(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.brain_lesson_review(uuid, uuid, text, uuid, text, text)
  to service_role;

commit;
