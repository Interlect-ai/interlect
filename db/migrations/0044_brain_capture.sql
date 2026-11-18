-- Brain (track C) · migration 0044 · (L0 capture)
-- brain_split_text, brain_capture_case (raw case rows -> episodes + chunks, anti-join on
-- ref_table/ref_id/content_hash), brain_case_pending_chunks (chunks still without a vector)
-- and brain_case_profile_text (the text behind the case's profile vector).
-- Spec: §4, §5 and L0.
--
-- Numbering: the plan reserved 0044 for historical decisions; they move to 0045 and the rest
-- of track C shifts by one (allows it).
--
-- Instance-ready (no hard-coded ids; runs in order on a fresh or the current database).
-- Additive only: four new functions, no table, column, policy or grant on existing objects
-- changes. No language model and no cost in SQL; embeddings are written by the L0 loop.
-- All functions are security definer with search_path = '' and only executable by
-- service_role.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Splits text into pieces of at most _max characters, preferring a paragraph break, then a
--    line break, then a space in the second half of each window. Empty text gives no pieces.
-- ---------------------------------------------------------------------------
create or replace function public.brain_split_text(_text text, _max int default 4000)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_max int := greatest(coalesce(_max, 4000), 200);
  v_rest text := btrim(coalesce(_text, ''), E' \n\r\t');
  v_window text;
  v_cut int;
  v_out text[] := '{}';
begin
  while char_length(v_rest) > v_max loop
    v_window := left(v_rest, v_max);
    v_cut := coalesce(char_length(substring(v_window from '^(.*)\n\n')), 0);
    if v_cut < v_max / 2 then
      v_cut := coalesce(char_length(substring(v_window from '^(.*)\n')), 0);
    end if;
    if v_cut < v_max / 2 then
      v_cut := coalesce(char_length(substring(v_window from '^(.*) ')), 0);
    end if;
    if v_cut < v_max / 2 then
      v_cut := v_max;
    end if;
    v_out := v_out || btrim(left(v_rest, v_cut), E' \n\r\t');
    v_rest := btrim(substr(v_rest, v_cut + 1), E' \n\r\t');
  end loop;
  if v_rest <> '' then
    v_out := v_out || v_rest;
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. L0 for one case (§5 steps 1-2). Builds a text snapshot per raw row, deletes the
--    case's L0 episodes that no longer match raw data (chunks and fact links follow by
--    cascade; facts that lose their last source expire), and inserts the new ones with at
--    least one chunk each. A rerun without changes adds and removes nothing. Serialised per
--    case, so two L0 jobs for the same case cannot interleave.
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
-- 3. The case's chunks that still have no vector (the loop embeds them in one batch).
-- ---------------------------------------------------------------------------
create or replace function public.brain_case_pending_chunks(
  _fund_id uuid,
  _case_id uuid,
  _limit int default 200
)
returns table (chunk_id uuid, content text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.content
  from public.brain_chunks c
  join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
  where c.fund_id = _fund_id and e.case_id = _case_id and c.embedding is null
  order by e.recorded_at, c.episode_id, c.ordinal
  limit least(greatest(coalesce(_limit, 200), 1), 500)
$$;

-- ---------------------------------------------------------------------------
-- 4. The text behind the case's profile vector. Null until an analysis is finished.
-- ---------------------------------------------------------------------------
create or replace function public.brain_case_profile_text(_fund_id uuid, _case_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company record;
  v_screening text;
  v_deep text;
  v_run uuid;
  v_strengths text;
  v_risks text;
begin
  select co.name, coalesce(t.label_da, co.sector) as sector, co.stage::text as stage,
    coalesce(co.hq_country, co.geography) as geography
    into v_company
  from public.cases c
  join public.companies co on co.id = c.company_id and co.fund_id = c.fund_id
  left join public.sector_taxonomy t on t.key = co.sector_key
  where c.id = _case_id and c.fund_id = _fund_id;
  if not found then
    return null;
  end if;

  select nullif(btrim(x.rationale), '') into v_screening
  from public.analysis_runs r
  join public.recommendations x on x.run_id = r.id and x.fund_id = r.fund_id
  where r.fund_id = _fund_id and r.case_id = _case_id and r.kind = 'screening'
    and r.status in ('complete', 'awaiting_approval')
  order by coalesce(r.completed_at, r.created_at) desc, x.created_at desc
  limit 1;

  select left(nullif(btrim(x.rationale), ''), 1500) into v_deep
  from public.analysis_runs r
  join public.recommendations x on x.run_id = r.id and x.fund_id = r.fund_id
  where r.fund_id = _fund_id and r.case_id = _case_id and r.kind = 'deep'
    and r.status = 'complete'
  order by coalesce(r.completed_at, r.created_at) desc, x.created_at desc
  limit 1;

  if v_screening is null and v_deep is null then
    return null;
  end if;

  -- Strengths and risks from the newest finished run (deep before screening).
  select r.id into v_run
  from public.analysis_runs r
  where r.fund_id = _fund_id and r.case_id = _case_id
    and r.status in ('complete', 'awaiting_approval')
  order by (r.kind = 'deep') desc, coalesce(r.completed_at, r.created_at) desc
  limit 1;

  select string_agg(s.statement, '; ') into v_strengths
  from (
    select btrim(f.statement) as statement
    from public.analysis_findings f
    where f.run_id = v_run and f.fund_id = _fund_id and f.finding_type = 'strength'
    order by f.confidence desc nulls last, f.created_at, f.id
    limit 3
  ) s;

  select string_agg(k.statement, '; ') into v_risks
  from (
    select btrim(k.statement) as statement
    from public.risks k
    where k.run_id = v_run and k.fund_id = _fund_id
    order by array_position(array['critical', 'high', 'medium', 'low'], k.level::text), k.created_at, k.id
    limit 3
  ) k;

  return concat_ws(E'\n',
    'Case: ' || v_company.name
      || ' · Sektor: ' || coalesce(v_company.sector, 'ukendt')
      || ' · Stadie: ' || coalesce(v_company.stage, 'ukendt')
      || ' · Geografi: ' || coalesce(v_company.geography, 'ukendt'),
    'Tese-fit: ' || v_screening,
    'Syntese: ' || v_deep,
    'Styrker: ' || v_strengths,
    'Risici: ' || v_risks);
end;
$$;

revoke all on function public.brain_split_text(text, int) from public, anon, authenticated;
revoke all on function public.brain_capture_case(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_case_pending_chunks(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.brain_case_profile_text(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_split_text(text, int) to service_role;
grant execute on function public.brain_capture_case(uuid, uuid) to service_role;
grant execute on function public.brain_case_pending_chunks(uuid, uuid, int) to service_role;
grant execute on function public.brain_case_profile_text(uuid, uuid) to service_role;

commit;
