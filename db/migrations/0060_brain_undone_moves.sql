-- 0060 · Fortrudte flytninger er ikke beslutninger i Brain.
--
-- "Fortryd" (undo_case_transitions, 0039) sletter ikke den fortrudte flytning: den skriver en ny
-- række med movement_kind 'system' og undo_of = den fortrudte række. brain_case_decisions
-- (0038/0046) og decision_stats tager allerede højde for det, men to steder i Brain gjorde ikke:
--   1. brain_capture_case (0044) gemte den fortrudte flytning som en L0-episode af slagsen
--      'decision' ("Kasseret i screening ..."), så chat og søgning så en beslutning, der ikke findes.
--   2. brain_project_db_entities (0042) lavede et 'decided'-faktum af en fortrudt kassering,
--      afvisning eller investering, og en fortrudt genåbning lukkede stadig beslutningen (valid_to).
-- Nu tæller en flytning kun, når den hverken er en fortrydelse eller selv er fortrudt (samme regel
-- som brain_case_decisions). Resten af de to funktioner er uændret.
--
-- Data, der allerede ligger i Brain: episoderne for fortrudte flytninger slettes (tekststykker og
-- faktum-links følger med; et faktum, der mister sin sidste kilde, udløber), og projektionen køres
-- igen for de berørte cases, så deres 'decided'-fakta udløber eller genåbnes. Begge dele er afledte
-- data, som kan genskabes af de rå tabeller; casens log (case_transition_events) røres ikke.
-- Casen mærkes i brain_capture_queue, så L0 og L4 ser ændringen, som når en rå række ændres.
--
-- Samme signaturer, samme rettigheder: additiv og bagudkompatibel (preview og produktion deler
-- databasen; koden virker med både 0044/0042 og 0060). Migrationen bruger ingen sprogmodel. Når et
-- AI-udtrukket faktum udløber, læser Brain dets øvrige kilder igen (0052), så der kommer en lille
-- betalt L1-genlæsning bagefter (på staging kun demo-fonden: ca. 50 episoder).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. L0 for one case (0044) without undone moves.
-- ---------------------------------------------------------------------------
create or replace function public.brain_capture_case(_fund_id uuid, _case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_domain text;
  v_drafts jsonb;
  v_removed int := 0;
  v_added int := 0;
  v_chunks int := 0;
  v_pending int := 0;
begin
  if _fund_id is null or _case_id is null then
    raise exception 'brain_capture_case: fund id and case id are required';
  end if;
  -- Lock order fund -> case -> episodes, the same as delete_fund and case deletes, so the
  -- worker can never deadlock with them (it waits instead).
  perform 1 from public.funds f where f.id = _fund_id for key share;
  select c.company_id into v_company
  from public.cases c where c.id = _case_id and c.fund_id = _fund_id
  for key share;
  if not found then
    raise exception 'brain_capture_case: case not found in this fund';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('brain_capture:' || _case_id::text, 0));

  select nullif(lower(btrim(co.domain)), '') into v_domain
  from public.companies co where co.id = v_company and co.fund_id = _fund_id;

  with runs as (
    select r.id, r.kind, coalesce(r.completed_at, r.created_at) as done_at
    from public.analysis_runs r
    where r.fund_id = _fund_id and r.case_id = _case_id
      and r.status in ('complete', 'awaiting_approval')
  ),
  drafts as (
    -- Evidence (2.1 trust rules)
    select 'evidence'::text as kind, 'evidence_items'::text as ref_table, ei.id as ref_id,
      left(coalesce(nullif(btrim(s.title), ''), s.url), 300) as title,
      concat_ws(' ',
        regexp_replace(btrim(ei.claim) || coalesce(': ' || nullif(btrim(ei.value_text), ''), ''),
          '([^.!?])$', '\1.'),
        nullif(btrim(ei.excerpt), ''),
        'Status: ' || case ei.status
          when 'verified' then 'verificeret'
          when 'corroborated' then 'korroboreret'
          when 'company_stated' then 'oplyst af selskabet'
          when 'contradictory' then 'modstridende'
          else 'ukendt' end || '.') as content,
      case
        when s.source_type in ('official_registry', 'official_filing', 'regulator')
             and ei.status in ('verified', 'corroborated') then 'official'
        when ei.status = 'company_stated' then 'company_claim'
        when v_domain is not null and s.url is not null
             and strpos(lower(s.url), v_domain) > 0 then 'company_claim'
        else 'third_party' end as trust_tier,
      coalesce(ei.observation_date::timestamptz, ei.period_end::timestamptz,
        ei.source_date::timestamptz, ei.collected_at) as occurred_at
    from public.evidence_items ei
    left join public.sources s on s.id = ei.source_id and s.fund_id = ei.fund_id
    where ei.fund_id = _fund_id and ei.case_id = _case_id

    union all
    -- Findings from finished runs
    select 'finding', 'analysis_findings', f.id, null,
      '[' || f.category::text || ' · ' || case f.finding_type
          when 'strength' then 'styrke'
          when 'weakness' then 'svaghed'
          when 'unknown' then 'ukendt'
          when 'question' then 'spørgsmål'
          else 'vurdering' end || '] ' || btrim(f.statement),
      case when f.nature = 'company_claim' then 'company_claim' else 'analysis' end,
      coalesce(f.relevant_date::timestamptz, r.done_at)
    from public.analysis_findings f
    join runs r on r.id = f.run_id
    where f.fund_id = _fund_id

    union all
    -- Risks from finished runs
    select 'risk', 'risks', k.id, null,
      '[' || k.category::text || ' · ' || case k.level
          when 'low' then 'lav'
          when 'medium' then 'middel'
          when 'high' then 'høj'
          else 'kritisk' end || '] ' || btrim(k.statement)
        || coalesce(' Afværgelse: ' || nullif(btrim(k.mitigation), ''), ''),
      'analysis', r.done_at
    from public.risks k
    join runs r on r.id = k.run_id
    where k.fund_id = _fund_id

    union all
    -- One summary per finished run: score, recommendation, rationale, criteria
    select 'analysis_summary', 'analysis_runs', r.id,
      case r.kind when 'screening' then 'Screening' else 'Dyb analyse' end || ' '
        || to_char(r.done_at at time zone 'Europe/Copenhagen', 'YYYY-MM-DD'),
      concat_ws(E'\n',
        case r.kind when 'screening' then 'Screening' else 'Dyb analyse' end
          || coalesce(': samlet score ' || replace(round(rec.overall_score, 1)::text, '.', ','), '')
          || coalesce(', anbefaling ' || case rec.recommendation
              when 'go_forward' then 'gå videre'
              when 'follow' then 'følg udviklingen'
              when 'reject' then 'fravælg'
              when 'outside_thesis_interesting' then 'uden for tesen, men interessant' end, '')
          || '.',
        'Begrundelse: ' || nullif(btrim(rec.rationale), ''),
        (select string_agg(cs.category::text || ': '
            || coalesce(replace(round(coalesce(cs.validated_score, cs.proposed_score), 1)::text, '.', ','), '–')
            || coalesce(' (' || nullif(btrim(cs.rationale), '') || ')', ''),
            E'\n' order by cs.weight desc nulls last, cs.category::text)
         from public.category_scores cs
         where cs.run_id = r.id and cs.fund_id = _fund_id)),
      'analysis', r.done_at
    from runs r
    left join lateral (
      select x.overall_score, x.recommendation, x.rationale
      from public.recommendations x
      where x.run_id = r.id and x.fund_id = _fund_id
      order by x.created_at desc
      limit 1
    ) rec on true

    union all
    -- Notes: partner when the author is Medlem, Lead or Admin in this fund
    select 'case_note', 'case_notes', n.id, null, btrim(n.body),
      case when exists (
        select 1
        from public.fund_memberships m
        join public.fund_membership_roles mr on mr.membership_id = m.id
        where m.fund_id = _fund_id and m.user_id = n.author_id and m.status = 'active'
          and mr.role in ('member', 'lead', 'admin')
      ) then 'partner' else 'user_note' end,
      n.created_at
    from public.case_notes n
    where n.fund_id = _fund_id and n.case_id = _case_id

    union all
    -- Movements (not system), with reason labels and the written reason
    select 'decision', 'case_transition_events', e.id, null,
      concat_ws(' ',
        case e.movement_kind
          when 'advance' then 'Flyttet frem'
          when 'hold' then 'Sat på hold'
          when 'reject' then 'Kasseret'
          when 'decline_ic' then 'Afvist i komitéen'
          when 'invest' then 'Investeret'
          when 'reopen' then 'Genåbnet'
          else e.movement_kind end
          || coalesce(case when e.movement_kind = 'advance' then ' til ' else ' i ' end
            || case case when e.movement_kind = 'advance' then e.to_phase else e.from_phase end
                 when 'screening' then 'screening'
                 when 'deep_analysis' then 'dyb analyse'
                 when 'committee' then 'komité'
                 when 'decided' then 'besluttet' end, '')
          || ' ' || to_char(e.occurred_at at time zone 'Europe/Copenhagen', 'YYYY-MM-DD') || '.',
        'Årsager: ' || nullif((
          select string_agg(coalesce(rc.label, u.code), ', ' order by u.ord)
          from unnest(e.reason_codes) with ordinality as u(code, ord)
          left join public.brain_reason_codes rc on rc.fund_id = _fund_id and rc.code = u.code
        ), '') || '.',
        'Begrundelse: ' || nullif(btrim(coalesce(e.note, e.reason)), '')),
      'partner', e.occurred_at
    from public.case_transition_events e
    where e.fund_id = _fund_id and e.case_id = _case_id
      and e.movement_kind is not null and e.movement_kind <> 'system'
      -- 0060: neither an undo nor a move that was undone (same rule as brain_case_decisions).
      and e.undo_of is null
      and not exists (
        select 1 from public.case_transition_events u
        where u.undo_of = e.id and u.fund_id = e.fund_id
      )

    union all
    -- Document text, in parts of at most 4,000 characters
    select 'document_page', 'documents', d.id,
      left(d.file_name || case when p.n > 1 then ' (del ' || p.i || '/' || p.n || ')' else '' end, 300),
      p.part,
      case when d.kind = 'pitch_deck' then 'company_claim' else 'customer_doc' end,
      d.created_at
    from public.documents d
    cross join lateral (
      select u.part, u.i, count(*) over () as n
      from unnest(public.brain_split_text(d.extracted_text, 4000)) with ordinality as u(part, i)
    ) p
    where d.fund_id = _fund_id and d.case_id = _case_id
      and nullif(btrim(d.extracted_text), '') is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', x.kind, 'ref_table', x.ref_table, 'ref_id', x.ref_id, 'title', x.title,
      'content', x.content, 'trust_tier', x.trust_tier, 'occurred_at', x.occurred_at,
      'content_hash', x.content_hash)), '[]'::jsonb)
    into v_drafts
  from (
    select distinct on (d.ref_table, d.ref_id, h.content_hash)
      d.kind, d.ref_table, d.ref_id, d.title, h.content, d.trust_tier, d.occurred_at, h.content_hash
    from drafts d
    cross join lateral (select left(d.content, 8000) as content) c
    cross join lateral (
      select c.content, encode(sha256(convert_to(c.content, 'UTF8')), 'hex') as content_hash
    ) h
    where nullif(btrim(d.content), '') is not null
    order by d.ref_table, d.ref_id, h.content_hash
  ) x;

  -- Stale L0 episodes of this case: the raw row is gone or its text changed.
  delete from public.brain_episodes e
  where e.fund_id = _fund_id
    and e.case_id = _case_id
    and e.brain_source_id is null
    and e.kind in ('evidence', 'finding', 'risk', 'analysis_summary', 'case_note', 'decision',
      'document_page')
    and e.ref_table in ('evidence_items', 'analysis_findings', 'risks', 'analysis_runs',
      'case_notes', 'case_transition_events', 'documents')
    and not exists (
      select 1
      from jsonb_to_recordset(v_drafts) as d(ref_table text, ref_id uuid, content_hash text)
      where d.ref_table = e.ref_table and d.ref_id = e.ref_id and d.content_hash = e.content_hash
    );
  get diagnostics v_removed = row_count;

  with drafts as (
    select *
    from jsonb_to_recordset(v_drafts) as d(kind text, ref_table text, ref_id uuid, title text,
      content text, trust_tier text, occurred_at timestamptz, content_hash text)
  ),
  inserted as (
    insert into public.brain_episodes (fund_id, kind, ref_table, ref_id, case_id, company_id,
      trust_tier, occurred_at, title, content, content_hash)
    select _fund_id, d.kind, d.ref_table, d.ref_id, _case_id, v_company, d.trust_tier,
      d.occurred_at, d.title, d.content, d.content_hash
    from drafts d
    where not exists (
      select 1 from public.brain_episodes e
      where e.fund_id = _fund_id and e.ref_table = d.ref_table and e.ref_id = d.ref_id
        and e.brain_source_id is null and e.content_hash = d.content_hash
    )
    on conflict do nothing
    returning id, content
  ),
  chunked as (
    insert into public.brain_chunks (fund_id, episode_id, ordinal, content, token_count)
    select _fund_id, i.id, (p.ord - 1)::int, p.part, ceil(char_length(p.part) / 4.0)::int
    from inserted i
    cross join lateral unnest(public.brain_split_text(i.content, 4000)) with ordinality as p(part, ord)
    returning 1
  )
  select (select count(*) from inserted), (select count(*) from chunked)
    into v_added, v_chunks;

  select count(*) into v_pending
  from public.brain_chunks c
  join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
  where c.fund_id = _fund_id and e.case_id = _case_id and c.embedding is null;

  return jsonb_build_object(
    'episodes', jsonb_array_length(v_drafts),
    'added', v_added,
    'removed', v_removed,
    'chunks_added', v_chunks,
    'pending_chunks', v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Deterministic projection for one case (0042) without undone decisions or reopens.
-- ---------------------------------------------------------------------------
create or replace function public.brain_project_db_entities(_fund_id uuid, _case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case record;
  v_company record;
  v_company_entity uuid;
  v_case_entity uuid;
  v_entity uuid;
  v_person_entity uuid;
  v_company_key text;
  v_key text;
  v_name text;
  v_fact uuid;
  v_changed boolean;
  v_any_change boolean := false;
  v_touched uuid[] := '{}';
  v_entities int := 0;
  v_facts int := 0;
  v_expired int := 0;
  v_person record;
  v_decision record;
  v_code text;
  v_code_id uuid;
  v_label text;
  v_metric record;
  v_trust text;
  v_date_text text;
  v_movement_label text;
begin
  if _fund_id is null or _case_id is null then
    raise exception 'brain_project_db_entities: fund id and case id are required';
  end if;

  select c.id, c.company_id, c.created_at into v_case
  from public.cases c where c.id = _case_id and c.fund_id = _fund_id;
  if not found then
    raise exception 'brain_project_db_entities: case not found in this fund';
  end if;

  select co.* into v_company
  from public.companies co where co.id = v_case.company_id and co.fund_id = _fund_id;
  if not found then
    raise exception 'brain_project_db_entities: company not found in this fund';
  end if;

  -- Company: cvr: -> domain: -> name:
  v_company_key := case
    when v_company.cvr_number is not null then 'cvr:' || v_company.cvr_number
    when nullif(btrim(coalesce(v_company.domain, '')), '') is not null
      then 'domain:' || lower(btrim(v_company.domain))
    else 'name:' || coalesce(public.brain_normalize_name(v_company.name), v_company.id::text)
  end;
  v_company_entity := public.brain_upsert_ref_entity(
    _fund_id, 'company', v_company.name, v_company_key, 'companies', v_company.id);
  v_entities := v_entities + 1;

  -- Case entity + has_case
  v_case_entity := public.brain_upsert_ref_entity(
    _fund_id, 'case', v_company.name || ' (case)', 'case:' || _case_id::text, 'cases', _case_id);
  v_entities := v_entities + 1;
  select * into v_fact, v_changed from public.brain_upsert_db_fact(
    _fund_id, v_company_entity, 'has_case', v_case_entity, null, null, null,
    v_company.name || ' har en case i fonden.', v_case.created_at::date, null, 'partner');
  v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;

  -- Sector
  if v_company.sector_key is not null or nullif(btrim(coalesce(v_company.sector, '')), '') is not null then
    if v_company.sector_key is not null then
      v_key := 'sector:' || v_company.sector_key;
      select t.label_da into v_name from public.sector_taxonomy t where t.key = v_company.sector_key;
      v_name := coalesce(v_name, v_company.sector, v_company.sector_key);
    else
      v_key := 'sector:name:' || public.brain_normalize_name(v_company.sector);
      v_name := v_company.sector;
    end if;
    v_entity := public.brain_upsert_ref_entity(_fund_id, 'sector', v_name, v_key);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'in_sector', v_entity, null, null, null,
      v_company.name || ' er i sektoren ' || v_name || '.', null, null, 'partner');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end if;

  -- Geography: hq_country (ISO code) or the free-text geography
  if v_company.hq_country is not null or nullif(btrim(coalesce(v_company.geography, '')), '') is not null then
    if v_company.hq_country is not null then
      v_key := 'geography:' || v_company.hq_country;
      v_name := v_company.hq_country;
    else
      v_key := 'geography:name:' || public.brain_normalize_name(v_company.geography);
      v_name := v_company.geography;
    end if;
    v_entity := public.brain_upsert_ref_entity(_fund_id, 'geography', v_name, v_key);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'in_geography', v_entity, null, null, null,
      v_company.name || ' har hovedsæde i ' || v_name || '.', null, null, 'partner');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end if;

  -- Stage
  if v_company.stage is not null and v_company.stage::text <> 'unknown' then
    v_entity := public.brain_upsert_ref_entity(
      _fund_id, 'stage', v_company.stage::text, 'stage:' || v_company.stage::text);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'at_stage', v_entity, null, null, null,
      v_company.name || ' er på stadiet ' || v_company.stage::text || '.', null, null, 'partner');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end if;

  -- People: founded_by (company -> person), works_at / previously_at (person -> company),
  -- has_role (person -> company, value_text = role). Trust follows the verification.
  for v_person in
    select p.id, p.full_name, cp.role_title, cp.is_founder, cp.is_current, cp.verification_status
    from public.company_people cp
    join public.people p on p.id = cp.person_id and p.fund_id = cp.fund_id
    where cp.company_id = v_company.id and cp.fund_id = _fund_id
    order by p.id
  loop
    v_key := 'name:' || coalesce(public.brain_normalize_name(v_person.full_name), v_person.id::text)
             || '@' || v_company_key;
    v_person_entity := public.brain_upsert_ref_entity(
      _fund_id, 'person', v_person.full_name, v_key, 'people', v_person.id);
    v_entities := v_entities + 1;
    v_trust := case v_person.verification_status
      when 'verified' then 'official'
      when 'partial' then 'third_party'
      else 'company_claim' end;
    if v_person.is_founder then
      select * into v_fact, v_changed from public.brain_upsert_db_fact(
        _fund_id, v_company_entity, 'founded_by', v_person_entity, null, null, null,
        v_company.name || ' er grundlagt af ' || v_person.full_name || '.', null, null, v_trust);
      v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    end if;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_person_entity,
      case when v_person.is_current then 'works_at' else 'previously_at' end,
      v_company_entity, null, null, null,
      v_person.full_name || case when v_person.is_current then ' arbejder i ' else ' har arbejdet i ' end
        || v_company.name || '.',
      null, null, v_trust);
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    if nullif(btrim(coalesce(v_person.role_title, '')), '') is not null then
      select * into v_fact, v_changed from public.brain_upsert_db_fact(
        _fund_id, v_person_entity, 'has_role', v_company_entity, left(btrim(v_person.role_title), 200),
        null, null,
        v_person.full_name || ' er ' || btrim(v_person.role_title) || ' i ' || v_company.name || '.',
        null, null, v_trust);
      v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    end if;
  end loop;

  -- Final decisions (reject / decline_ic / invest). A later reopen closes the fact
  -- (valid_to) instead of removing it: the history stays. 0060: an undone decision gives no
  -- fact (the expiry below removes an earlier one), and an undone reopen closes nothing.
  for v_decision in
    select ev.id, ev.movement_kind, ev.reason_codes, ev.occurred_at,
      (select min(r.occurred_at) from public.case_transition_events r
        where r.case_id = ev.case_id and r.fund_id = ev.fund_id
          and r.movement_kind = 'reopen' and r.occurred_at > ev.occurred_at
          and r.undo_of is null
          and not exists (
            select 1 from public.case_transition_events ru
            where ru.undo_of = r.id and ru.fund_id = r.fund_id
          )) as reopened_at
    from public.case_transition_events ev
    where ev.case_id = _case_id and ev.fund_id = _fund_id
      and ev.movement_kind in ('reject','decline_ic','invest')
      and ev.undo_of is null
      and not exists (
        select 1 from public.case_transition_events u
        where u.undo_of = ev.id and u.fund_id = ev.fund_id
      )
    order by ev.occurred_at, ev.id
  loop
    v_movement_label := case v_decision.movement_kind
      when 'reject' then 'Kasseret'
      when 'decline_ic' then 'Afvist i komitéen'
      else 'Investeret' end;
    v_date_text := to_char(v_decision.occurred_at at time zone 'UTC', 'YYYY-MM-DD');
    if coalesce(cardinality(v_decision.reason_codes), 0) = 0 then
      select * into v_fact, v_changed from public.brain_upsert_db_fact(
        _fund_id, v_case_entity, 'decided', null, v_decision.movement_kind, null, null,
        v_movement_label || ' ' || v_date_text || ' (' || v_company.name || ').',
        v_decision.occurred_at::date, v_decision.reopened_at::date, 'partner');
      v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    else
      foreach v_code in array v_decision.reason_codes loop
        v_code_id := null;
        v_label := null;
        select rc.id, rc.label into v_code_id, v_label
        from public.brain_reason_codes rc
        where rc.fund_id = _fund_id and rc.code = v_code;
        v_entity := public.brain_upsert_ref_entity(
          _fund_id, 'reason', coalesce(v_label, v_code), 'reason:' || v_code,
          case when v_code_id is null then null else 'brain_reason_codes' end, v_code_id);
        v_entities := v_entities + 1;
        select * into v_fact, v_changed from public.brain_upsert_db_fact(
          _fund_id, v_case_entity, 'decided', v_entity, v_decision.movement_kind, null, null,
          v_movement_label || ' ' || v_date_text || ' (' || v_company.name || '). Årsag: '
            || coalesce(v_label, v_code) || '.',
          v_decision.occurred_at::date, v_decision.reopened_at::date, 'partner');
        v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
      end loop;
    end if;
  end loop;

  -- Key metrics from the official annual reports (newest fetch per metric and period).
  for v_metric in
    select distinct on (li.metric, fs.period_start, fs.period_end)
      li.metric, li.value, coalesce(nullif(li.unit, ''), fs.currency) as unit,
      fs.period_start, fs.period_end
    from public.financial_statement_line_items li
    join public.financial_statements fs on fs.id = li.statement_id
    where fs.case_id = _case_id and fs.fund_id = _fund_id
      and li.value is not null
      and li.metric in ('revenue','gross_profit','operating_result','result_before_tax',
        'net_result','equity','cash','assets','liabilities','average_employees')
    order by li.metric, fs.period_start, fs.period_end, fs.fetched_at desc, li.id
  loop
    v_entity := public.brain_upsert_ref_entity(
      _fund_id, 'metric', v_metric.metric, 'metric:' || v_metric.metric);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'metric', v_entity, v_metric.metric, v_metric.value,
      left(v_metric.unit, 40),
      v_company.name || ': ' || v_metric.metric || ' = ' || v_metric.value::text || ' '
        || coalesce(v_metric.unit, '') || ' (' || v_metric.period_start::text || ' til '
        || v_metric.period_end::text || ').',
      v_metric.period_start, v_metric.period_end, 'official');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end loop;

  -- Expire projected facts in this case's scope that raw data no longer supports.
  update public.brain_facts f
     set expired_at = now()
   where f.fund_id = _fund_id
     and f.origin = 'db'
     and f.expired_at is null
     and not (f.id = any(array_remove(v_touched, null)))
     and (
       (f.subject_id = v_company_entity
          and f.predicate in ('in_sector','in_geography','at_stage','founded_by','metric'))
       or (f.subject_id = v_company_entity and f.predicate = 'has_case' and f.object_id = v_case_entity)
       or (f.object_id = v_company_entity
          and f.predicate in ('works_at','previously_at','has_role'))
       or (f.subject_id = v_case_entity and f.predicate in ('decided','because_of'))
     );
  get diagnostics v_expired = row_count;

  if v_any_change or v_expired > 0 then
    update public.brain_entities e
       set dirty_at = now()
     where e.id in (v_company_entity, v_case_entity);
  end if;

  return jsonb_build_object(
    'company_entity_id', v_company_entity,
    'case_entity_id', v_case_entity,
    'entities', v_entities,
    'facts', v_facts,
    'expired', v_expired,
    'changed', v_any_change or v_expired > 0
  );
end;
$$;

revoke all on function public.brain_capture_case(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_project_db_entities(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_capture_case(uuid, uuid) to service_role;
grant execute on function public.brain_project_db_entities(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Existing Brain data: remove what undone moves left behind.
-- ---------------------------------------------------------------------------
-- Only cases Brain has already read (an L0 episode or the projected case entity): a case Brain
-- has never seen gets nothing new here; L0 and the projection read it with the new rules later.
do $$
declare
  v_case record;
begin
  for v_case in
    select distinct u.fund_id, u.case_id
    from public.case_transition_events u
    join public.cases c on c.id = u.case_id and c.fund_id = u.fund_id
    where u.undo_of is not null
      and (
        exists (
          select 1 from public.brain_episodes e
          where e.fund_id = u.fund_id and e.case_id = u.case_id and e.brain_source_id is null
        )
        or exists (
          select 1 from public.brain_entities be
          where be.fund_id = u.fund_id and be.ref_table = 'cases' and be.ref_id = u.case_id
        )
      )
    order by u.fund_id, u.case_id
  loop
    -- Same lock order and key as brain_capture_case (fund, case, then the case's lock), so the
    -- clean-up waits for an L0 run that is busy with the case instead of racing it.
    perform 1 from public.funds f where f.id = v_case.fund_id for key share;
    perform 1 from public.cases c where c.id = v_case.case_id and c.fund_id = v_case.fund_id
      for key share;
    if not found then
      continue; -- deleted meanwhile: its episodes and facts went with it
    end if;
    perform pg_advisory_xact_lock(hashtextextended('brain_capture:' || v_case.case_id::text, 0));

    -- The episodes of undone moves (chunks and fact links follow by cascade).
    delete from public.brain_episodes e
    where e.fund_id = v_case.fund_id
      and e.case_id = v_case.case_id
      and e.brain_source_id is null
      and e.ref_table = 'case_transition_events'
      and e.ref_id in (
        select u.undo_of
        from public.case_transition_events u
        where u.fund_id = v_case.fund_id and u.case_id = v_case.case_id and u.undo_of is not null
      );

    -- The projection with the new rule expires facts of undone decisions and reopens closed
    -- facts again. An error stops the whole migration (it rolls back and can be run again).
    perform public.brain_project_db_entities(v_case.fund_id, v_case.case_id);

    insert into public.brain_capture_queue as q (fund_id, case_id, changed_at)
    values (v_case.fund_id, v_case.case_id, now())
    on conflict (fund_id, case_id) do update set changed_at = excluded.changed_at;
  end loop;
end;
$$;

commit;
