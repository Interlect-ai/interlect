-- 0054 · Faktaudtræk fra kilder (trinnene "facts" og "link", 06 L1).
--
-- L1 (0045) er bundet til en case. Kildernes episoder (kind source_chunk) har ingen case, så de får
-- samme udtræk med kilden som afgrænsning:
--   1. brain_apply_extraction_source: brain_apply_extraction (0045) ordret, men afgrænset til en
--      kildes episoder i stedet for en cases (spærring, "skippet hvis kilden er væk", kun denne
--      kildes ventende episoder). Alt andet (citat, entiteter, dubletter, modsigelser, tillid,
--      dirty-markering, logning) er uændret. Genereret mekanisk ud fra 0045 og kontrolleret med diff.
--   2. brain_source_pending_episodes: kildens episoder, der venter på udtræk, i rækkefølge.
--   3. brain_sources.classification: klassificeringens svar (dokumenttype, hovedselskab ...), så en
--      genoptaget kørsel ikke skal betale for den igen.
--
-- Additiv og bagudkompatibel (preview og produktion deler databasen).

-- 4. A run claims the source (ingest_job_id + ingest_lease_until) so a continuation and a retry never
--    read and pay for the same episodes at the same time (review facts).
alter table public.brain_sources
  add column classification jsonb check (classification is null or jsonb_typeof(classification) = 'object'),
  add column ingest_job_id uuid,
  add column ingest_lease_until timestamptz;

create or replace function public.brain_apply_extraction_source(
  _fund_id uuid,
  _source_id uuid,
  _job_id uuid,
  _batch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- One current value per subject and "slot" and period (06 L1 step 6).
  v_single constant text[] := array['metric','valued_at','at_stage','has_role','raised_round'];
  -- Decisions and money from uploads wait for brain_review (06 L1 step 7).
  v_upload_review constant text[] := array['decided','because_of','invested_in','valued_at'];
  v_requested uuid[];
  v_failed uuid[];
  v_episodes uuid[];
  v_refs jsonb := '{}'::jsonb;
  v_entity jsonb;
  v_fact jsonb;
  v_old record;
  v_dup record;
  v_id uuid;
  v_existing_status text;
  v_entity_exists boolean;
  v_is_dup boolean;
  v_aliases_before text[];
  v_aliases_after text[];
  v_linked int;
  v_proposal_links int := 0;
  v_new_id uuid;
  v_subject uuid;
  v_object uuid;
  v_episode uuid;
  v_trust text;
  v_source uuid;
  v_evidence_status text;
  v_evidence_id uuid;
  v_status text;
  v_pred text;
  v_vtext text;
  v_vnum numeric;
  v_unit text;
  v_from date;
  v_to date;
  v_statement text;
  v_conf real;
  v_rel_kind text;
  v_rel_fact uuid;
  v_slot text;
  v_fact_id uuid;
  v_contradicts uuid[];
  v_dirty uuid[] := '{}';
  v_fact_ids jsonb := '[]'::jsonb;
  v_added int := 0;
  v_confirmed int := 0;
  v_closed int := 0;
  v_contradictions int := 0;
  v_superseded int := 0;
  v_skipped_episode int := 0;
  v_skipped_ref int := 0;
  v_entities_created int := 0;
  v_rows int;
begin
  if _fund_id is null or _source_id is null or _batch is null then
    raise exception 'brain_apply_extraction_source: fund, source and batch are required';
  end if;
  if jsonb_typeof(_batch -> 'episodes') is distinct from 'array' then
    raise exception 'brain_apply_extraction_source: episodes must be an array';
  end if;
  -- The worker sends at most 12 episodes, 40 entities and 60 facts per batch.
  if jsonb_array_length(_batch -> 'episodes') + jsonb_array_length(coalesce(_batch -> 'failed', '[]'::jsonb)) > 24
     or jsonb_array_length(coalesce(_batch -> 'entities', '[]'::jsonb)) > 60
     or jsonb_array_length(coalesce(_batch -> 'facts', '[]'::jsonb)) > 80 then
    raise exception 'brain_apply_extraction_source: batch too large';
  end if;

  -- A source's episodes are written by one INGEST run at a time (brain_source_claim below); the
  -- advisory lock serialises two applies. "Glem kilde" (0052) takes the source row FOR UPDATE and
  -- this function FOR KEY SHARE (above), so they exclude each other; after a forget it returns
  -- 'source_gone'.
  perform 1 from public.funds f where f.id = _fund_id for key share;
  if not found then
    raise exception 'brain_apply_extraction_source: fund % does not exist', _fund_id;
  end if;
  perform 1 from public.brain_sources s where s.id = _source_id and s.fund_id = _fund_id for key share;
  if not found then
    return jsonb_build_object('skipped', 'source_gone');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('brain_source:' || _source_id::text, 0));

  select coalesce(array_agg(x::uuid), '{}') into v_requested
  from jsonb_array_elements_text(_batch -> 'episodes') x;
  select coalesce(array_agg(x::uuid), '{}') into v_failed
  from jsonb_array_elements_text(coalesce(_batch -> 'failed', '[]'::jsonb)) x;

  -- Episodes the model could not read are marked failed (L4 can try them again later).
  with marked as (
    update public.brain_episodes e
       set extraction_status = 'failed'
     where e.fund_id = _fund_id and e.brain_source_id = _source_id
       and e.extraction_status = 'pending' and e.id = any(v_failed)
    returning e.id
  )
  insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after, job_id)
  select _fund_id, 'L1_extract', 'update', 'episode', m.id,
         jsonb_build_object('extraction_status', 'pending'),
         jsonb_build_object('extraction_status', 'failed'), _job_id
  from marked m;

  -- Only this case's episodes that are still pending: a repeated batch applies nothing.
  select coalesce(array_agg(e.id), '{}') into v_episodes
  from public.brain_episodes e
  where e.fund_id = _fund_id
    and e.brain_source_id = _source_id
    and e.extraction_status = 'pending'
    and e.id = any(v_requested);
  if cardinality(v_episodes) = 0 then
    return jsonb_build_object('skipped', 'already_extracted', 'episodes', 0,
                              'failed', cardinality(v_failed));
  end if;

  -- Every existing entity the batch touches is locked once, in id order, with the strongest
  -- lock the batch needs (aliases, dirty marks, the upsert): no lock upgrade later, so two L1
  -- runs that share an entity (a metric, a sector) wait instead of deadlocking.
  perform 1
  from public.brain_entities e
  where e.fund_id = _fund_id
    and (e.id in (
           select (x ->> 'id')::uuid
           from jsonb_array_elements(coalesce(_batch -> 'entities', '[]'::jsonb)) x
           where x ? 'id')
         or (e.type, e.normalized_key) in (
           select x ->> 'type', x ->> 'key'
           from jsonb_array_elements(coalesce(_batch -> 'entities', '[]'::jsonb)) x
           where not (x ? 'id')))
  order by e.id
  for no key update;

  -- Entities: an existing id must be an active entity of this fund (a merged one resolves to
  -- the entity it was merged into); a new one is upserted by (type, key) unless it was deleted.
  for v_entity in select * from jsonb_array_elements(coalesce(_batch -> 'entities', '[]'::jsonb)) loop
    v_id := null;
    if v_entity ? 'id' then
      select coalesce(e.merged_into, e.id) into v_id
      from public.brain_entities e
      where e.id = (v_entity ->> 'id')::uuid
        and e.fund_id = _fund_id
        and e.status <> 'deleted';
      -- A merge target must itself be active (never attach facts to a forgotten entity).
      if v_id is not null then
        perform 1 from public.brain_entities e
        where e.id = v_id and e.fund_id = _fund_id and e.status = 'active'
        for no key update;
        if not found then
          v_id := null;
        end if;
      end if;
    else
      -- Locked up front (see above), so a "Glem" at the same moment waits instead of being
      -- undone by the upsert.
      select e.status into v_existing_status
      from public.brain_entities e
      where e.fund_id = _fund_id
        and e.type = v_entity ->> 'type'
        and e.normalized_key = v_entity ->> 'key';
      v_entity_exists := found;
      if v_entity_exists and v_existing_status = 'deleted' then
        continue;  -- forgotten on purpose (GDPR, "Glem"): never brought back by L1
      end if;
      v_id := public.brain_upsert_ref_entity(
        _fund_id, v_entity ->> 'type', v_entity ->> 'name', v_entity ->> 'key');
      perform 1 from public.brain_entities e
      where e.id = v_id and e.fund_id = _fund_id and e.status = 'active';
      if not found then
        continue;
      end if;
      if not v_entity_exists then
        insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after, job_id)
        values (_fund_id, 'L1_extract', 'insert', 'entity', v_id,
                jsonb_build_object('type', v_entity ->> 'type', 'key', v_entity ->> 'key'), _job_id);
        v_entities_created := v_entities_created + 1;
      end if;
    end if;
    -- "Nordlys" found as "Nordlys ApS": the other spelling becomes an alias (logged).
    if v_id is not null and jsonb_array_length(coalesce(v_entity -> 'aliases', '[]'::jsonb)) > 0 then
      select e.aliases into v_aliases_before
      from public.brain_entities e where e.id = v_id and e.fund_id = _fund_id;
      update public.brain_entities e
         set aliases = (
               select coalesce(array_agg(distinct a order by a), '{}')
               from unnest(e.aliases || array(
                 select jsonb_array_elements_text(v_entity -> 'aliases')
               )) a
               where lower(a) <> lower(e.name) and char_length(a) between 1 and 300
                 -- Only a spelling that an active-tier source of this batch actually uses.
                 and (a = any(e.aliases) or exists (
                   select 1 from public.brain_episodes ep
                   where ep.id = any(v_episodes)
                     and ep.trust_tier not in ('public_web', 'user_note')
                     and strpos(lower(ep.content), lower(a)) > 0))
             ),
             last_seen_at = now()
       where e.id = v_id and e.fund_id = _fund_id
      returning e.aliases into v_aliases_after;
      if v_aliases_after is distinct from v_aliases_before then
        insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after, job_id)
        values (_fund_id, 'L1_extract', 'update', 'entity', v_id,
                jsonb_build_object('aliases', v_aliases_before),
                jsonb_build_object('aliases', v_aliases_after), _job_id);
      end if;
    end if;
    if v_id is not null then
      v_refs := v_refs || jsonb_build_object(v_entity ->> 'ref', v_id);
    end if;
  end loop;

  for v_fact in select * from jsonb_array_elements(coalesce(_batch -> 'facts', '[]'::jsonb)) loop
    v_episode := (v_fact ->> 'episodeId')::uuid;
    if v_episode is null or not (v_episode = any(v_episodes)) then
      v_skipped_episode := v_skipped_episode + 1;
      v_fact_ids := v_fact_ids || 'null'::jsonb;
      continue;
    end if;
    v_subject := (v_refs ->> (v_fact ->> 'subject'))::uuid;
    v_object := case when v_fact ->> 'object' is null then null
                     else (v_refs ->> (v_fact ->> 'object'))::uuid end;
    if v_subject is null or (v_fact ->> 'object' is not null and v_object is null) then
      v_skipped_ref := v_skipped_ref + 1;
      v_fact_ids := v_fact_ids || 'null'::jsonb;
      continue;
    end if;

    select e.trust_tier, e.brain_source_id,
           case when e.ref_table = 'evidence_items' then e.ref_id end
      into v_trust, v_source, v_evidence_id
    from public.brain_episodes e where e.id = v_episode;
    v_pred := v_fact ->> 'predicate';
    v_vtext := nullif(btrim(v_fact ->> 'valueText'), '');
    v_vnum := (v_fact ->> 'valueNum')::numeric;
    v_unit := nullif(btrim(v_fact ->> 'unit'), '');
    v_from := (v_fact ->> 'validFrom')::date;
    v_to := (v_fact ->> 'validTo')::date;
    v_statement := btrim(v_fact ->> 'statement');
    v_conf := (v_fact ->> 'confidence')::real;
    v_status := case
      when v_trust in ('public_web', 'user_note') then 'proposed'
      when v_source is not null and v_pred = any(v_upload_review) then 'proposed'
      else 'active' end;
    v_contradicts := '{}';
    -- The "slot" a single-value fact fills: the stage itself is the value of at_stage, a
    -- valuation has none, a round is named in value_text, the rest is per object.
    v_slot := case v_pred
      when 'at_stage' then '-'
      when 'raised_round' then 'round:' || lower(coalesce(v_vtext, ''))
      else coalesce(v_object::text, '-') end;
    v_fact_id := null;

    -- 5. Duplicate or confirmation: same subject, predicate and object, the same value
    --    (numbers within 1 %, text case-insensitive; no value: the same statement) and an
    --    overlapping period. The episode becomes an extra source.
    select f.id, f.origin, f.trust_tier, f.status, f.confidence into v_dup
    from public.brain_facts f
    where f.fund_id = _fund_id
      and f.subject_id = v_subject
      and f.predicate = v_pred
      and f.object_id is not distinct from v_object
      and f.expired_at is null
      -- An active fact only meets active facts: L1 never activates a proposal (brain_review
      -- does). A proposal may meet either.
      and (f.status = 'active' or (v_status = 'proposed' and f.status = 'proposed'))
      and (f.unit is null or v_unit is null or lower(f.unit) = lower(v_unit))
      and (v_pred <> 'raised_round'
           or lower(coalesce(f.value_text, '')) = lower(coalesce(v_vtext, '')))
      and case
            when v_vnum is not null then
              f.value_num is not null
              and abs(f.value_num - v_vnum) <= 0.01 * greatest(abs(f.value_num), abs(v_vnum))
            when v_vtext is not null then
              f.value_num is null and lower(f.value_text) = lower(v_vtext)
            when v_object is not null then
              f.value_num is null and f.value_text is null
            else
              f.value_num is null and f.value_text is null
              and lower(regexp_replace(btrim(f.statement), '\s+', ' ', 'g'))
                = lower(regexp_replace(v_statement, '\s+', ' ', 'g'))
          end
      -- Half-open periods: a closed fact ends the day its successor begins. A one-day fact
      -- (from = to) is that single day.
      and daterange(f.valid_from, f.valid_to, case when f.valid_from = f.valid_to then '[]' else '[)' end)
          && daterange(v_from, v_to, case when v_from = v_to then '[]' else '[)' end)
    order by (f.status = 'active') desc, public.brain_trust_rank(f.trust_tier) desc, f.created_at
    limit 1;
    v_is_dup := found;

    if v_is_dup then
      -- A proposal-tier source (web, chat note, a Læser's note, an upload decision) never
      -- becomes a source of an active fact: it could keep that fact alive after the real
      -- evidence is corrected or deleted (the orphan rule in 0042). It stays an episode.
      if v_status = 'proposed' and v_dup.status = 'active' then
        v_proposal_links := v_proposal_links + 1;
      else
        -- clock_timestamp: links in one batch keep their order (the first is the statement's).
        insert into public.brain_fact_episodes (fact_id, episode_id, fund_id, quote, created_at)
        values (v_dup.id, v_episode, _fund_id, left(v_fact ->> 'quote', 400), clock_timestamp())
        on conflict (fact_id, episode_id) do nothing;
        get diagnostics v_linked = row_count;
        -- An active source confirming an active fact raises its trust and confidence (both
        -- active, so no proposal tier can land on an active fact). Projected facts are left to
        -- the projection.
        if v_dup.origin <> 'db' and v_status = 'active' and v_dup.status = 'active'
           and (public.brain_trust_rank(v_trust) > public.brain_trust_rank(v_dup.trust_tier)
                or coalesce(v_conf, 0) > coalesce(v_dup.confidence, 0)) then
          update public.brain_facts f
             set trust_tier = case when public.brain_trust_rank(v_trust) > public.brain_trust_rank(f.trust_tier)
                                   then v_trust else f.trust_tier end,
                 confidence = greatest(coalesce(f.confidence, 0), coalesce(v_conf, 0))
           where f.id = v_dup.id;
          insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after, job_id)
          values (_fund_id, 'L1_extract', 'update', 'fact', v_dup.id,
                  jsonb_build_object('trust_tier', v_dup.trust_tier, 'confidence', v_dup.confidence),
                  jsonb_build_object(
                    'trust_tier', case when public.brain_trust_rank(v_trust) > public.brain_trust_rank(v_dup.trust_tier)
                                       then v_trust else v_dup.trust_tier end,
                    'episode_id', v_episode),
                  _job_id);
        elsif v_linked > 0 then
          insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after, job_id)
          values (_fund_id, 'L1_extract', 'update', 'fact', v_dup.id,
                  jsonb_build_object('source_added', v_episode), _job_id);
        end if;
      end if;
      v_confirmed := v_confirmed + 1;
      v_dirty := v_dirty || v_subject;
      v_fact_id := v_dup.id;
    else
      -- 6. Single-value predicates: a later period closes the older fact; an older one ends
      --    where the known one begins; the same period with another value is a contradiction.
      if v_pred = any(v_single) then
        for v_old in
          select f.id, f.valid_from, f.valid_to, f.trust_tier, f.origin
          from public.brain_facts f
          where f.fund_id = _fund_id
            and f.subject_id = v_subject
            and f.predicate = v_pred
            and case v_pred
                  when 'at_stage' then true
                  when 'raised_round' then lower(coalesce(f.value_text, '')) = lower(coalesce(v_vtext, ''))
                  else f.object_id is not distinct from v_object
                end
            and f.expired_at is null
            and f.status = 'active'
          order by f.valid_from nulls first, f.created_at
        loop
          -- Only open-ended periods move: a closed period (a year, a quarter) stays as stated, so
          -- "2025" and "Q4 2025" can both stand. Only an active fact of the same or a higher rank
          -- ends an older one, and never a projected one.
          if v_from is not null and v_old.valid_from is not null and v_from > v_old.valid_from then
            if v_old.valid_to is null
               and v_status = 'active'
               and v_old.origin <> 'db'
               and public.brain_trust_rank(v_trust) >= public.brain_trust_rank(v_old.trust_tier) then
              update public.brain_facts f set valid_to = v_from where f.id = v_old.id;
              insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after, job_id)
              values (_fund_id, 'L1_extract', 'update', 'fact', v_old.id,
                      jsonb_build_object('valid_to', v_old.valid_to),
                      jsonb_build_object('valid_to', v_from), _job_id);
              v_closed := v_closed + 1;
            end if;
          elsif v_from is not null and v_old.valid_from is not null and v_from < v_old.valid_from then
            if v_to is null then
              v_to := v_old.valid_from;
            end if;
          elsif v_from is not null and v_from = v_old.valid_from
                and v_to is not distinct from v_old.valid_to then
            -- The same dated period with another value.
            v_contradicts := v_contradicts || v_old.id;
          end if;
          -- Undated values, or one dated and one undated: both stay, no contradiction, since
          -- nothing says they are about the same time (01 §8).
        end loop;
      end if;

      insert into public.brain_facts (
        fund_id, subject_id, predicate, object_id, value_text, value_num, unit, statement,
        valid_from, valid_to, trust_tier, confidence, status, origin)
      values (
        _fund_id, v_subject, v_pred, v_object, left(v_vtext, 500), v_vnum, left(v_unit, 40),
        left(v_statement, 1000), v_from, v_to, v_trust, v_conf, v_status, 'extracted')
      returning id into v_new_id;
      insert into public.brain_fact_episodes (fact_id, episode_id, fund_id, quote, created_at)
      values (v_new_id, v_episode, _fund_id, left(v_fact ->> 'quote', 400), clock_timestamp());
      insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after, job_id)
      values (_fund_id, 'L1_extract', 'insert', 'fact', v_new_id,
              jsonb_build_object('predicate', v_pred, 'episode_id', v_episode, 'status', v_status),
              _job_id);
      v_added := v_added + 1;
      v_dirty := v_dirty || v_subject;
      if v_object is not null then
        v_dirty := v_dirty || v_object;
      end if;
      v_fact_id := v_new_id;

      -- Free text (resolver in TS): only an active fact supersedes, and only a fact with the
      -- same or a lower trust rank that the projection does not own; otherwise a contradiction.
      v_rel_kind := v_fact -> 'relation' ->> 'kind';
      v_rel_fact := (v_fact -> 'relation' ->> 'factId')::uuid;
      if v_rel_kind in ('supersedes', 'contradicts') and v_rel_fact is not null then
        select f.id, f.trust_tier, f.origin into v_old
        from public.brain_facts f
        where f.id = v_rel_fact
          and f.fund_id = _fund_id
          and f.subject_id = v_subject
          and f.expired_at is null
          and f.status = 'active'
          and f.id <> v_new_id;
        if found then
          if v_rel_kind = 'supersedes'
             and v_status = 'active'
             and v_old.origin <> 'db'
             and public.brain_trust_rank(v_trust) >= public.brain_trust_rank(v_old.trust_tier) then
            update public.brain_facts f
               set expired_at = now(), superseded_by = v_new_id
             where f.id = v_old.id;
            insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after, job_id)
            values (_fund_id, 'L1_extract', 'invalidate', 'fact', v_old.id,
                    jsonb_build_object('expired_at', null, 'superseded_by', null),
                    jsonb_build_object('superseded_by', v_new_id), _job_id);
            v_superseded := v_superseded + 1;
          else
            v_contradicts := v_contradicts || v_old.id;
          end if;
        end if;
      end if;

      -- One contradiction insight per subject, predicate, slot and period (06 L1 step 6).
      -- Only an active fact raises a contradiction: a proposal (web, a Læser's note) never
      -- writes into the fund's insights; it waits in brain_review.
      if cardinality(v_contradicts) > 0 and v_status = 'active' then
        insert into public.brain_insights (
          fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
        values (
          _fund_id, 'contradiction',
          left('Modstridende oplysninger: ' || v_statement, 300),
          'Brain har to forskellige oplysninger om det samme for samme periode. Søgningen foretrækker den med højest tillid, indtil en af dem er rettet eller afvist.',
          jsonb_build_array(
            jsonb_build_object('kind', 'fact', 'id', v_new_id),
            jsonb_build_object('kind', 'fact', 'id', v_contradicts[1])),
          2, 'L1_extract',
          left('contradiction:' || v_subject::text || ':' || v_pred || ':'
               || case when v_pred = any(v_single)
                       then v_slot || ':' || coalesce(v_from::text, '-')
                       else v_contradicts[1]::text end, 300))
        on conflict (fund_id, dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_contradictions := v_contradictions + v_rows;
      end if;
    end if;

    -- Evidence the analysis itself marked contradictory (04 §2.1): one insight per evidence row.
    if v_evidence_id is not null and v_status = 'active' then
      select ev.status::text into v_evidence_status
      from public.evidence_items ev
      where ev.id = v_evidence_id and ev.fund_id = _fund_id;
      if v_evidence_status = 'contradictory' then
        insert into public.brain_insights (
          fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
        values (
          _fund_id, 'contradiction',
          left('Modstridende kilder: ' || v_statement, 300),
          'Analysen har markeret beviset som modstridende: kilderne siger forskellige ting. Afklar det, før tallet bruges.',
          jsonb_build_array(
            jsonb_build_object('kind', 'fact', 'id', v_fact_id),
            jsonb_build_object('kind', 'evidence', 'id', v_evidence_id)),
          2, 'L1_extract',
          'contradiction:evidence:' || v_evidence_id::text)
        on conflict (fund_id, dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_contradictions := v_contradictions + v_rows;
      end if;
    end if;

    v_fact_ids := v_fact_ids || to_jsonb(v_fact_id);
  end loop;

  -- 8. Finish: touched entities are dirty (L4 updates their pages), the episodes are done.
  update public.brain_entities e
     set dirty_at = now(), last_seen_at = now()
   where e.fund_id = _fund_id and e.id = any(v_dirty);
  update public.brain_episodes e
     set extraction_status = 'done'
   where e.fund_id = _fund_id and e.id = any(v_episodes);

  return jsonb_build_object(
    'episodes', cardinality(v_episodes),
    'failed', cardinality(v_failed),
    'added', v_added,
    'confirmed', v_confirmed,
    'closed', v_closed,
    'superseded', v_superseded,
    'contradictions', v_contradictions,
    'entitiesCreated', v_entities_created,
    'proposalConfirmations', v_proposal_links,
    'skippedEpisode', v_skipped_episode,
    'skippedRef', v_skipped_ref,
    'entityIds', v_refs,
    'factIds', v_fact_ids);
end;
$$;

revoke all on function public.brain_apply_extraction_source(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.brain_apply_extraction_source(uuid, uuid, uuid, jsonb) to service_role;

create or replace function public.brain_source_pending_episodes(
  _fund_id uuid,
  _source_id uuid,
  _limit int default 120
)
returns table (
  episode_id uuid, kind text, trust_tier text, occurred_at timestamptz, title text, content text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.kind, e.trust_tier, e.occurred_at, e.title, e.content
  from public.brain_episodes e
  where e.fund_id = _fund_id
    and e.brain_source_id = _source_id
    and e.extraction_status = 'pending'
  order by e.created_at, e.id
  limit least(greatest(coalesce(_limit, 120), 1), 500)
$$;

revoke all on function public.brain_source_pending_episodes(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.brain_source_pending_episodes(uuid, uuid, int) to service_role;

create or replace function public.brain_source_claim(
  _fund_id uuid, _source_id uuid, _job_id uuid, _lease_seconds int default 600
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  update public.brain_sources s
     set ingest_job_id = _job_id,
         ingest_lease_until = clock_timestamp() + make_interval(secs => least(greatest(_lease_seconds, 30), 1800))
   where s.id = _source_id and s.fund_id = _fund_id
     and (s.ingest_job_id is null or s.ingest_job_id = _job_id
          or s.ingest_lease_until is null or s.ingest_lease_until < clock_timestamp());
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.brain_source_release(_fund_id uuid, _source_id uuid, _job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.brain_sources
     set ingest_job_id = null, ingest_lease_until = null
   where id = _source_id and fund_id = _fund_id and ingest_job_id = _job_id
$$;

revoke all on function public.brain_source_claim(uuid, uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.brain_source_release(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_source_claim(uuid, uuid, uuid, int) to service_role;
grant execute on function public.brain_source_release(uuid, uuid, uuid) to service_role;
