-- 0064 · Brain-sider: hvilke sider findes, deres data og gem (06 L4 trin 5).
--
-- L4 trin 5 holder siderne levende. SQL afgør, hvilke sider der skal findes, samler de data, de
-- beregnede sektioner tegnes af, og gemmer en side; teksten tegnes i TypeScript
-- (src/lib/brain/pages.ts), og side-skriveren (page_writer) skriver de skrevne sektioner.
--
--   brain_page_targets   entiteter, hvis side mangler eller er forældet (entiteten er beskidt, eller
--                        for en case- eller sektorside: et tilknyttet selskab er beskidt), med
--                        "writer" for sider, side-skriveren må skrive (case og selskab for en aktiv
--                        eller nyligt åbnet case); højst 60 af dem først, så de andre ikke sulter
--   brain_page_data      data til de beregnede sektioner (fakta, cases, beslutninger, analyser, tesen,
--                        tal) for én side
--   brain_save_page      opretter eller opdaterer siden (søgetekst, ændringsnote, input-hash) og
--                        rydder entitetens dirty_at, hvis den ikke er ændret siden læsningen; en side,
--                        hvis skriver måtte vente, mærkes beskidt til næste nat
--
-- brain_pages.input_hash (ny kolonne): hash af side-skriverens input; samme hash betyder intet nyt
-- for skriveren, så det betalte kald springes over (06 L4).
--
-- Hvilke sider: selskab med en case, en historisk beslutning eller en kundekilde; person
-- med mindst 2 fakta; sektor, marked og tema med mindst 3 cases; casen selv for en aktiv eller
-- nyligt åbnet case (status 'active', eller en handling de sidste 30 dage); tesen og
-- fondsoversigten altid. En låst sektion beskyttes af triggeren fra 0062.
--
-- Tre nye funktioner, kun for service_role, og én ny nullable kolonne; ingen policy eller
-- rettighed ændres.

begin;

set local lock_timeout = '5s';

alter table public.brain_pages
  add column if not exists input_hash text
    check (input_hash is null or char_length(input_hash) between 8 and 128);

-- ---------------------------------------------------------------------------
-- 1. Which entity pages to refresh tonight.
-- ---------------------------------------------------------------------------
create or replace function public.brain_page_targets(
  _fund_id uuid,
  _limit int default 200,
  _writer_limit int default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if _fund_id is null then
    raise exception 'brain_page_targets: fund id is required';
  end if;

  with open_cases as (
    select c.id, c.company_id
    from public.cases c
    where c.fund_id = _fund_id
      and (c.status = 'active' or c.last_action_at > now() - interval '30 days')
  ),
  writer_entities as (
    select e.id
    from public.brain_entities e
    join open_cases oc on e.ref_table = 'cases' and e.ref_id = oc.id
    where e.fund_id = _fund_id and e.status = 'active'
    union
    select e.id
    from public.brain_entities e
    join open_cases oc on e.ref_table = 'companies' and e.ref_id = oc.company_id
    where e.fund_id = _fund_id and e.status = 'active'
  ),
  eligible as (
    select e.id, e.type, e.name, e.dirty_at
    from public.brain_entities e
    where e.fund_id = _fund_id and e.status = 'active'
      and (
        (e.type = 'company' and (
            exists (select 1 from public.brain_facts f
                    where f.fund_id = _fund_id and f.subject_id = e.id and f.predicate = 'has_case'
                      and f.expired_at is null)
            or exists (select 1 from public.brain_historical_decisions h
                       where h.fund_id = _fund_id and h.company_entity_id = e.id)
            or exists (select 1 from public.brain_sources s
                       where s.fund_id = _fund_id and s.company_entity_id = e.id)))
        or (e.type = 'person' and (
            select count(*) from public.brain_facts f
            where f.fund_id = _fund_id and (f.subject_id = e.id or f.object_id = e.id)
              and f.status = 'active' and f.expired_at is null) >= 2)
        or (e.type = 'case' and exists (select 1 from writer_entities w where w.id = e.id))
        or (e.type in ('sector', 'market', 'theme') and (
            select count(distinct hc.object_id)
            from public.brain_facts l
            join public.brain_facts hc
              on hc.fund_id = _fund_id and hc.subject_id = l.subject_id
             and hc.predicate = 'has_case' and hc.expired_at is null
            where l.fund_id = _fund_id and l.object_id = e.id
              and l.predicate in ('in_sector', 'operates_in_market', 'part_of_theme')
              and l.status = 'active' and l.expired_at is null) >= 3)
      )
  ),
  candidates as (
    select el.id, el.type, el.name, el.dirty_at,
      (el.type in ('case', 'company')
       and exists (select 1 from writer_entities w where w.id = el.id)) as writer,
      p.id as page_id
    from eligible el
    left join public.brain_pages p
      on p.fund_id = _fund_id and p.entity_id = el.id and p.kind = el.type
    where p.id is null
       or el.dirty_at is not null
       -- A case page shows its company: a dirty company makes it stale.
       or (el.type = 'case' and exists (
             select 1
             from public.brain_facts hc
             join public.brain_entities co on co.id = hc.subject_id and co.fund_id = _fund_id
             where hc.fund_id = _fund_id and hc.object_id = el.id and hc.predicate = 'has_case'
               and hc.expired_at is null and co.dirty_at is not null))
       -- A sector, market or theme page lists its companies and their cases.
       or (el.type in ('sector', 'market', 'theme') and exists (
             select 1
             from public.brain_facts l
             join public.brain_entities co on co.id = l.subject_id and co.fund_id = _fund_id
             where l.fund_id = _fund_id and l.object_id = el.id
               and l.predicate in ('in_sector', 'operates_in_market', 'part_of_theme')
               and l.expired_at is null and co.dirty_at is not null))
  ),
  ranked as (
    select c.*,
      row_number() over (partition by c.writer
                         order by (c.page_id is null) desc, c.dirty_at nulls first, c.id) as rank
    from candidates c
  ),
  picked as (
    select r.*,
      -- The writer's pages first, at most _writer_limit of them; then the others.
      (r.writer and r.rank <= greatest(coalesce(_writer_limit, 60), 0)) as first_in_line
    from ranked r
    order by 8 desc, (r.page_id is null) desc, r.dirty_at nulls first, r.id
    limit greatest(coalesce(_limit, 200), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'entityId', pk.id, 'kind', pk.type, 'title', pk.name, 'dirtyAt', pk.dirty_at,
      'writer', pk.writer, 'pageId', pk.page_id)
      order by pk.first_in_line desc, (pk.page_id is null) desc, pk.dirty_at nulls first, pk.id),
      '[]'::jsonb)
    into v_out
  from picked pk;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The data behind one page's computed sections. _entity_id is null for 'thesis' and
--    'fund_overview'. Facts: the active facts about the entity (for a case also its company), the
--    newest 120.
-- ---------------------------------------------------------------------------
create or replace function public.brain_page_data(_fund_id uuid, _kind text, _entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entity public.brain_entities%rowtype;
  v_ids uuid[];
  v_case_id uuid;
  v_out jsonb := '{}'::jsonb;
begin
  if _fund_id is null or _kind is null then
    raise exception 'brain_page_data: fund and kind are required';
  end if;

  if _kind in ('thesis', 'fund_overview') then
    if _kind = 'thesis' then
      v_out := jsonb_build_object(
        'config', (
          select jsonb_build_object('version', v.version, 'thesis', m.thesis, 'sectors', m.sectors,
                                    'stages', m.stages, 'geographies', m.geographies,
                                    'riskPosture', m.risk_posture)
          from public.fund_config_versions v
          join public.fund_mandates m on m.config_version_id = v.id
          where v.fund_id = _fund_id and v.status = 'active'
          order by v.version desc limit 1),
        'decisions', (
          select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'total', d.total,
                                                       'lastYear', d.last_year) order by d.kind),
                          '[]'::jsonb)
          from (
            select bd.decision_kind as kind, count(*) as total,
              count(*) filter (where bd.decided_at > now() - interval '365 days') as last_year
            from public.brain_case_decisions bd
            where bd.fund_id = _fund_id
            group by bd.decision_kind) d),
        'lessons', (
          select coalesce(jsonb_agg(jsonb_build_object('shortId', b.short_id, 'section', b.section,
                                                       'text', b.text) order by b.section, b.short_id),
                          '[]'::jsonb)
          from public.brain_playbook_bullets b
          where b.fund_id = _fund_id and b.status = 'active'));
    else
      v_out := jsonb_build_object('stats', jsonb_build_object(
        'episodes', (select count(*) from public.brain_episodes e where e.fund_id = _fund_id),
        'facts', (select count(*) from public.brain_facts f
                  where f.fund_id = _fund_id and f.status = 'active' and f.expired_at is null),
        'companies', (select count(*) from public.brain_entities e
                      where e.fund_id = _fund_id and e.status = 'active' and e.type = 'company'),
        'people', (select count(*) from public.brain_entities e
                   where e.fund_id = _fund_id and e.status = 'active' and e.type = 'person'),
        'cases', (select count(*) from public.cases c where c.fund_id = _fund_id),
        'decisions', (select count(*) from public.brain_case_decisions d where d.fund_id = _fund_id),
        'pages', (select count(*) from public.brain_pages p where p.fund_id = _fund_id),
        'lessons', (select count(*) from public.brain_playbook_bullets b
                    where b.fund_id = _fund_id and b.status = 'active'),
        'openInsights', (select count(*) from public.brain_insights i
                         where i.fund_id = _fund_id and i.status = 'new'
                           and i.kind not in ('budget_reached', 'eval_regression', 'job_failed'))));
    end if;
    return v_out;
  end if;

  select * into v_entity from public.brain_entities e
  where e.id = _entity_id and e.fund_id = _fund_id and e.status = 'active';
  if not found then
    return null;
  end if;
  v_ids := array[v_entity.id];
  if _kind = 'case' then
    v_case_id := case when v_entity.ref_table = 'cases' then v_entity.ref_id end;
    v_ids := v_ids || coalesce((
      select array_agg(f.subject_id) from public.brain_facts f
      where f.fund_id = _fund_id and f.object_id = v_entity.id and f.predicate = 'has_case'
        and f.expired_at is null), '{}');
  end if;

  v_out := jsonb_build_object(
    'entity', jsonb_build_object('id', v_entity.id, 'type', v_entity.type, 'name', v_entity.name,
                                 'aliases', to_jsonb(v_entity.aliases)),
    'facts', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'predicate', x.predicate, 'statement', x.statement,
          'subjectId', x.subject_id, 'subjectName', x.subject_name,
          'objectId', x.object_id, 'objectName', x.object_name,
          'valueText', x.value_text, 'valueNum', x.value_num, 'unit', x.unit,
          'validFrom', x.valid_from, 'validTo', x.valid_to, 'trust', x.trust_tier,
          'recordedAt', x.recorded_at) order by x.recorded_at desc, x.id), '[]'::jsonb)
      from (
        select f.id, f.predicate, f.statement, f.subject_id, s.name as subject_name, f.object_id,
          o.name as object_name, f.value_text, f.value_num, f.unit, f.valid_from, f.valid_to,
          f.trust_tier, f.recorded_at
        from public.brain_facts f
        join public.brain_entities s on s.id = f.subject_id and s.fund_id = _fund_id
        left join public.brain_entities o on o.id = f.object_id and o.fund_id = _fund_id
        where f.fund_id = _fund_id and (f.subject_id = any(v_ids) or f.object_id = any(v_ids))
          and f.status = 'active' and f.expired_at is null
        order by f.recorded_at desc, f.id
        limit 120) x));

  if _kind = 'company' then
    v_out := v_out || jsonb_build_object(
      'cases', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'caseId', c.id, 'createdAt', c.created_at, 'phase', c.phase, 'status', c.status,
            'stage', c.process_stage, 'decision', d.decision_kind, 'decidedAt', d.decided_at,
            'reasons', d.reasons, 'note', n.body, 'noteAt', n.created_at)
            order by c.created_at), '[]'::jsonb)
        from public.brain_facts hc
        join public.brain_entities ce
          on ce.id = hc.object_id and ce.fund_id = _fund_id and ce.ref_table = 'cases'
        join public.cases c on c.id = ce.ref_id and c.fund_id = _fund_id
        left join lateral (
          select bd.decision_kind, bd.decided_at,
            (select coalesce(array_agg(coalesce(rc.label, u.code) order by u.ord), '{}')
             from unnest(bd.reason_codes) with ordinality as u(code, ord)
             left join public.brain_reason_codes rc on rc.fund_id = _fund_id and rc.code = u.code)
              as reasons
          from public.brain_case_decisions bd
          where bd.fund_id = _fund_id and bd.case_id = c.id
          limit 1) d on true
        left join lateral (
          select left(btrim(cn.body), 200) as body, cn.created_at
          from public.case_notes cn
          where cn.fund_id = _fund_id and cn.case_id = c.id and nullif(btrim(cn.body), '') is not null
          order by cn.created_at desc limit 1) n on true
        where hc.fund_id = _fund_id and hc.subject_id = v_entity.id and hc.predicate = 'has_case'
          and hc.expired_at is null),
      'historical', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'decidedOn', h.decided_on, 'kind', h.movement_kind,
            'reasons', (select coalesce(array_agg(coalesce(rc.label, u.code) order by u.ord), '{}')
                        from unnest(h.reason_codes) with ordinality as u(code, ord)
                        left join public.brain_reason_codes rc
                          on rc.fund_id = _fund_id and rc.code = u.code),
            'note', left(h.reason_text, 200)) order by h.decided_on nulls first), '[]'::jsonb)
        from public.brain_historical_decisions h
        where h.fund_id = _fund_id and h.company_entity_id = v_entity.id),
      'contradictions', (
        select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title,
                                                     'createdAt', i.created_at)
                                  order by i.created_at desc), '[]'::jsonb)
        from public.brain_insights i
        where i.fund_id = _fund_id and i.kind = 'contradiction' and i.status in ('new', 'seen')
          and exists (
            select 1
            from jsonb_array_elements(i.refs) r
            join public.brain_facts f on f.fund_id = _fund_id and f.id::text = r ->> 'id'
            where r ->> 'kind' = 'fact'
              and (f.subject_id = v_entity.id or f.object_id = v_entity.id))));
  elsif _kind = 'case' and v_case_id is not null then
    v_out := v_out || jsonb_build_object(
      'case', (
        select jsonb_build_object('id', c.id, 'createdAt', c.created_at, 'phase', c.phase,
                                  'status', c.status, 'stage', c.process_stage,
                                  'workspace', c.workspace_status)
        from public.cases c where c.id = v_case_id and c.fund_id = _fund_id),
      'moves', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'at', ev.occurred_at, 'kind', ev.movement_kind, 'fromPhase', ev.from_phase,
            'toPhase', ev.to_phase,
            'reasons', (select coalesce(array_agg(coalesce(rc.label, u.code) order by u.ord), '{}')
                        from unnest(ev.reason_codes) with ordinality as u(code, ord)
                        left join public.brain_reason_codes rc
                          on rc.fund_id = _fund_id and rc.code = u.code),
            'note', left(btrim(coalesce(ev.note, ev.reason)), 200)) order by ev.occurred_at),
          '[]'::jsonb)
        from public.case_transition_events ev
        where ev.fund_id = _fund_id and ev.case_id = v_case_id
          and ev.movement_kind is not null and ev.movement_kind <> 'system'
          and ev.undo_of is null
          and not exists (select 1 from public.case_transition_events u
                          where u.undo_of = ev.id and u.fund_id = ev.fund_id)),
      'analyses', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'kind', a.kind, 'at', a.done_at, 'score', a.overall_score,
            'recommendation', a.recommendation) order by a.kind), '[]'::jsonb)
        from (
          select distinct on (r.kind) r.kind::text as kind,
            coalesce(r.completed_at, r.created_at) as done_at, rec.overall_score, rec.recommendation
          from public.analysis_runs r
          left join lateral (
            select x.overall_score, x.recommendation::text as recommendation
            from public.recommendations x
            where x.run_id = r.id and x.fund_id = _fund_id
            order by x.created_at desc limit 1) rec on true
          where r.fund_id = _fund_id and r.case_id = v_case_id
            and r.status in ('complete', 'awaiting_approval')
          order by r.kind, coalesce(r.completed_at, r.created_at) desc) a));
  elsif _kind in ('sector', 'market', 'theme') then
    v_out := v_out || jsonb_build_object(
      'cases', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'company', co.name, 'companyId', co.id, 'caseId', c.id, 'createdAt', c.created_at,
            'decision', d.decision_kind, 'decidedAt', d.decided_at)
            order by c.created_at desc), '[]'::jsonb)
        from public.brain_facts l
        join public.brain_entities co on co.id = l.subject_id and co.fund_id = _fund_id
        join public.brain_facts hc
          on hc.fund_id = _fund_id and hc.subject_id = co.id and hc.predicate = 'has_case'
         and hc.expired_at is null
        join public.brain_entities ce
          on ce.id = hc.object_id and ce.fund_id = _fund_id and ce.ref_table = 'cases'
        join public.cases c on c.id = ce.ref_id and c.fund_id = _fund_id
        left join public.brain_case_decisions d on d.fund_id = _fund_id and d.case_id = c.id
        where l.fund_id = _fund_id and l.object_id = v_entity.id
          and l.predicate in ('in_sector', 'operates_in_market', 'part_of_theme')
          and l.status = 'active' and l.expired_at is null),
      'players', (
        select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name),
                        '[]'::jsonb)
        from (
          select distinct co.id, co.name
          from public.brain_facts l
          join public.brain_entities co on co.id = l.subject_id and co.fund_id = _fund_id
          where l.fund_id = _fund_id and l.object_id = v_entity.id
            and l.predicate in ('in_sector', 'operates_in_market', 'part_of_theme')
            and l.status = 'active' and l.expired_at is null and co.status = 'active'
          order by co.name
          limit 40) p));
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Saves one page from L4. Nothing changes (no new version) when the sections and the title are
--    the same. A section a user locked cannot be changed (0062 trigger). A finished page clears the
--    entity's dirty_at only when it is still the value the run read, so a change during the run
--    waits for the next night; a page whose writer had to wait marks its entity dirty instead. The
--    writer's input hash is stored when given.
-- ---------------------------------------------------------------------------
create or replace function public.brain_save_page(
  _fund_id uuid,
  _kind text,
  _entity_id uuid,
  _title text,
  _sections jsonb,
  _search_text text default null,
  _dirty_at timestamptz default null,
  _change_note text default null,
  _finished boolean default true,
  _input_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_title text := left(btrim(coalesce(_title, '')), 300);
  v_fts tsvector;
  v_changed boolean := false;
begin
  if _fund_id is null or _kind is null or nullif(v_title, '') is null
     or jsonb_typeof(_sections) is distinct from 'array' then
    raise exception 'brain_save_page: fund, kind, title and sections are required';
  end if;
  if _entity_id is not null and not exists (
    select 1 from public.brain_entities e
    where e.id = _entity_id and e.fund_id = _fund_id and e.status = 'active') then
    return jsonb_build_object('skipped', 'entity_gone');
  end if;
  perform set_config('brain.change_note', left(coalesce(_change_note, ''), 500), true);
  v_fts := to_tsvector('danish'::regconfig, left(v_title || ' ' || coalesce(_search_text, ''), 200000));

  select * into v_page
  from public.brain_pages p
  where p.fund_id = _fund_id and p.kind = _kind and p.entity_id is not distinct from _entity_id
  for update;
  if not found then
    insert into public.brain_pages (fund_id, kind, entity_id, title, sections, search_fts, updated_by)
    values (_fund_id, _kind, _entity_id, v_title, _sections, v_fts, 'L4')
    returning * into v_page;
    v_changed := true;
  elsif v_page.sections is distinct from _sections or v_page.title is distinct from v_title then
    update public.brain_pages p
       set title = v_title, sections = _sections, search_fts = v_fts, updated_by = 'L4'
     where p.id = v_page.id
    returning * into v_page;
    v_changed := true;
  end if;

  if _input_hash is not null and v_page.input_hash is distinct from _input_hash then
    update public.brain_pages p set input_hash = _input_hash where p.id = v_page.id;
  end if;

  if _entity_id is not null and not coalesce(_finished, true) then
    update public.brain_entities e set dirty_at = coalesce(e.dirty_at, now())
     where e.id = _entity_id and e.fund_id = _fund_id;
  elsif _entity_id is not null and _dirty_at is not null then
    update public.brain_entities e set dirty_at = null
     where e.id = _entity_id and e.fund_id = _fund_id and e.dirty_at = _dirty_at;
  end if;
  return jsonb_build_object('pageId', v_page.id, 'version', v_page.version, 'changed', v_changed);
end;
$$;

revoke all on function public.brain_page_targets(uuid, int, int) from public, anon, authenticated;
revoke all on function public.brain_page_data(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.brain_save_page(uuid, text, uuid, text, jsonb, text, timestamptz, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.brain_page_targets(uuid, int, int) to service_role;
grant execute on function public.brain_page_data(uuid, text, uuid) to service_role;
grant execute on function public.brain_save_page(uuid, text, uuid, text, jsonb, text, timestamptz, text, boolean, text)
  to service_role;

commit;
