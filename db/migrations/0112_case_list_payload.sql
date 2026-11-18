-- 0112 · Cases-listen i ét kald (fundet).
--
-- listCases hentede alle cases og bagefter alle profilens kørsler med fuld raw_response (33 MB ved
-- 2.000 cases), sendte alle sag- og kørsels-id'er i adressen (ca. 78 KB ved 2.000 cases, over
-- gatewayens grænse fra ca. 200-400 cases) og fik højst 1.000 rækker pr. kald af PostgREST uden at
-- få det at vide. case_list_payload(fond, profil) bygger listens data i databasen og svarer med ét
-- jsonb-objekt (PostgREST' rækkeloft gælder ikke for én værdi, og fondens id er det eneste i kaldet):
--   cases:     hver case med selskab, ansvarlig, de kørsler listen viser (seneste kørsel, seneste
--              færdige screening, seneste færdige dybe analyse), screeningens krav (kun gateKey og
--              passed) og teamets svar, antal kilder, åbne opgaver og højeste risiko i den dybe analyse
--   runs:      alle profilens kørsler, nyeste først, kun art, status og anbefalingens tal
--              (fit-historikken og "Kør dyb analyse")
--   scores, trust: kun for de viste screeninger og dybe analyser; recalcs: den nyeste genberegning
--              pr. vist screening; steps: kun for kørsler, der er i gang
--   assignees: navnene på de ansvarlige
-- "Seneste" er nyeste created_at, så højeste id, samme rækkefølge som runs (listCases læser dem).
--
-- security invoker: rækkesikkerheden afgør, hvad den kaldende ser, og kaldet afvises for andre end
-- fondens medlemmer (og serverens service-rolle). Ingen tabeller ændres.

begin;

create or replace function public.case_list_payload(_fund_id uuid, _config_version_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if _fund_id is null or _config_version_id is null then
    raise exception 'case_list_payload: fund and profile are required' using errcode = '22004';
  end if;
  if current_user <> 'service_role'
     and not public.is_fund_member((select auth.uid()), _fund_id) then
    raise exception 'case_list_payload: not a member of the fund' using errcode = '42501';
  end if;

  with fund_cases as (
    select c.id, c.company_id, c.primary_origin, c.process_stage, c.workspace_status,
      c.workspace_reason, c.phase, c.status, c.last_action_at, c.updated_at,
      coalesce(c.assigned_to, c.created_by) as assignee_id
    from public.cases c
    where c.fund_id = _fund_id
  ),
  runs as (
    select r.id, r.case_id, r.kind, r.status, r.created_at, r.previous_run_id
    from public.analysis_runs r
    join fund_cases fc on fc.id = r.case_id
    where r.fund_id = _fund_id and r.config_version_id = _config_version_id
  ),
  latest_run as (
    select distinct on (r.case_id) r.case_id, r.id, r.status
    from runs r
    order by r.case_id, r.created_at desc, r.id desc
  ),
  screening_run as (
    select distinct on (r.case_id) r.case_id, r.id
    from runs r
    where r.kind = 'screening' and r.status in ('complete', 'awaiting_approval')
    order by r.case_id, r.created_at desc, r.id desc
  ),
  deep_run as (
    select distinct on (r.case_id) r.case_id, r.id
    from runs r
    where r.kind = 'deep' and r.status = 'complete'
    order by r.case_id, r.created_at desc, r.id desc
  ),
  shown_run as (
    select id from screening_run
    union
    select id from deep_run
  ),
  source_count as (
    select s.case_id, count(*) as n
    from public.sources s
    where s.fund_id = _fund_id
    group by s.case_id
  ),
  open_task_count as (
    select t.case_id, count(*) as n
    from public.case_tasks t
    where t.fund_id = _fund_id and t.status = 'open' and t.deleted_at is null
    group by t.case_id
  ),
  top_risk as (
    select k.run_id, max(k.level) as level
    from public.risks k
    join deep_run d on d.id = k.run_id
    where k.fund_id = _fund_id
    group by k.run_id
  )
  select jsonb_build_object(
    'cases', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', fc.id,
          'primary_origin', fc.primary_origin,
          'process_stage', fc.process_stage,
          'workspace_status', fc.workspace_status,
          'workspace_reason', fc.workspace_reason,
          'phase', fc.phase,
          'status', fc.status,
          'last_action_at', fc.last_action_at,
          'updated_at', fc.updated_at,
          'assignee_id', fc.assignee_id,
          'company_name', co.name,
          'website', co.website,
          'stage', co.stage,
          'sector', co.sector,
          'geography', co.geography,
          'latest_run_id', lr.id,
          'screening_run_id', sr.id,
          'deep_run_id', dr.id,
          'screening_gates', case
            when jsonb_typeof(sv.raw_response -> 'gates') = 'array' then (
              select coalesce(jsonb_agg(jsonb_build_object(
                  'gateKey', g.gate -> 'gateKey',
                  'passed', g.gate -> 'passed'
                ) order by g.ord), '[]'::jsonb)
              from jsonb_array_elements(sv.raw_response -> 'gates') with ordinality as g(gate, ord)
            )
          end,
          'screening_team_gate_answers', sv.validation_result -> 'teamGateAnswers',
          'top_risk_level', tr.level,
          'source_count', coalesce(sc.n, 0),
          'open_tasks', coalesce(ot.n, 0)
        ) order by fc.updated_at desc, fc.id), '[]'::jsonb)
      from fund_cases fc
      left join public.companies co on co.id = fc.company_id
      left join latest_run lr on lr.case_id = fc.id
      left join screening_run sr on sr.case_id = fc.id
      left join public.analysis_runs sv on sv.id = sr.id
      left join deep_run dr on dr.case_id = fc.id
      left join top_risk tr on tr.run_id = dr.id
      left join source_count sc on sc.case_id = fc.id
      left join open_task_count ot on ot.case_id = fc.id
    ),
    'runs', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id,
          'case_id', r.case_id,
          'kind', r.kind,
          'status', r.status,
          'previous_run_id', r.previous_run_id,
          'recommendation', rec.recommendation,
          'overall_score', rec.overall_score,
          'evidence_confidence', rec.evidence_confidence
        ) order by r.created_at desc, r.id desc), '[]'::jsonb)
      from runs r
      left join public.recommendations rec on rec.run_id = r.id
    ),
    'scores', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'run_id', cs.run_id,
          'category', cs.category,
          'validated_score', cs.validated_score,
          'weight', cs.weight
        )), '[]'::jsonb)
      from public.category_scores cs
      join shown_run s on s.id = cs.run_id
      where cs.fund_id = _fund_id
    ),
    'trust', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'run_id', t.run_id,
          'verified', t.verified,
          'corroborated', t.corroborated,
          'company_stated', t.company_stated,
          'contradictory', t.contradictory,
          'unknown', t.unknown
        )), '[]'::jsonb)
      from public.analysis_run_evidence_trust t
      -- An array, not a join: the view groups by run, so only this filter reaches inside it.
      where t.fund_id = _fund_id and t.run_id = any (array(select id from shown_run))
    ),
    'recalcs', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'run_id', q.run_id,
          'overall_score', q.overall_score,
          'failed_gate_keys', q.failed_gate_keys
        )), '[]'::jsonb)
      from (
        select distinct on (q.run_id) q.run_id, q.overall_score, q.failed_gate_keys
        from public.case_score_recalculations q
        join screening_run s on s.id = q.run_id
        where q.fund_id = _fund_id
        order by q.run_id, q.created_at desc, q.id desc
      ) q
    ),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'run_id', st.run_id,
          'step_key', st.step_key,
          'status', st.status
        ) order by st.step_order, st.created_at), '[]'::jsonb)
      from public.analysis_run_steps st
      join latest_run lr on lr.id = st.run_id and lr.status in ('queued', 'running')
      where st.fund_id = _fund_id
    ),
    'assignees', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name)), '[]'::jsonb)
      from public.profiles p
      where p.id in (select assignee_id from fund_cases)
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.case_list_payload(uuid, uuid) is
  'Cases-listen (T-901): listens felter for alle fondens cases i ét kald. Kun fondens medlemmer; RLS gælder.';

revoke all on function public.case_list_payload(uuid, uuid) from public, anon;
grant execute on function public.case_list_payload(uuid, uuid) to authenticated, service_role;

commit;
