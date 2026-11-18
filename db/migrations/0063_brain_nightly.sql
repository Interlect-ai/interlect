-- 0063 · L4 Søvn, trin 1–4 og 7–9 (L4, punkt 3, og §8).
--
-- Brains natlige oprydning som SQL-funktioner, som løkken L4_nightly kalder i rækkefølge. Ingen af
-- dem bruger en sprogmodel; det eneste betalte i L4 er resolverens anbefaling på navne-tvillinger
-- (trin 2), som løkken selv kalder med budget. Trin 5 (Brain-sider) og 6 (forudsete spørgsmål)
-- kommer, så dirty_at ryddes ikke her endnu: siderne skal kunne se, hvilke
-- entiteter der er ændret.
--
--   brain_nightly_reconcile          trin 1: rå rækker uden episode → casen mærkes til L0
--   brain_nightly_activity           "noget nyt siden sidste kørsel?" (ellers springes resten over)
--   brain_nightly_identity_merges    trin 2a: samme CVR eller domæne slås sammen automatisk
--   brain_nightly_duplicate_pairs    trin 2b: navne-tvillinger til resolveren (højst 20 par)
--   brain_nightly_lint               trin 3: modsigelser uden indsigt, forældede nøgletal,
--                                    forældreløse udtrukne entiteter
--   brain_nightly_usefulness         trin 4: nytteværdi fra rigtige spørgsmål og feedback, med
--                                    vandmærke gemt i samme transaktion (tælles aldrig to gange)
--   brain_nightly_similar            trin 7: similar_to-fakta for ændrede cases
--   brain_nightly_lessons            trin 8: pensionér eller foreslå pensionering, lektions-dubletter
--   brain_nightly_cleanup            trin 9: fakta udløbet for over 30 dage siden uden kilder
--
-- Kun nye funktioner: ingen tabel, kolonne, policy eller rettighed på eksisterende objekter ændres.
-- Alle er security definer med search_path = '' og kan kun kaldes af service_role. Ingen faste id'er.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. A domain the same way as the extractor (src/lib/brain/extract.ts normalizeDomain): no
--    scheme, no "www.", no path, port or query.
-- ---------------------------------------------------------------------------
create or replace function public.brain_normalize_domain(_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(regexp_replace(lower(btrim(coalesce(_value, ''))), '^[a-z]+://', ''), '^www\.', ''),
      '[/?#:[:space:]].*$', ''),
    '')
$$;

-- ---------------------------------------------------------------------------
-- 1. Reconciliation: raw rows that L0 turns into an episode but that have none,
--    because an enqueue was lost or failed. The same filters as brain_capture_case (0060). An
--    update of a raw row deletes its episode by trigger (0041), so "no episode for the row" also
--    catches changed text. Only cases L0 has captured before (they have a projected case entity
--    or an L0 episode): a case Brain never read is left to "Indlæs eksisterende cases", where the
--    user sees the price first. Each case with a gap gets a fresh mark in
--    brain_capture_queue (milliseconds, the precision of the L0 key, so L0 can settle it); the
--    loop enqueues L0 with that time as key. At most _limit cases per night.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_reconcile(_fund_id uuid, _limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_reconcile: fund id is required';
  end if;

  with gaps as (
    select ei.case_id
    from public.evidence_items ei
    where ei.fund_id = _fund_id and ei.case_id is not null
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'evidence_items' and e.ref_id = ei.id
          and e.brain_source_id is null)
    union
    select r.case_id
    from public.analysis_runs r
    where r.fund_id = _fund_id and r.status in ('complete', 'awaiting_approval')
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'analysis_runs' and e.ref_id = r.id
          and e.brain_source_id is null)
    union
    select r.case_id
    from public.analysis_findings f
    join public.analysis_runs r on r.id = f.run_id and r.fund_id = f.fund_id
    where f.fund_id = _fund_id and r.status in ('complete', 'awaiting_approval')
      and nullif(btrim(f.statement), '') is not null
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'analysis_findings' and e.ref_id = f.id
          and e.brain_source_id is null)
    union
    select r.case_id
    from public.risks k
    join public.analysis_runs r on r.id = k.run_id and r.fund_id = k.fund_id
    where k.fund_id = _fund_id and r.status in ('complete', 'awaiting_approval')
      and nullif(btrim(k.statement), '') is not null
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'risks' and e.ref_id = k.id
          and e.brain_source_id is null)
    union
    select n.case_id
    from public.case_notes n
    where n.fund_id = _fund_id and nullif(btrim(n.body), '') is not null
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'case_notes' and e.ref_id = n.id
          and e.brain_source_id is null)
    union
    select ev.case_id
    from public.case_transition_events ev
    where ev.fund_id = _fund_id
      and ev.movement_kind is not null and ev.movement_kind <> 'system'
      and ev.undo_of is null
      and not exists (
        select 1 from public.case_transition_events u
        where u.undo_of = ev.id and u.fund_id = ev.fund_id)
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'case_transition_events' and e.ref_id = ev.id
          and e.brain_source_id is null)
    union
    select d.case_id
    from public.documents d
    where d.fund_id = _fund_id and d.case_id is not null
      and nullif(btrim(d.extracted_text), '') is not null
      and not exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.ref_table = 'documents' and e.ref_id = d.id
          and e.brain_source_id is null)
  ),
  picked as (
    select distinct g.case_id
    from gaps g
    join public.cases c on c.id = g.case_id and c.fund_id = _fund_id
    where exists (
        select 1 from public.brain_entities ce
        where ce.fund_id = _fund_id and ce.ref_table = 'cases' and ce.ref_id = g.case_id)
      or exists (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.case_id = g.case_id and e.brain_source_id is null)
    order by g.case_id
    limit greatest(coalesce(_limit, 50), 0)
  ),
  marked as (
    insert into public.brain_capture_queue as q (fund_id, case_id, changed_at)
    select _fund_id, p.case_id, date_trunc('milliseconds', now()) from picked p
    on conflict (fund_id, case_id) do update set changed_at = excluded.changed_at
    returning q.case_id, q.changed_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('caseId', m.case_id, 'changedAt', m.changed_at)
                            order by m.case_id), '[]'::jsonb)
    into v_out
  from marked m;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Anything new since the last finished L4 run (06 L4: "kører kun for fonde med noget nyt")?
--    New episodes, feedback, real questions, entities seen or marked dirty, and lesson counts.
--    "Since" is the moment the last done or skipped run counted (its stored activity step's
--    "at"), so a retried attempt does not move it. Counts stop at 1,000; the loop only needs to
--    know whether there is something.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_activity(_fund_id uuid, _job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_from timestamptz;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_activity: fund id is required';
  end if;
  select max(coalesce((s.output ->> 'at')::timestamptz, j.started_at)) into v_since
  from public.brain_jobs j
  left join public.brain_job_steps s
    on s.job_id = j.id and s.fund_id = j.fund_id and s.step = 'activity'
  where j.fund_id = _fund_id and j.loop = 'L4_nightly' and j.status in ('done', 'skipped')
    and j.id is distinct from _job_id;
  v_from := coalesce(v_since, '-infinity'::timestamptz);

  return jsonb_build_object(
    'at', now(),
    'since', v_since,
    'episodes', (select count(*) from (
        select 1 from public.brain_episodes e
        where e.fund_id = _fund_id and e.created_at > v_from limit 1000) x),
    'feedback', (select count(*) from (
        select 1 from public.brain_feedback f
        where f.fund_id = _fund_id and f.created_at > v_from limit 1000) x),
    'retrievals', (select count(*) from (
        select 1 from public.brain_retrieval_events r
        where r.fund_id = _fund_id and r.message_id is not null and r.created_at > v_from
        limit 1000) x),
    'entities', (select count(*) from (
        select 1 from public.brain_entities e
        where e.fund_id = _fund_id and (e.last_seen_at > v_from or e.dirty_at > v_from)
        limit 1000) x),
    'bulletEvents', (select count(*) from (
        select 1 from public.brain_bullet_events b
        where b.fund_id = _fund_id and b.created_at > v_from limit 1000) x));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Duplicates with the same CVR or domain are merged automatically (06 L4 step 2). An entity's
--    identifiers are its own cvr:/domain: key and, for a company projected from the database, the
--    company's CVR and domain (a domain with a path, e.g. a LinkedIn page, is no identifier). An
--    identifier shared by more than two entities is ambiguous and merges nothing. The projected
--    entity wins (it cannot be merged away, 0055), otherwise the oldest. Two projected entities
--    are never paired, nor a pair a human has split ("Adskil") or dismissed. A merge that 0055
--    refuses (e.g. a fact between the two) becomes a merge_candidate insight for a human; any
--    other error stops the run, so it is retried.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_identity_merges(
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
  v_pair record;
  v_merged int := 0;
  v_refused int := 0;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_identity_merges: fund id is required';
  end if;

  for v_pair in
    with idents as (
      select e.id, e.type, e.name, e.ref_table, e.first_seen_at, k.ident
      from public.brain_entities e
      left join public.companies co
        on e.ref_table = 'companies' and co.id = e.ref_id and co.fund_id = e.fund_id
      cross join lateral (
        select e.normalized_key as ident where e.normalized_key ~ '^(cvr|domain):'
        union
        select 'cvr:' || btrim(co.cvr_number) where nullif(btrim(co.cvr_number), '') is not null
        union
        select 'domain:' || public.brain_normalize_domain(co.domain)
        where public.brain_normalize_domain(co.domain) is not null
          and public.brain_normalize_domain(co.domain) = regexp_replace(regexp_replace(
                regexp_replace(lower(btrim(co.domain)), '^[a-z]+://', ''), '^www\.', ''), '/+$', '')
      ) k
      where e.fund_id = _fund_id and e.status = 'active'
        and e.type in ('company', 'investor', 'fund_vehicle')
    ),
    pairs as (
      select
        case when a.ref_table is not null then a.id
             when b.ref_table is not null then b.id
             when (a.first_seen_at, a.id) < (b.first_seen_at, b.id) then a.id
             else b.id end as winner,
        case when a.ref_table is not null then b.id
             when b.ref_table is not null then a.id
             when (a.first_seen_at, a.id) < (b.first_seen_at, b.id) then b.id
             else a.id end as loser,
        a.ident
      from idents a
      join idents b on b.ident = a.ident and b.type = a.type and a.id < b.id
      where (a.ref_table is null or b.ref_table is null)
        and (select count(distinct x.id) from idents x
             where x.ident = a.ident and x.type = a.type) = 2
    )
    select distinct on (p.loser) p.winner, p.loser, p.ident,
           w.name as winner_name, l.name as loser_name
    from pairs p
    join public.brain_entities w on w.id = p.winner and w.fund_id = _fund_id
    join public.brain_entities l on l.id = p.loser and l.fund_id = _fund_id
    where not exists (
        select 1 from public.brain_log g
        where g.fund_id = _fund_id and g.action = 'split' and g.object_kind = 'entity'
          and g.object_id in (p.winner, p.loser))
      and not exists (
        select 1 from public.brain_insights i
        where i.fund_id = _fund_id and i.status = 'dismissed'
          and i.dedupe_key = 'merge_candidate:' || least(p.winner, p.loser)::text || ':'
                             || greatest(p.winner, p.loser)::text)
    order by p.loser, p.ident
    limit greatest(coalesce(_limit, 50), 0)
  loop
    begin
      perform public.brain_merge_entities(
        _fund_id, v_pair.winner, v_pair.loser, 'L4_nightly',
        'Samme ' || case when v_pair.ident like 'cvr:%' then 'CVR' else 'domæne' end
          || ' (' || v_pair.ident || ')',
        _job_id);
      v_merged := v_merged + 1;
    exception when raise_exception or no_data_found then
      -- Refused by 0055 (or one of them was merged by an earlier pair this night): a human
      -- decides. Lock timeouts and other errors are not caught, so the run is retried.
      v_refused := v_refused + 1;
      insert into public.brain_insights (
        fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
      select _fund_id, 'merge_candidate',
        left('Er "' || v_pair.loser_name || '" og "' || v_pair.winner_name || '" det samme?', 300),
        'De har samme ' || case when v_pair.ident like 'cvr:%' then 'CVR-nummer' else 'domæne' end
          || ', men Brain kunne ikke lægge dem sammen automatisk. Læg dem sammen, hvis de er det samme.',
        jsonb_build_array(jsonb_build_object('kind', 'entity', 'id', v_pair.loser),
                          jsonb_build_object('kind', 'entity', 'id', v_pair.winner)),
        2, 'L4_nightly',
        'merge_candidate:' || least(v_pair.winner, v_pair.loser)::text || ':'
          || greatest(v_pair.winner, v_pair.loser)::text
      where exists (
        select 1 from public.brain_entities x
        where x.fund_id = _fund_id and x.id in (v_pair.winner, v_pair.loser)
        group by x.fund_id having count(*) = 2 and bool_and(x.status = 'active'))
      on conflict (fund_id, dedupe_key) do nothing;
    end;
  end loop;

  return jsonb_build_object('merged', v_merged, 'refused', v_refused);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Name twins for the resolver (06 L4 step 2): entity pairs of the same type, with trigram
--    >= 0.9 on the name or cosine >= 0.92, from the 1,000 entities seen most recently (so the
--    changed ones first). A pair is asked once: its merge_candidate insight (new, accepted or
--    dismissed) keeps it out, so pairs beyond the night's limit come the next night. Persons only within
--    the same company (the key's "@<company>", as in L1). Cases are never paired (their vector is
--    the case profile, so two similar cases are not one), nor two projected entities (0055 cannot
--    merge them), nor a pair that already has a merge_candidate insight. Best pairs first.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_duplicate_pairs(
  _fund_id uuid,
  _limit int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_duplicate_pairs: fund id is required';
  end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('pg_trgm.similarity_threshold', '0.9', true);

  with changed as (
    select e.id, e.type, e.name, e.normalized_key, e.ref_table, e.embedding
    from public.brain_entities e
    where e.fund_id = _fund_id and e.status = 'active' and e.type <> 'case'
    order by e.last_seen_at desc
    limit 1000
  ),
  candidates as (
    select a.id as a_id, b.id as b_id
    from changed a
    cross join lateral (
      select b.id from public.brain_entities b
      where b.fund_id = _fund_id and b.type = a.type and b.status = 'active' and b.id <> a.id
        and b.name operator(extensions.%) a.name
        and extensions.similarity(b.name, a.name) >= 0.9
      limit 5
    ) b
    union
    select a.id, b.id
    from changed a
    cross join lateral (
      select b.id from public.brain_entities b
      where a.embedding is not null and b.embedding is not null
        and b.fund_id = _fund_id and b.type = a.type and b.status = 'active' and b.id <> a.id
      order by b.embedding operator(public.<=>) a.embedding
      limit 5
    ) b
  ),
  scored as (
    select distinct on (least(a.id, b.id), greatest(a.id, b.id))
      a.id as a_id, a.name as a_name, a.type, a.normalized_key as a_key,
      b.id as b_id, b.name as b_name, b.normalized_key as b_key,
      round(extensions.similarity(a.name, b.name)::numeric, 3) as trigram,
      case when a.embedding is not null and b.embedding is not null
           then round((1 - (a.embedding operator(public.<=>) b.embedding))::numeric, 3) end as cosine
    from candidates c
    join public.brain_entities a on a.id = c.a_id and a.fund_id = _fund_id
    join public.brain_entities b on b.id = c.b_id and b.fund_id = _fund_id
    where (a.ref_table is null or b.ref_table is null)
      and (a.type <> 'person'
           or split_part(a.normalized_key, '@', 2) = split_part(b.normalized_key, '@', 2))
    order by least(a.id, b.id), greatest(a.id, b.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'a', jsonb_build_object('id', s.a_id, 'name', s.a_name, 'type', s.type, 'key', s.a_key),
      'b', jsonb_build_object('id', s.b_id, 'name', s.b_name, 'type', s.type, 'key', s.b_key),
      'trigram', s.trigram, 'cosine', s.cosine)), '[]'::jsonb)
    into v_out
  from (
    select s.* from scored s
    where (s.trigram >= 0.9 or s.cosine >= 0.92)
      and not exists (
        select 1 from public.brain_insights i
        where i.fund_id = _fund_id
          and i.dedupe_key = 'merge_candidate:' || least(s.a_id, s.b_id)::text || ':'
                             || greatest(s.a_id, s.b_id)::text)
    order by greatest(s.trigram, coalesce(s.cosine, 0)) desc, s.a_id, s.b_id
    limit greatest(coalesce(_limit, 20), 0)
  ) s;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Lint (06 L4 step 3, "Karpathy"):
--    a) open contradictions without an insight: two active facts in the same slot and the same
--       dated period that L1's duplicate rule would not call the same value (the rule and dedupe
--       key of L1 in 0045, so a pair L1 already reported is not reported again, and a dismissed
--       one stays dismissed);
--    b) stale numbers: the newest metric of an active case's company is older than 18 months;
--    c) orphans: extracted entities without any fact for 30 days are deleted (not a merge winner,
--       not a source's or a historical decision's company, no page). The log keeps only the type,
--       so no name outlives the entity.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_lint(_fund_id uuid, _job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contradictions int := 0;
  v_stale int := 0;
  v_orphans int := 0;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_lint: fund id is required';
  end if;

  with slotted as (
    select f.id, f.subject_id, f.predicate, f.object_id, f.value_num, f.value_text, f.unit,
      f.valid_from, f.valid_to, f.statement, f.created_at, f.trust_tier,
      case f.predicate
        when 'at_stage' then '-'
        when 'raised_round' then 'round:' || lower(coalesce(f.value_text, ''))
        else coalesce(f.object_id::text, '-') end as slot
    from public.brain_facts f
    where f.fund_id = _fund_id and f.status = 'active' and f.expired_at is null
      and f.valid_from is not null
      and f.predicate in ('metric', 'valued_at', 'at_stage', 'has_role', 'raised_round')
  ),
  -- Two facts in the same slot and period that L1's duplicate rule (0045 step 5) would not call
  -- the same value: numbers more than 1 % apart, other text, another object.
  pairs as (
    select distinct on (a.subject_id, a.predicate, a.slot, a.valid_from)
      a.subject_id, a.predicate, a.slot, a.valid_from, a.id as a_id, b.id as b_id,
      case when b.created_at > a.created_at then b.statement else a.statement end as statement
    from slotted a
    join slotted b
      on b.subject_id = a.subject_id and b.predicate = a.predicate and b.slot = a.slot
     and b.valid_from = a.valid_from and b.valid_to is not distinct from a.valid_to
     and b.id <> a.id
    where not (
      a.object_id is not distinct from b.object_id
      and (a.unit is null or b.unit is null or lower(a.unit) = lower(b.unit))
      and (a.predicate <> 'raised_round'
           or lower(coalesce(a.value_text, '')) = lower(coalesce(b.value_text, '')))
      and case
            when a.value_num is not null then
              b.value_num is not null
              and abs(a.value_num - b.value_num) <= 0.01 * greatest(abs(a.value_num), abs(b.value_num))
            when a.value_text is not null then
              b.value_num is null and lower(a.value_text) = lower(b.value_text)
            when a.object_id is not null then
              b.value_num is null and b.value_text is null
            else
              b.value_num is null and b.value_text is null
              and lower(regexp_replace(btrim(a.statement), '\s+', ' ', 'g'))
                = lower(regexp_replace(btrim(b.statement), '\s+', ' ', 'g'))
          end)
    order by a.subject_id, a.predicate, a.slot, a.valid_from,
      public.brain_trust_rank(a.trust_tier) desc, a.created_at desc, a.id, b.id
  ),
  inserted as (
    insert into public.brain_insights (
      fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
    select _fund_id, 'contradiction',
      left('Modstridende oplysninger: ' || p.statement, 300),
      'Brain har to forskellige oplysninger om det samme for samme periode. Søgningen foretrækker den med højest tillid, indtil en af dem er rettet eller afvist.',
      jsonb_build_array(jsonb_build_object('kind', 'fact', 'id', p.a_id),
                        jsonb_build_object('kind', 'fact', 'id', p.b_id)),
      2, 'L4_nightly',
      left('contradiction:' || p.subject_id::text || ':' || p.predicate || ':' || p.slot || ':'
           || p.valid_from::text, 300)
    from pairs p
    on conflict (fund_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_contradictions from inserted;

  with active_companies as (
    select distinct on (e.id) e.id as entity_id, e.name, c.id as case_id
    from public.cases c
    join public.brain_entities e
      on e.fund_id = c.fund_id and e.ref_table = 'companies' and e.ref_id = c.company_id
     and e.status = 'active'
    where c.fund_id = _fund_id
      and c.process_stage not in ('invested', 'closed_without_investment')
      and c.workspace_status <> 'archived'
    order by e.id, c.created_at desc
  ),
  newest as (
    select ac.entity_id, ac.name, ac.case_id, m.id as fact_id, m.at
    from active_companies ac
    cross join lateral (
      select f.id, coalesce(f.valid_to, f.valid_from) as at
      from public.brain_facts f
      where f.fund_id = _fund_id and f.subject_id = ac.entity_id and f.predicate = 'metric'
        and f.status = 'active' and f.expired_at is null
        and coalesce(f.valid_to, f.valid_from) is not null
      order by coalesce(f.valid_to, f.valid_from) desc, f.created_at desc
      limit 1
    ) m
  ),
  inserted as (
    insert into public.brain_insights (
      fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
    select _fund_id, 'stale_fact',
      left('Forældede nøgletal: ' || n.name, 300),
      'Det nyeste nøgletal, Brain har om ' || n.name || ', gælder '
        || to_char(n.at, 'DD-MM-YYYY')
        || ', mere end 18 måneder siden. Hent nye tal, før casen vurderes igen.',
      jsonb_build_array(jsonb_build_object('kind', 'entity', 'id', n.entity_id),
                        jsonb_build_object('kind', 'fact', 'id', n.fact_id),
                        jsonb_build_object('kind', 'case', 'id', n.case_id)),
      3, 'L4_nightly',
      'stale_fact:' || n.entity_id::text || ':' || n.fact_id::text
    from newest n
    where n.at < (now() - interval '18 months')::date
    on conflict (fund_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_stale from inserted;

  with orphans as (
    select e.id
    from public.brain_entities e
    where e.fund_id = _fund_id and e.ref_table is null and e.status = 'active'
      and e.created_at < now() - interval '30 days'
      and e.last_seen_at < now() - interval '30 days'
      and not exists (select 1 from public.brain_facts f
                      where f.fund_id = _fund_id and (f.subject_id = e.id or f.object_id = e.id))
      and not exists (select 1 from public.brain_entities m
                      where m.fund_id = _fund_id and m.merged_into = e.id)
      and not exists (select 1 from public.brain_sources s
                      where s.fund_id = _fund_id and s.company_entity_id = e.id)
      and not exists (select 1 from public.brain_historical_decisions h
                      where h.fund_id = _fund_id and h.company_entity_id = e.id)
      and not exists (select 1 from public.brain_pages p
                      where p.fund_id = _fund_id and p.entity_id = e.id)
    order by e.last_seen_at
    limit 500
  ),
  deleted as (
    delete from public.brain_entities e
    using orphans o
    where e.id = o.id and e.fund_id = _fund_id
    returning e.id, e.type
  ),
  logged as (
    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, reason,
                                  job_id)
    select _fund_id, 'L4_nightly', 'delete', 'entity', d.id, jsonb_build_object('type', d.type),
      'Ingen fakta i 30 dage', _job_id
    from deleted d
    returning 1
  )
  select count(*) into v_orphans from logged;

  return jsonb_build_object('contradictions', v_contradictions, 'staleFacts', v_stale,
                            'orphansDeleted', v_orphans);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Usefulness (06 L4 step 4): only real questions (message_id is not null), after the
--    watermark. Per answer (all searches of one message together): a source it cited gets
--    alpha + 1; one in a search's top 5 but not cited, beta + 0.2. Feedback "useful": alpha + 2
--    for the answer's sources; "wrong": beta + 3 for the marked ones. Each feedback row counts
--    once (a changed click keeps its first count; the ids are kept in the step). Rows younger
--    than an hour wait (the answer may still be marking its citations). The counts and the new
--    watermark are written in one transaction, through brain_record_job_step, under a per-fund
--    lock: a retry of the same job returns the stored step and counts nothing, two overlapping
--    runs cannot read the same watermark, and a lost lease rolls everything back.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_usefulness(
  _fund_id uuid,
  _job_id uuid,
  _attempt int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing jsonb;
  v_after_event bigint;
  v_after_feedback timestamptz;
  v_cutoff timestamptz := now() - interval '1 hour';
  v_last_event bigint;
  v_events int;
  v_feedback_ids jsonb;
  v_items int;
  v_out jsonb;
begin
  if _fund_id is null or _job_id is null or _attempt is null then
    raise exception 'brain_nightly_usefulness: fund, job and attempt are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('brain_usefulness:' || _fund_id::text, 0));

  select s.output into v_existing
  from public.brain_job_steps s
  where s.job_id = _job_id and s.fund_id = _fund_id and s.step = 'usefulness';
  if found then
    return coalesce(v_existing, '{}'::jsonb) || jsonb_build_object('repeated', true);
  end if;

  select coalesce(max((s.output ->> 'lastEventId')::bigint), 0),
         coalesce(max((s.output ->> 'feedbackUntil')::timestamptz), '-infinity'::timestamptz)
    into v_after_event, v_after_feedback
  from public.brain_job_steps s
  join public.brain_jobs j on j.id = s.job_id and j.fund_id = s.fund_id
  where s.fund_id = _fund_id and j.loop = 'L4_nightly' and s.step = 'usefulness';

  -- The events after the watermark, oldest first, at most 5,000 a night. They are read twice
  -- (count and deltas) by id range; a newer event always has a higher id.
  select max(x.id), count(*) into v_last_event, v_events
  from (
    select r.id
    from public.brain_retrieval_events r
    where r.fund_id = _fund_id and r.message_id is not null and r.id > v_after_event
      and r.created_at < v_cutoff
    order by r.id
    limit 5000
  ) x;

  -- Feedback after its watermark that no earlier night counted (a re-click moves created_at).
  select coalesce(jsonb_agg(f.id order by f.id), '[]'::jsonb) into v_feedback_ids
  from public.brain_feedback f
  where f.fund_id = _fund_id and f.created_at > v_after_feedback and f.created_at <= v_cutoff
    and not exists (
      select 1
      from public.brain_job_steps s
      join public.brain_jobs j on j.id = s.job_id and j.fund_id = s.fund_id
      where s.fund_id = _fund_id and j.loop = 'L4_nightly' and s.step = 'usefulness'
        and coalesce(s.output -> 'feedbackIds', '[]'::jsonb) ? f.id::text);

  with candidates as (
    select r.message_id, c ->> 'kind' as item_kind, c ->> 'id' as item_key,
      c ->> 'cited' = 'true' as cited,
      case when coalesce(c ->> 'rank', '') ~ '^[0-9]+$' then (c ->> 'rank')::int end as rank
    from public.brain_retrieval_events r
    cross join lateral jsonb_array_elements(r.candidates) c
    where r.fund_id = _fund_id and r.message_id is not null and r.id > v_after_event
      and r.id <= coalesce(v_last_event, v_after_event) and r.created_at < v_cutoff
      and jsonb_typeof(r.candidates) = 'array'
  ),
  per_answer as (
    select c.item_kind, c.item_key,
      case when bool_or(c.cited) then 1.0 else 0 end as d_alpha,
      case when not bool_or(coalesce(c.cited, false)) and min(c.rank) <= 5 then 0.2 else 0 end
        as d_beta
    from candidates c
    group by c.message_id, c.item_kind, c.item_key
  ),
  feedback as (
    select f.rating, f.wrong_citation_ns,
      case when jsonb_typeof(m.citations) = 'array' then m.citations else '[]'::jsonb end as citations
    from public.brain_feedback f
    join public.brain_messages m on m.id = f.message_id and m.fund_id = f.fund_id
    where f.fund_id = _fund_id and v_feedback_ids ? f.id::text
  ),
  deltas as (
    select p.item_kind, p.item_key, p.d_alpha, p.d_beta from per_answer p
    union all
    select c ->> 'kind', c ->> 'id',
      case when fb.rating = 'useful' then 2.0 else 0 end,
      case when fb.rating = 'wrong' and coalesce(c ->> 'n', '') ~ '^[0-9]+$'
                and (c ->> 'n')::int = any(fb.wrong_citation_ns)
           then 3.0 else 0 end
    from feedback fb
    cross join lateral jsonb_array_elements(fb.citations) c
    where fb.rating in ('useful', 'wrong')
  ),
  totals as (
    select d.item_kind, d.item_key, sum(d.d_alpha) as a, sum(d.d_beta) as b
    from deltas d
    where d.item_kind in ('chunk', 'fact', 'page', 'bullet')
      and char_length(coalesce(d.item_key, '')) between 1 and 300
    group by d.item_kind, d.item_key
    having sum(d.d_alpha) > 0 or sum(d.d_beta) > 0
  ),
  upserted as (
    insert into public.brain_usefulness as u (fund_id, item_kind, item_key, alpha, beta)
    select _fund_id, t.item_kind, t.item_key, (1 + t.a)::real, (1 + t.b)::real
    from totals t
    on conflict (fund_id, item_kind, item_key) do update
      set alpha = u.alpha + excluded.alpha - 1,
          beta = u.beta + excluded.beta - 1,
          updated_at = now()
    returning 1
  )
  select count(*) into v_items from upserted;

  v_out := jsonb_build_object(
    'events', v_events, 'feedback', jsonb_array_length(v_feedback_ids), 'items', v_items,
    'lastEventId', coalesce(v_last_event, v_after_event),
    'feedbackUntil', greatest(v_cutoff, v_after_feedback),
    'feedbackIds', v_feedback_ids);
  if not public.brain_record_job_step(_job_id, _fund_id, _attempt, 'usefulness', v_out, 0) then
    raise exception 'brain_nightly_usefulness: the job lease was lost';
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Similar cases (06 L4 step 7): for each case whose profile vector changed since the last run
--    (L0 logs 'case_profile'), its top 5 neighbours with cosine >= 0.80 become similar_to facts
--    (origin 'derived', trust 'analysis', value_num = cosine). A neighbour that dropped out is
--    expired (step 9 deletes it after 30 days). At most _limit cases per night, the changed ones
--    first; a case that was never compared (a first night above the limit) comes on a later
--    night.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_similar(
  _fund_id uuid,
  _since timestamptz default null,
  _limit int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case record;
  v_cases int := 0;
  v_added int := 0;
  v_updated int := 0;
  v_expired int := 0;
  v_near jsonb;
  v_n int;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_similar: fund id is required';
  end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  for v_case in
    select e.id, e.name, e.embedding
    from public.brain_entities e
    where e.fund_id = _fund_id and e.type = 'case' and e.status = 'active'
      and e.embedding is not null
      and (_since is null
           or exists (
             select 1 from public.brain_log l
             where l.fund_id = _fund_id and l.object_kind = 'case_profile' and l.object_id = e.id
               and l.created_at > _since)
           or not exists (
             select 1 from public.brain_facts f
             where f.fund_id = _fund_id and f.subject_id = e.id and f.predicate = 'similar_to'
               and f.origin = 'derived'))
    order by exists (
        select 1 from public.brain_log l
        where l.fund_id = _fund_id and l.object_kind = 'case_profile' and l.object_id = e.id
          and l.created_at > coalesce(_since, '-infinity'::timestamptz)) desc,
      e.last_seen_at desc, e.id
    limit greatest(coalesce(_limit, 200), 0)
  loop
    v_cases := v_cases + 1;
    select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'cosine', n.cosine)),
                    '[]'::jsonb)
      into v_near
    from (
      select b.id, b.name,
        round((1 - (b.embedding operator(public.<=>) v_case.embedding))::numeric, 3) as cosine
      from public.brain_entities b
      where b.fund_id = _fund_id and b.type = 'case' and b.status = 'active'
        and b.embedding is not null and b.id <> v_case.id
      order by b.embedding operator(public.<=>) v_case.embedding
      limit 5
    ) n
    where n.cosine >= 0.80;

    update public.brain_facts f
       set expired_at = now()
     where f.fund_id = _fund_id and f.subject_id = v_case.id and f.predicate = 'similar_to'
       and f.origin = 'derived' and f.expired_at is null
       and not exists (select 1 from jsonb_to_recordset(v_near) as n(id uuid)
                       where n.id = f.object_id);
    get diagnostics v_n = row_count;
    v_expired := v_expired + v_n;

    update public.brain_facts f
       set value_num = n.cosine,
           confidence = least(n.cosine, 1)::real,
           statement = left(v_case.name || ' ligner ' || n.name || ' (lighed '
                            || replace(to_char(n.cosine, 'FM0.00'), '.', ',') || ')', 1000),
           recorded_at = now()
      from jsonb_to_recordset(v_near) as n(id uuid, name text, cosine numeric)
     where f.fund_id = _fund_id and f.subject_id = v_case.id and f.object_id = n.id
       and f.predicate = 'similar_to' and f.origin = 'derived' and f.expired_at is null
       and f.value_num is distinct from n.cosine;
    get diagnostics v_n = row_count;
    v_updated := v_updated + v_n;

    insert into public.brain_facts (fund_id, subject_id, predicate, object_id, value_num,
                                    statement, trust_tier, confidence, status, origin)
    select _fund_id, v_case.id, 'similar_to', n.id, n.cosine,
      left(v_case.name || ' ligner ' || n.name || ' (lighed '
           || replace(to_char(n.cosine, 'FM0.00'), '.', ',') || ')', 1000),
      'analysis', least(n.cosine, 1)::real, 'active', 'derived'
    from jsonb_to_recordset(v_near) as n(id uuid, name text, cosine numeric)
    where not exists (
      select 1 from public.brain_facts f
      where f.fund_id = _fund_id and f.subject_id = v_case.id and f.object_id = n.id
        and f.predicate = 'similar_to' and f.origin = 'derived' and f.expired_at is null);
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return jsonb_build_object('cases', v_cases, 'added', v_added, 'updated', v_updated,
                            'expired', v_expired);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Lessons (06 L4 step 8): harmful >= helpful + 3 and harmful >= 3. A lesson Brain wrote
--    that no human approved is retired at once (logged); any other gets a bullet_retire insight.
--    Lesson pairs with cosine >= 0.92 get a merge_candidate insight (refs of kind 'bullet').
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_lessons(_fund_id uuid, _job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bullet record;
  v_retired int := 0;
  v_suggested int := 0;
  v_duplicates int := 0;
  v_n int;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_lessons: fund id is required';
  end if;

  for v_bullet in
    select b.id, b.short_id, b.text, b.status, b.origin, b.approved_by, b.helpful, b.harmful
    from public.brain_playbook_bullets b
    where b.fund_id = _fund_id and b.status in ('candidate', 'active')
      and b.harmful >= b.helpful + 3 and b.harmful >= 3
    order by b.short_id
    for update
  loop
    if v_bullet.origin = 'brain' and v_bullet.approved_by is null then
      update public.brain_playbook_bullets set status = 'retired'
       where id = v_bullet.id and fund_id = _fund_id;
      insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
                                    reason, job_id)
      values (_fund_id, 'L4_nightly', 'retire', 'bullet', v_bullet.id,
              jsonb_build_object('status', v_bullet.status),
              jsonb_build_object('status', 'retired', 'helpful', v_bullet.helpful,
                                 'harmful', v_bullet.harmful),
              'Flere skadelige end nyttige tællinger, og ingen har godkendt lektionen', _job_id);
      v_retired := v_retired + 1;
    else
      insert into public.brain_insights (
        fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
      values (_fund_id, 'bullet_retire',
        left('Pensionér lektion ' || v_bullet.short_id || '?', 300),
        'Lektionen "' || left(v_bullet.text, 300) || '" har talt imod ' || v_bullet.harmful
          || ' gange og for ' || v_bullet.helpful
          || ' gange. Brain foreslår at pensionere den.',
        jsonb_build_array(jsonb_build_object('kind', 'bullet', 'id', v_bullet.id)),
        2, 'L4_nightly', 'bullet_retire:' || v_bullet.id::text)
      on conflict (fund_id, dedupe_key) do nothing;
      get diagnostics v_n = row_count;
      v_suggested := v_suggested + v_n;
    end if;
  end loop;

  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  with pairs as (
    select a.id as a_id, a.short_id as a_short, n.id as b_id, n.short_id as b_short
    from public.brain_playbook_bullets a
    cross join lateral (
      select b.id, b.short_id
      from public.brain_playbook_bullets b
      where b.fund_id = _fund_id and b.status in ('candidate', 'active') and b.id > a.id
        and b.embedding is not null
        and 1 - (b.embedding operator(public.<=>) a.embedding) >= 0.92
      order by b.embedding operator(public.<=>) a.embedding
      limit 3
    ) n
    where a.fund_id = _fund_id and a.status in ('candidate', 'active') and a.embedding is not null
      and not exists (
        select 1 from public.brain_insights i
        where i.fund_id = _fund_id
          and i.dedupe_key = 'merge_candidate:bullet:' || a.id::text || ':' || n.id::text)
    limit 20
  ),
  inserted as (
    insert into public.brain_insights (
      fund_id, kind, title, body_md, refs, priority, created_by_loop, dedupe_key)
    select _fund_id, 'merge_candidate',
      left('Er lektion ' || p.a_short || ' og ' || p.b_short || ' den samme?', 300),
      'De to lektioner siger næsten det samme. Læg dem sammen, eller afvis den ene.',
      jsonb_build_array(jsonb_build_object('kind', 'bullet', 'id', p.a_id),
                        jsonb_build_object('kind', 'bullet', 'id', p.b_id)),
      3, 'L4_nightly',
      'merge_candidate:bullet:' || p.a_id::text || ':' || p.b_id::text
    from pairs p
    on conflict (fund_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_duplicates from inserted;

  return jsonb_build_object('retired', v_retired, 'retireSuggested', v_suggested,
                            'duplicates', v_duplicates);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Clean-up (06 L4 step 9): facts expired more than 30 days ago that no episode carries
--    are deleted, except projected ones (origin 'db', kept by the projection). At most 1,000 a
--    night, each logged.
-- ---------------------------------------------------------------------------
create or replace function public.brain_nightly_cleanup(_fund_id uuid, _job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int := 0;
begin
  if _fund_id is null then
    raise exception 'brain_nightly_cleanup: fund id is required';
  end if;

  with gone as (
    select f.id
    from public.brain_facts f
    where f.fund_id = _fund_id and f.origin <> 'db'
      and f.expired_at < now() - interval '30 days'
      and not exists (select 1 from public.brain_fact_episodes fe
                      where fe.fact_id = f.id and fe.fund_id = _fund_id)
    order by f.expired_at
    limit 1000
  ),
  deleted as (
    delete from public.brain_facts f
    using gone g
    where f.id = g.id and f.fund_id = _fund_id
    returning f.id, f.predicate
  ),
  logged as (
    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, reason,
                                  job_id)
    select _fund_id, 'L4_nightly', 'delete', 'fact', d.id,
      jsonb_build_object('predicate', d.predicate), 'Udløbet for over 30 dage siden uden kilder',
      _job_id
    from deleted d
    returning 1
  )
  select count(*) into v_deleted from logged;

  return jsonb_build_object('factsDeleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rights: the worker (service_role) only.
-- ---------------------------------------------------------------------------
revoke all on function public.brain_normalize_domain(text) from public, anon, authenticated;
revoke all on function public.brain_nightly_reconcile(uuid, int) from public, anon, authenticated;
revoke all on function public.brain_nightly_activity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_nightly_identity_merges(uuid, uuid, int)
  from public, anon, authenticated;
revoke all on function public.brain_nightly_duplicate_pairs(uuid, int)
  from public, anon, authenticated;
revoke all on function public.brain_nightly_lint(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_nightly_usefulness(uuid, uuid, int)
  from public, anon, authenticated;
revoke all on function public.brain_nightly_similar(uuid, timestamptz, int)
  from public, anon, authenticated;
revoke all on function public.brain_nightly_lessons(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_nightly_cleanup(uuid, uuid) from public, anon, authenticated;

grant execute on function public.brain_normalize_domain(text) to service_role;
grant execute on function public.brain_nightly_reconcile(uuid, int) to service_role;
grant execute on function public.brain_nightly_activity(uuid, uuid) to service_role;
grant execute on function public.brain_nightly_identity_merges(uuid, uuid, int) to service_role;
grant execute on function public.brain_nightly_duplicate_pairs(uuid, int)
  to service_role;
grant execute on function public.brain_nightly_lint(uuid, uuid) to service_role;
grant execute on function public.brain_nightly_usefulness(uuid, uuid, int) to service_role;
grant execute on function public.brain_nightly_similar(uuid, timestamptz, int) to service_role;
grant execute on function public.brain_nightly_lessons(uuid, uuid) to service_role;
grant execute on function public.brain_nightly_cleanup(uuid, uuid) to service_role;

commit;
