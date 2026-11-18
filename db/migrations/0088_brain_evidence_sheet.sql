-- 0088 · Bevisarket i Brain.
--
-- Screeningen og den dybe analyse samler nu researchen til et kort, kildebelagt bevisark pr.
-- kriterie og gate (src/lib/analysis/evidence-sheet.ts). Arket gemmes på kørslen: screeningen på
-- sit researchtrin (screening_research), den dybe analyse på sit eget trin (evidence_sheet), som
-- output_json.evidenceSheet med teksten til Brain i brainText (fondens sprog, højst 8.000 tegn).
--
-- brain_capture_case (L0, senest 0060) får én ny kilde: arket fra en færdig kørsel bliver én
-- episode af slagsen 'analysis_summary' med ref_table 'analysis_run_steps' (trinnets id), så
-- Brains søgning, chat og kildepanel kan finde det. Et ark, der ændres eller forsvinder, ryddes
-- op som de andre L0-episoder (ref_table er føjet til oprydningens liste). Resten af funktionen
-- er uændret fra 0060.
--
-- Samme signatur og rettigheder: additiv og bagudkompatibel (preview og produktion deler
-- databasen; koden virker med både 0060 og 0088, og ældre kørsler har intet ark). Migrationen
-- bruger ingen sprogmodel og rører ingen data: arkene kommer med, næste gang casen indfanges.

begin;

set local lock_timeout = '5s';

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

    union all
    -- 0088 (T-726): the evidence sheet of a finished run, one episode per run. The screening
    -- keeps it on its research step, the deep analysis on its own step; the text is written in
    -- the fund's language when the sheet is made (at most 8,000 characters).
    select 'analysis_summary', 'analysis_run_steps', st.id,
      case r.kind when 'screening' then 'Bevisark, screening' else 'Bevisark, dyb analyse' end
        || ' ' || to_char(r.done_at at time zone 'Europe/Copenhagen', 'YYYY-MM-DD'),
      btrim(st.output_json -> 'evidenceSheet' ->> 'brainText'),
      'analysis', r.done_at
    from public.analysis_run_steps st
    join runs r on r.id = st.run_id
    where st.fund_id = _fund_id
      and st.step_key in ('screening_research', 'evidence_sheet')
      and st.status = 'complete'
      and st.output_json -> 'evidenceSheet' ->> 'version' = 'interlect-evidence-sheet-v1'
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
      'case_notes', 'case_transition_events', 'documents', 'analysis_run_steps')
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

revoke all on function public.brain_capture_case(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_capture_case(uuid, uuid) to service_role;

commit;
