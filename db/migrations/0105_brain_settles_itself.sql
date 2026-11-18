-- (minimal): Brain afgør selv modstrid, dubletter og lektioner i baggrunden
-- ("det skal ikke vises, det er noget de skal mærke").
--
-- Tre afgørelser, alle med en fast regel, alle i brain_log med årsagen, og ingen af dem sletter noget:
--
--  1. Dubletter. Når resolveren er sikker (>= 0,9) på, at to navne er det samme, lægger Brain dem
--     sammen (brain_merge_entities, som kan fortrydes med "Adskil"). Vinderen er den, der kommer fra
--     databasen, ellers den ældste. Afviser 0055 sammenlægningen, bliver indsigten stående.
--  2. Modstrid. To aktive facts om det samme (indsigt `contradiction` med to facts): den stærkeste
--     kilde vinder (official > partner > ... > company_claim; en fact fra databasen vinder over alt),
--     og ved samme styrke den nyeste. Taberen udløber (expired_at, superseded_by), så søgningen kun
--     ser vinderen; årsagen står i brain_log og i indsigten, som lukkes som accepteret af Brain.
--     Ved samme styrke og samme tidspunkt afgør Brain ikke noget.
--  3. Lektioner. En lektion, som tre forskellige cases har bekræftet, og som ingen har kaldt skadelig,
--     bliver aktiv af sig selv (før krævede den to bekræftelser fra to forskellige brugere, som et
--     lille team aldrig når). Indsigten "Ny lektion" lukkes med.
--
-- Alt kører natligt (L4, trin "settle" og i trinnet "duplicates"), kun for fonden i kaldet.

begin;

-- ---------------------------------------------------------------------------
-- 1. Lektioner: tre forskellige cases tæller som bevis nok (ud over to uafhængige bekræftelser)
-- ---------------------------------------------------------------------------
create or replace function public.brain_bullet_case_confirmations(
  _fund_id uuid,
  _bullet_id uuid
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct e.case_key)::int
  from public.brain_bullet_events e
  where e.fund_id = _fund_id and e.bullet_id = _bullet_id
    and e.source_kind in ('create', 'corroborate')
    and e.case_key is not null
$$;

revoke all on function public.brain_bullet_case_confirmations(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.brain_bullet_case_confirmations(uuid, uuid) to service_role;

create or replace function public.brain_bullets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next int;
begin
  if tg_op = 'INSERT' then
    if new.short_id is null then
      perform pg_advisory_xact_lock(hashtextextended('brain_pb:' || new.fund_id::text, 0));
      select coalesce(max(substring(b.short_id from 4)::int), 0) + 1 into v_next
      from public.brain_playbook_bullets b where b.fund_id = new.fund_id;
      new.short_id := 'pb-' || lpad(v_next::text, 5, '0');
    end if;
    if new.status = 'active' and new.approved_by is null then
      raise exception 'brain_playbook_bullets: a lesson becomes active only when it is approved or confirmed';
    end if;
  else
    if new.fund_id <> old.fund_id or new.short_id <> old.short_id then
      raise exception 'brain_playbook_bullets: fund and short id cannot change';
    end if;
    if new.status = 'active' and old.status <> 'active' and new.approved_by is null
       and public.brain_bullet_independent_confirmations(new.fund_id, new.id) < 2
       and public.brain_bullet_case_confirmations(new.fund_id, new.id) < 3 then
      raise exception 'brain_playbook_bullets: a lesson needs a human approval, two independent confirmations or three cases to become active';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Natlig afgørelse: modstrid og lektioner (gratis, ingen AI)
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_settle(
  _fund_id uuid,
  _job_id uuid default null,
  _limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i record;
  v_a public.brain_facts%rowtype;
  v_b public.brain_facts%rowtype;
  v_w public.brain_facts%rowtype;
  v_l public.brain_facts%rowtype;
  v_score_a int;
  v_score_b int;
  v_reason text;
  v_moot boolean;
  v_resolved int := 0;
  v_moot_count int := 0;
  v_left int := 0;
  v_rows int;
  v_bullet record;
  v_activated int := 0;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_settle: fund id is required';
  end if;

  -- Modstrid mellem to facts.
  for v_i in
    select i.id, i.refs
    from public.brain_insights i
    where i.fund_id = _fund_id and i.kind = 'contradiction' and i.status in ('new', 'seen')
      and jsonb_typeof(i.refs) = 'array' and jsonb_array_length(i.refs) = 2
      and i.refs -> 0 ->> 'kind' = 'fact' and i.refs -> 1 ->> 'kind' = 'fact'
    order by i.priority, i.created_at
    limit greatest(coalesce(_limit, 50), 0)
    for update skip locked
  loop
    -- Lock both facts (in id order) so L1 cannot supersede one while we decide.
    perform 1 from public.brain_facts f
     where f.fund_id = _fund_id
       and f.id in ((v_i.refs -> 0 ->> 'id')::uuid, (v_i.refs -> 1 ->> 'id')::uuid)
     order by f.id for update;
    select * into v_a from public.brain_facts f
     where f.id = (v_i.refs -> 0 ->> 'id')::uuid and f.fund_id = _fund_id;
    select * into v_b from public.brain_facts f
     where f.id = (v_i.refs -> 1 ->> 'id')::uuid and f.fund_id = _fund_id;

    -- Den ene er væk eller allerede afløst: der er ikke længere noget, der strider.
    v_moot := v_a.id is null or v_b.id is null
              or v_a.expired_at is not null or v_b.expired_at is not null
              or v_a.status <> 'active' or v_b.status <> 'active';
    if v_moot then
      update public.brain_insights
         set status = 'accepted', decided_at = now(),
             body_md = left(body_md || E'\n\nBrain lukkede den selv: en af oplysningerne er ikke længere gældende.', 20000)
       where id = v_i.id and fund_id = _fund_id;
      v_moot_count := v_moot_count + 1;
      continue;
    end if;

    -- Styrke: en fact fra databasen vinder over alt, ellers kildens tillidsniveau.
    v_score_a := case when v_a.origin = 'db' then 100 else public.brain_trust_rank(v_a.trust_tier) end;
    v_score_b := case when v_b.origin = 'db' then 100 else public.brain_trust_rank(v_b.trust_tier) end;
    if v_score_a > v_score_b then
      v_w := v_a; v_l := v_b;
      v_reason := 'Stærkeste kilde vinder (' || v_a.trust_tier || ' over ' || v_b.trust_tier || ')';
    elsif v_score_b > v_score_a then
      v_w := v_b; v_l := v_a;
      v_reason := 'Stærkeste kilde vinder (' || v_b.trust_tier || ' over ' || v_a.trust_tier || ')';
    elsif v_a.created_at > v_b.created_at then
      v_w := v_a; v_l := v_b;
      v_reason := 'Nyeste oplysning vinder (samme kildestyrke: ' || v_a.trust_tier || ')';
    elsif v_b.created_at > v_a.created_at then
      v_w := v_b; v_l := v_a;
      v_reason := 'Nyeste oplysning vinder (samme kildestyrke: ' || v_b.trust_tier || ')';
    else
      -- Undecidable: sink it below newer contradictions so it never blocks the queue.
      update public.brain_insights set priority = 3 where id = v_i.id and fund_id = _fund_id;
      v_left := v_left + 1;
      continue;
    end if;

    -- Brain rører aldrig en fact, databasen ejer.
    if v_l.origin = 'db' then
      update public.brain_insights set priority = 3 where id = v_i.id and fund_id = _fund_id;
      v_left := v_left + 1;
      continue;
    end if;

    update public.brain_facts
       set expired_at = now(), superseded_by = v_w.id
     where id = v_l.id and fund_id = _fund_id and expired_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      v_left := v_left + 1;
      continue;
    end if;
    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
      reason, job_id)
    values (_fund_id, 'L4_nightly', 'invalidate', 'fact', v_l.id,
      jsonb_build_object('expired_at', null, 'superseded_by', null, 'statement', v_l.statement),
      jsonb_build_object('superseded_by', v_w.id, 'winner', v_w.statement),
      left(v_reason, 500), _job_id);
    update public.brain_entities
       set dirty_at = now()
     where fund_id = _fund_id and id in (v_w.subject_id, v_l.subject_id) and status = 'active';
    update public.brain_insights
       set status = 'accepted', decided_at = now(),
           body_md = left(body_md || E'\n\nBrain afgjorde det selv: ' || v_reason || '. Beholdt: '
             || v_w.statement || ' Udløbet: ' || v_l.statement, 20000)
     where id = v_i.id and fund_id = _fund_id;
    v_resolved := v_resolved + 1;
  end loop;

  -- Lektioner, som tre forskellige cases har bekræftet og ingen har kaldt skadelige.
  for v_bullet in
    select b.id, b.short_id
    from public.brain_playbook_bullets b
    where b.fund_id = _fund_id and b.status = 'candidate' and b.approved_by is null
      and b.harmful = 0
      and public.brain_bullet_case_confirmations(_fund_id, b.id) >= 3
    order by b.created_at
    limit greatest(coalesce(_limit, 50), 0)
    for update skip locked
  loop
    update public.brain_playbook_bullets
       set status = 'active'
     where id = v_bullet.id and fund_id = _fund_id and status = 'candidate';
    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
      reason, job_id)
    values (_fund_id, 'L4_nightly', 'activate', 'bullet', v_bullet.id,
      jsonb_build_object('status', 'candidate'), jsonb_build_object('status', 'active'),
      'Tre ens beslutninger i tre forskellige cases', _job_id);
    update public.brain_insights
       set status = 'accepted', decided_at = now()
     where fund_id = _fund_id and dedupe_key = 'lesson_candidate:' || v_bullet.id::text
       and status in ('new', 'seen');
    v_activated := v_activated + 1;
  end loop;

  return jsonb_build_object('contradictionsResolved', v_resolved,
    'contradictionsClosed', v_moot_count, 'contradictionsLeft', v_left,
    'lessonsActivated', v_activated);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Dubletter: læg dem sammen, som resolveren er sikker på er det samme
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_auto_merge(
  _fund_id uuid,
  _pairs jsonb,
  _job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pair jsonb;
  v_a public.brain_entities%rowtype;
  v_b public.brain_entities%rowtype;
  v_winner uuid;
  v_loser uuid;
  v_percent text;
  v_merged int := 0;
  v_refused int := 0;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_auto_merge: fund id is required';
  end if;
  if _pairs is null or jsonb_typeof(_pairs) <> 'array' then
    return jsonb_build_object('merged', 0, 'refused', 0);
  end if;

  for v_pair in select * from jsonb_array_elements(_pairs) limit 50
  loop
    select * into v_a from public.brain_entities e
     where e.id = (v_pair ->> 'a')::uuid and e.fund_id = _fund_id and e.status = 'active';
    select * into v_b from public.brain_entities e
     where e.id = (v_pair ->> 'b')::uuid and e.fund_id = _fund_id and e.status = 'active';
    if v_a.id is null or v_b.id is null then
      continue;
    end if;
    if (v_b.ref_table is not null and v_a.ref_table is null)
       or (v_a.ref_table is null and v_b.ref_table is null
           and (v_b.first_seen_at, v_b.id) < (v_a.first_seen_at, v_a.id)) then
      v_winner := v_b.id; v_loser := v_a.id;
    else
      v_winner := v_a.id; v_loser := v_b.id;
    end if;
    v_percent := round(coalesce((v_pair ->> 'confidence')::numeric, 0) * 100)::text;

    begin
      perform public.brain_merge_entities(
        _fund_id, v_winner, v_loser, 'L4_nightly',
        'Resolveren var ' || v_percent || ' % sikker på, at det er det samme', _job_id);
      v_merged := v_merged + 1;
      update public.brain_insights i
         set status = 'accepted', decided_at = now(),
             body_md = left(i.body_md || E'\n\nBrain lagde dem selv sammen (' || v_percent
               || ' % sikker). Kan fortrydes med Adskil.', 20000)
       where i.fund_id = _fund_id and i.kind = 'merge_candidate'
         and i.dedupe_key = 'merge_candidate:' || least(v_winner, v_loser)::text || ':'
                            || greatest(v_winner, v_loser)::text;
    exception when raise_exception or no_data_found or unique_violation then
      -- Afvist af 0055 (fx en fact forbinder dem) eller en fact findes allerede hos vinderen:
      -- indsigten bliver stående til en, der kan afgøre det.
      v_refused := v_refused + 1;
    end;
  end loop;

  return jsonb_build_object('merged', v_merged, 'refused', v_refused);
end;
$$;

revoke all on function public.brain_nightly_settle(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.brain_nightly_auto_merge(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.brain_nightly_settle(uuid, uuid, int) to service_role;
grant execute on function public.brain_nightly_auto_merge(uuid, jsonb, uuid) to service_role;

commit;
