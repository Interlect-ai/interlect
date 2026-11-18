-- 0075 · L2 Reflektér over beslutningen (L2).
--
-- Når teamet kasserer, afviser i komitéen, investerer eller sætter en case på hold, reflekterer
-- Brain over beslutningen (reflector) og foreslår lektioner, som curatoren omsætter til
-- delta-operationer (ADD, CORROBORATE, TAG). Sprogmodellerne kaldes fra koden
-- (src/lib/brain/loops/reflect.ts); databasen giver dem deres input og fletter deres operationer
-- i én transaktion, så playbooken aldrig omskrives af en sprogmodel (ACE).
--
--   * brain_pending_reflections: de stående menneskelige beslutninger i en case, der endnu ikke
--     har en L2-kørsel (L0 lægger dem i kø, 15 minutter forsinket, så en fortrydelse når at virke).
--   * brain_reflection_input: beslutningen, seneste analyse før den (resumé, top 5 fund, top 3
--     risici), lektionerne i analysens kontekst, top 10 relevante aktive lektioner (vektor +
--     scope) og 5 lignende tidligere beslutninger.
--   * brain_reflection_neighbors: de nærmeste eksisterende lektioner pr. kandidat (curatoren).
--   * brain_apply_reflection: fletningen. Den holder selv fast på det, der ikke må afhænge af, at
--     koden husker det:
--       - beslutningen skal stadig stå (ikke fortrudt) og være truffet af et menneske;
--       - ADD og CORROBORATE kræver, at beslutningen har årsagskoder og selv står blandt
--         beviserne (bevisreglen, trin 3: lektionen er forankret i teamets egen begrundelse);
--       - samme beslutning tæller kun én gang pr. lektion (unik event pr. kilde, 0062), og en
--         gentaget kørsel med samme operationer ændrer intet (faste id'er fra koden);
--       - en lektion bliver kun aktiv med to uafhængige bekræftelser (forskellige brugere og
--         forskellige cases), som 0062's trigger også kræver.
--
-- Additiv og bagudkompatibel: ingen eksisterende tabel, kolonne, policy eller grant ændres, og
-- ingen eksisterende funktion skiftes ud. Kun service_role kan kalde funktionerne.
-- Tests: scripts/test-brain-db.mjs (reflectionDb).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Beslutninger, der venter på en refleksion
-- ---------------------------------------------------------------------------
create or replace function public.brain_pending_reflections(
  _fund_id uuid,
  _case_id uuid,
  _since timestamptz
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.case_transition_events e
  where e.fund_id = _fund_id
    and e.case_id = _case_id
    and e.movement_kind in ('reject', 'decline_ic', 'invest', 'hold')
    and e.actor_type = 'user'
    and e.actor_id is not null
    and e.occurred_at >= coalesce(_since, '-infinity'::timestamptz)
    -- Same rule as brain_case_decisions and 0060: neither an undo nor undone.
    and e.undo_of is null
    and not exists (
      select 1 from public.case_transition_events u
      where u.undo_of = e.id and u.fund_id = e.fund_id
    )
    and not exists (
      select 1 from public.brain_jobs j
      where j.fund_id = _fund_id and j.loop = 'L2_reflect' and j.key = 'decision:' || e.id::text
    )
  order by e.occurred_at, e.id
  limit 20
$$;

-- ---------------------------------------------------------------------------
-- 2. Input til reflector
-- ---------------------------------------------------------------------------
create or replace function public.brain_reflection_input(_fund_id uuid, _event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_company record;
  v_case_embedding public.vector;
  v_run record;
  v_decision jsonb;
  v_analysis jsonb := null;
  v_findings jsonb := '[]'::jsonb;
  v_risks jsonb := '[]'::jsonb;
  v_context jsonb := '[]'::jsonb;
  v_relevant jsonb;
  v_similar jsonb;
begin
  if _fund_id is null or _event_id is null then
    raise exception 'brain_reflection_input: fund id and event id are required';
  end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  select e.id, e.case_id, e.movement_kind, e.from_phase, e.occurred_at, e.actor_type::text as actor_type,
         e.actor_id, e.reason_codes, nullif(btrim(coalesce(e.note, e.reason)), '') as reason_text,
         e.undo_of is null and not exists (
           select 1 from public.case_transition_events u
           where u.undo_of = e.id and u.fund_id = e.fund_id) as standing
    into v_event
  from public.case_transition_events e
  where e.id = _event_id and e.fund_id = _fund_id;
  if not found then
    return null;
  end if;

  select co.name, nullif(btrim(co.sector), '') as sector, nullif(co.stage::text, 'unknown') as stage,
         nullif(btrim(co.geography), '') as geography
    into v_company
  from public.cases c
  join public.companies co on co.id = c.company_id and co.fund_id = c.fund_id
  where c.id = v_event.case_id and c.fund_id = _fund_id;

  select en.embedding into v_case_embedding
  from public.brain_entities en
  where en.fund_id = _fund_id and en.type = 'case' and en.status = 'active'
    and en.ref_table = 'cases' and en.ref_id = v_event.case_id
  limit 1;

  v_decision := jsonb_build_object(
    'id', v_event.id,
    'caseId', v_event.case_id,
    'kind', v_event.movement_kind,
    'fromPhase', v_event.from_phase,
    'occurredAt', v_event.occurred_at,
    'actorType', v_event.actor_type,
    'actorId', v_event.actor_id,
    'standing', v_event.standing,
    'reasonCodes', to_jsonb(v_event.reason_codes),
    'reasons', coalesce((
      select jsonb_agg(coalesce(rc.label, u.code) order by u.ord)
      from unnest(v_event.reason_codes) with ordinality as u(code, ord)
      left join public.brain_reason_codes rc on rc.fund_id = _fund_id and rc.code = u.code
    ), '[]'::jsonb),
    'reasonText', left(v_event.reason_text, 2000));

  -- The analysis the team had in front of it: the latest finished run before the decision.
  select r.id, r.kind, r.playbook_bullet_ids
    into v_run
  from public.analysis_runs r
  where r.fund_id = _fund_id and r.case_id = v_event.case_id
    and r.status in ('complete', 'awaiting_approval')
    and coalesce(r.completed_at, r.created_at) <= v_event.occurred_at
  order by coalesce(r.completed_at, r.created_at) desc, r.id desc
  limit 1;

  if v_run.id is not null then
    select jsonb_build_object('runId', v_run.id, 'kind', v_run.kind, 'episodeId', ep.id,
             'content', left(ep.content, 3000), 'trust', ep.trust_tier)
      into v_analysis
    from public.brain_episodes ep
    where ep.fund_id = _fund_id and ep.ref_table = 'analysis_runs' and ep.ref_id = v_run.id
      and ep.kind = 'analysis_summary'
    order by ep.recorded_at desc
    limit 1;
    if v_analysis is null then
      v_analysis := jsonb_build_object('runId', v_run.id, 'kind', v_run.kind);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('episodeId', x.id, 'content', x.content,
             'trust', x.trust_tier) order by x.ord), '[]'::jsonb)
      into v_findings
    from (
      select ep.id, left(ep.content, 600) as content, ep.trust_tier,
        row_number() over (order by f.confidence desc nulls last, f.created_at, f.id) as ord
      from public.analysis_findings f
      join public.brain_episodes ep
        on ep.fund_id = _fund_id and ep.ref_table = 'analysis_findings' and ep.ref_id = f.id
      where f.fund_id = _fund_id and f.run_id = v_run.id
      order by f.confidence desc nulls last, f.created_at, f.id
      limit 5
    ) x;

    select coalesce(jsonb_agg(jsonb_build_object('episodeId', x.id, 'content', x.content,
             'trust', x.trust_tier) order by x.ord), '[]'::jsonb)
      into v_risks
    from (
      select ep.id, left(ep.content, 600) as content, ep.trust_tier,
        row_number() over (order by case k.level::text when 'critical' then 0 when 'high' then 1
          when 'medium' then 2 else 3 end, k.created_at, k.id) as ord
      from public.risks k
      join public.brain_episodes ep
        on ep.fund_id = _fund_id and ep.ref_table = 'risks' and ep.ref_id = k.id
      where k.fund_id = _fund_id and k.run_id = v_run.id
      order by case k.level::text when 'critical' then 0 when 'high' then 1
        when 'medium' then 2 else 3 end, k.created_at, k.id
      limit 3
    ) x;

    select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'shortId', b.short_id,
             'section', b.section, 'text', b.text, 'status', b.status, 'helpful', b.helpful,
             'harmful', b.harmful) order by b.short_id), '[]'::jsonb)
      into v_context
    from public.brain_playbook_bullets b
    where b.fund_id = _fund_id and b.id = any(v_run.playbook_bullet_ids)
      and b.status in ('candidate', 'active');
  end if;

  -- Top 10 relevant active lessons: the scope fits the company (an empty list fits all), nearest
  -- to the case's profile first; without a profile the most helpful first.
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'shortId', x.short_id,
           'section', x.section, 'text', x.text, 'status', x.status, 'helpful', x.helpful,
           'harmful', x.harmful) order by x.ord), '[]'::jsonb)
    into v_relevant
  from (
    select b.id, b.short_id, b.section, b.text, b.status, b.helpful, b.harmful,
      row_number() over (order by
        case when v_case_embedding is not null and b.embedding is not null
             then b.embedding operator(public.<=>) v_case_embedding end nulls last,
        b.helpful - b.harmful desc, b.updated_at desc, b.id) as ord
    from public.brain_playbook_bullets b
    where b.fund_id = _fund_id and b.status = 'active'
      and not (b.id = any(coalesce(v_run.playbook_bullet_ids, '{}'::uuid[])))
      and public.brain_scope_fits(b.scope -> 'sectors', v_company.sector)
      and public.brain_scope_fits(b.scope -> 'stages', v_company.stage)
      and public.brain_scope_fits(b.scope -> 'geographies', v_company.geography)
    order by ord
    limit 10
  ) x;

  -- 5 similar earlier decisions on other cases: the latest standing decision before this one of
  -- the nearest cases (case profile), or of the latest cases when the case has no profile yet.
  with near as (
    select en.ref_id as case_id,
      case when v_case_embedding is not null and en.embedding is not null
           then round((1 - (en.embedding operator(public.<=>) v_case_embedding))::numeric, 3)
      end as cosine
    from public.brain_entities en
    where en.fund_id = _fund_id and en.type = 'case' and en.status = 'active'
      and en.ref_table = 'cases' and en.ref_id <> v_event.case_id
      and (v_case_embedding is null or en.embedding is not null)
    order by case when v_case_embedding is not null
                  then en.embedding operator(public.<=>) v_case_embedding end nulls last,
      en.last_seen_at desc, en.id
    limit 40
  ),
  decided as (
    select n.case_id, n.cosine, d.*
    from near n
    join lateral (
      select e.id, e.movement_kind, e.occurred_at, e.actor_type::text as actor_type, e.actor_id,
             e.reason_codes, nullif(btrim(coalesce(e.note, e.reason)), '') as reason_text
      from public.case_transition_events e
      where e.fund_id = _fund_id and e.case_id = n.case_id
        and e.movement_kind in ('reject', 'decline_ic', 'invest', 'hold')
        and e.occurred_at < v_event.occurred_at
        and e.undo_of is null
        and not exists (select 1 from public.case_transition_events u
                        where u.undo_of = e.id and u.fund_id = e.fund_id)
      order by e.occurred_at desc, e.id desc
      limit 1
    ) d on true
    order by n.cosine desc nulls last, d.occurred_at desc
    limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'caseId', d.case_id, 'company', co.name, 'kind', d.movement_kind,
           'decidedAt', d.occurred_at, 'actorType', d.actor_type, 'actorId', d.actor_id,
           'reasonCodes', to_jsonb(d.reason_codes),
           'reasons', coalesce((
             select jsonb_agg(coalesce(rc.label, u.code) order by u.ord)
             from unnest(d.reason_codes) with ordinality as u(code, ord)
             left join public.brain_reason_codes rc on rc.fund_id = _fund_id and rc.code = u.code
           ), '[]'::jsonb),
           'reasonText', left(d.reason_text, 600),
           'cosine', d.cosine)
         order by d.cosine desc nulls last, d.occurred_at desc), '[]'::jsonb)
    into v_similar
  from decided d
  left join public.cases c on c.id = d.case_id and c.fund_id = _fund_id
  left join public.companies co on co.id = c.company_id and co.fund_id = _fund_id;

  return jsonb_build_object(
    'decision', v_decision,
    'company', case when v_company.name is null then null else jsonb_build_object(
      'name', v_company.name, 'sector', v_company.sector, 'stage', v_company.stage,
      'geography', v_company.geography) end,
    'analysis', v_analysis,
    'findings', v_findings,
    'risks', v_risks,
    'contextLessons', v_context,
    'relevantLessons', v_relevant,
    'similarDecisions', v_similar);
end;
$$;

-- A lesson's scope list fits a value when the list is missing or empty, or names it (any case).
create or replace function public.brain_scope_fits(_list jsonb, _value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when _list is null or jsonb_typeof(_list) <> 'array' or jsonb_array_length(_list) = 0 then true
    when _value is null then false
    else exists (
      select 1 from jsonb_array_elements_text(_list) s(v) where lower(btrim(s.v)) = lower(btrim(_value)))
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. Nærmeste eksisterende lektioner pr. kandidat (til curatoren)
-- ---------------------------------------------------------------------------
-- _embeddings: [[...1536 tal], ...], én pr. kandidat. Svar: [[{id, shortId, ...}], ...].
create or replace function public.brain_reflection_neighbors(
  _fund_id uuid,
  _embeddings jsonb,
  _min_cosine numeric,
  _limit int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_vector public.vector;
  v_near jsonb;
begin
  if _fund_id is null or _embeddings is null or jsonb_typeof(_embeddings) <> 'array' then
    raise exception 'brain_reflection_neighbors: fund id and an array of embeddings are required';
  end if;
  if jsonb_array_length(_embeddings) > 10 then
    raise exception 'brain_reflection_neighbors: at most 10 embeddings at a time';
  end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  for v_item in select e from jsonb_array_elements(_embeddings) e loop
    v_vector := (v_item::text)::public.vector;
    select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'shortId', n.short_id,
             'section', n.section, 'text', n.text, 'status', n.status, 'cosine', n.cosine)
             order by n.cosine desc), '[]'::jsonb)
      into v_near
    from (
      select b.id, b.short_id, b.section, b.text, b.status,
        round((1 - (b.embedding operator(public.<=>) v_vector))::numeric, 3) as cosine
      from public.brain_playbook_bullets b
      where b.fund_id = _fund_id and b.status in ('candidate', 'active')
        and b.embedding is not null
      order by b.embedding operator(public.<=>) v_vector
      limit least(greatest(coalesce(_limit, 3), 1), 10)
    ) n
    where n.cosine >= coalesce(_min_cosine, 0);
    v_out := v_out || jsonb_build_array(v_near);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fletning (ACE: kun delta-operationer, aldrig en omskrevet playbook)
-- ---------------------------------------------------------------------------
-- _ops: [{op:'ADD', id, section, text, scope, evidence:[{kind,id}], embedding:[...]|null}
--        | {op:'CORROBORATE', bulletId, evidence:[{kind,id}]}
--        | {op:'TAG', bulletId, tag:'helpful'|'harmful', why}]
create or replace function public.brain_apply_reflection(
  _fund_id uuid,
  _event_id uuid,
  _job_id uuid,
  _ops jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_anchored boolean;
  v_case_key text;
  v_op jsonb;
  v_id uuid;
  v_bullet record;
  v_inserted int;
  v_added int := 0;
  v_corroborated int := 0;
  v_activated int := 0;
  v_tagged int := 0;
  v_ignored int := 0;
  v_evidence jsonb;
  v_vector public.vector;
  v_same uuid;
begin
  if _fund_id is null or _event_id is null or _ops is null or jsonb_typeof(_ops) <> 'array' then
    raise exception 'brain_apply_reflection: fund id, event id and an op array are required';
  end if;
  if jsonb_array_length(_ops) > 12 then
    raise exception 'brain_apply_reflection: at most 12 operations';
  end if;

  select e.id, e.case_id, e.actor_type::text as actor_type, e.actor_id, e.reason_codes,
         e.movement_kind
    into v_event
  from public.case_transition_events e
  where e.id = _event_id and e.fund_id = _fund_id
  for key share;
  if not found then
    return jsonb_build_object('skipped', 'decision_gone');
  end if;
  if v_event.movement_kind not in ('reject', 'decline_ic', 'invest', 'hold')
     or v_event.actor_type <> 'user' or v_event.actor_id is null then
    return jsonb_build_object('skipped', 'not_a_human_decision');
  end if;
  if exists (select 1 from public.case_transition_events u
             where u.undo_of = _event_id and u.fund_id = _fund_id) then
    return jsonb_build_object('skipped', 'not_standing');
  end if;
  v_anchored := coalesce(array_length(v_event.reason_codes, 1), 0) > 0;
  v_case_key := v_event.case_id::text;

  for v_op in select o from jsonb_array_elements(_ops) o loop
    v_evidence := coalesce(v_op -> 'evidence', '[]'::jsonb);
    if v_op ->> 'op' in ('ADD', 'CORROBORATE') and (
         not v_anchored
         or jsonb_typeof(v_evidence) <> 'array'
         or not v_evidence @> jsonb_build_array(
              jsonb_build_object('kind', 'decision', 'id', _event_id::text))) then
      -- Bevisreglen trin 3: forankret i denne beslutnings egne årsager, ellers intet.
      v_ignored := v_ignored + 1;
      continue;
    end if;

    -- Two decisions in one batch reflect at the same time and cannot see each other's new
    -- lessons: under a lock per fund, an ADD whose lesson already exists (cos >= 0.88) confirms it.
    if v_op ->> 'op' = 'ADD' and jsonb_typeof(v_op -> 'embedding') = 'array' then
      perform pg_advisory_xact_lock(hashtextextended('brain_l2_add:' || _fund_id::text, 0));
      v_vector := ((v_op -> 'embedding')::text)::public.vector;
      select b.id into v_same
      from public.brain_playbook_bullets b
      where b.fund_id = _fund_id and b.status in ('candidate', 'active')
        and b.embedding is not null and b.id <> (v_op ->> 'id')::uuid
        and 1 - (b.embedding operator(public.<=>) v_vector) >= 0.88
      order by b.embedding operator(public.<=>) v_vector
      limit 1;
      if v_same is not null and not exists (
           select 1 from public.brain_playbook_bullets b
           where b.id = (v_op ->> 'id')::uuid and b.fund_id = _fund_id) then
        v_op := jsonb_build_object('op', 'CORROBORATE', 'bulletId', v_same, 'evidence', v_evidence);
      end if;
    end if;

    if v_op ->> 'op' = 'ADD' then
      v_id := (v_op ->> 'id')::uuid;
      insert into public.brain_playbook_bullets (id, fund_id, section, text, scope, status,
        origin, evidence, embedding)
      values (v_id, _fund_id, v_op ->> 'section', left(btrim(v_op ->> 'text'), 500),
        coalesce(v_op -> 'scope', '{}'::jsonb), 'candidate', 'brain', v_evidence,
        case when jsonb_typeof(v_op -> 'embedding') = 'array'
             then ((v_op -> 'embedding')::text)::public.vector end)
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 0 then
        continue;
      end if;
      insert into public.brain_bullet_events (fund_id, bullet_id, reason, source_kind, source_id,
        actor_user_id, case_key)
      values (_fund_id, v_id, 'Ny lektion fra beslutningen', 'create', _event_id,
        v_event.actor_id, v_case_key)
      on conflict do nothing;
      select b.short_id, b.text, b.section into v_bullet
      from public.brain_playbook_bullets b where b.id = v_id and b.fund_id = _fund_id;
      insert into public.brain_insights (fund_id, kind, title, body_md, refs, priority,
        created_by_loop, dedupe_key)
      values (_fund_id, 'lesson_candidate',
        left('Ny lektion ' || v_bullet.short_id || ': ' || v_bullet.text, 300),
        left('Brain foreslår lektionen "' || v_bullet.text || '" ud fra beslutningen. Den bliver '
          || 'aktiv, når en anden bruger bekræfter den i en anden case, eller når den godkendes '
          || 'under Brain · Lært.', 4000),
        jsonb_build_array(jsonb_build_object('kind', 'bullet', 'id', v_id),
                          jsonb_build_object('kind', 'decision', 'id', _event_id)),
        2, 'L2_reflect', 'lesson_candidate:' || v_id::text)
      on conflict do nothing;
      insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after, reason,
        job_id)
      values (_fund_id, 'L2_reflect', 'insert', 'bullet', v_id,
        jsonb_build_object('short_id', v_bullet.short_id, 'section', v_bullet.section,
          'text', v_bullet.text, 'decision', _event_id),
        'Ny lektion fra en beslutning', _job_id);
      v_added := v_added + 1;

    elsif v_op ->> 'op' = 'CORROBORATE' then
      v_id := (v_op ->> 'bulletId')::uuid;
      select b.id, b.status, b.approved_by, b.evidence, b.short_id into v_bullet
      from public.brain_playbook_bullets b
      where b.id = v_id and b.fund_id = _fund_id
      for update;
      if not found or v_bullet.status not in ('candidate', 'active')
         or exists (select 1 from public.brain_bullet_events x
                    where x.bullet_id = v_id and x.source_id = _event_id
                      and x.source_kind = 'create') then
        v_ignored := v_ignored + 1;
        continue;
      end if;
      insert into public.brain_bullet_events (fund_id, bullet_id, reason, source_kind, source_id,
        actor_user_id, case_key)
      values (_fund_id, v_id, 'Bekræftet af en beslutning', 'corroborate', _event_id,
        v_event.actor_id, v_case_key)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 0 then
        continue;
      end if;
      update public.brain_playbook_bullets b
         set evidence = (
           select coalesce(jsonb_agg(distinct x.ref), '[]'::jsonb)
           from (
             select r as ref from jsonb_array_elements(b.evidence) r
             union
             select r from jsonb_array_elements(v_evidence) r
           ) x)
       where b.id = v_id and b.fund_id = _fund_id;
      v_corroborated := v_corroborated + 1;
      if v_bullet.status = 'candidate' and v_bullet.approved_by is null
         and public.brain_bullet_independent_confirmations(_fund_id, v_id) >= 2 then
        update public.brain_playbook_bullets set status = 'active'
         where id = v_id and fund_id = _fund_id;
        insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before,
          after, reason, job_id)
        values (_fund_id, 'L2_reflect', 'activate', 'bullet', v_id,
          jsonb_build_object('status', 'candidate'), jsonb_build_object('status', 'active'),
          'To uafhængige bekræftelser (forskellige brugere og cases)', _job_id);
        v_activated := v_activated + 1;
      end if;

    elsif v_op ->> 'op' = 'TAG' then
      v_id := (v_op ->> 'bulletId')::uuid;
      if coalesce(v_op ->> 'tag', '') not in ('helpful', 'harmful')
         or not exists (select 1 from public.brain_playbook_bullets b
                        where b.id = v_id and b.fund_id = _fund_id
                          and b.status in ('candidate', 'active')) then
        v_ignored := v_ignored + 1;
        continue;
      end if;
      insert into public.brain_bullet_events (fund_id, bullet_id, delta_helpful, delta_harmful,
        reason, source_kind, source_id, actor_user_id, case_key)
      values (_fund_id, v_id, (v_op ->> 'tag' = 'helpful')::int, (v_op ->> 'tag' = 'harmful')::int,
        left(coalesce(nullif(btrim(v_op ->> 'why'), ''), 'Beslutningen'), 500), 'tag_decision',
        _event_id, v_event.actor_id, v_case_key)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_tagged := v_tagged + v_inserted;

    else
      v_ignored := v_ignored + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'corroborated', v_corroborated,
    'activated', v_activated, 'tagged', v_tagged, 'ignored', v_ignored);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rettigheder: kun serveren
-- ---------------------------------------------------------------------------
revoke all on function public.brain_pending_reflections(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.brain_reflection_input(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_scope_fits(jsonb, text) from public, anon, authenticated;
revoke all on function public.brain_reflection_neighbors(uuid, jsonb, numeric, int)
  from public, anon, authenticated;
revoke all on function public.brain_apply_reflection(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.brain_pending_reflections(uuid, uuid, timestamptz) to service_role;
grant execute on function public.brain_reflection_input(uuid, uuid) to service_role;
grant execute on function public.brain_scope_fits(jsonb, text) to service_role;
grant execute on function public.brain_reflection_neighbors(uuid, jsonb, numeric, int)
  to service_role;
grant execute on function public.brain_apply_reflection(uuid, uuid, uuid, jsonb) to service_role;

commit;
