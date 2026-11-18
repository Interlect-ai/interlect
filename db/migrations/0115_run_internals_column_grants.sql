-- 0115 · Kørslernes interne felter når ikke browseren (fundet i review).
--
-- 0004 og 0007 gav browserens rolle (authenticated) SELECT på hele analysis_runs og
-- analysis_run_steps, så et medlem af teamet med ét REST-kald kunne hente Interlects pris (USD),
-- model, prompt- og workflowversion og tokens, selvom casens data ikke længere sender dem.
-- Det samme stod inde i analysis_runs.validation_result (model, budget og faktisk pris i USD ved
-- siden af teamets gate-svar), og trinenes output_json har udbyderens fejldiagnose.
--
-- 1. analysis_runs.validation_public: en gemt, genereret kopi af kun de dele af validation_result,
--    som kundens skærme læser (teamGateAnswers og financeScore); null, når validation_result er
--    null. Kun immutable operatorer, så den kan genereres; serveren skriver stadig kun
--    validation_result.
-- 2. authenticated mister alle tabelrettigheder på de to tabeller (der var kun en SELECT-policy, så
--    INSERT/UPDATE/DELETE blev allerede afvist af RLS) og får SELECT på en liste af kolonner: alt
--    undtagen model_provider, model_name, prompt_template_name, prompt_template_version,
--    prompt_version, workflow_version, token_usage, input_tokens, output_tokens, total_tokens,
--    estimated_cost, actual_cost, idempotency_key (har prompt- og modelnavn), validation_result og
--    trinenes output_json og attempt_count. RLS gælder uændret pr. række.
--    En ny kolonne på tabellerne er derfor lukket for browseren, til den står i en grant her.
-- 3. case_list_payload (security invoker, 0112) læser teamets gate-svar fra validation_public;
--    resten af funktionen er uændret.
--
-- Serveren læser de interne kolonner med service-rollen (AI-indstillingerne, genscreening og den
-- dybe analyses tjek af tidligere kørsler flyttes dertil i samme PR). Ingen data ændres.

begin;

alter table public.analysis_runs
  add column validation_public jsonb generated always as (
    case when jsonb_typeof(validation_result) = 'object' then
      case when validation_result ? 'teamGateAnswers'
        then jsonb_set('{}'::jsonb, '{teamGateAnswers}', validation_result -> 'teamGateAnswers')
        else '{}'::jsonb end
      || case when validation_result ? 'financeScore'
        then jsonb_set('{}'::jsonb, '{financeScore}', validation_result -> 'financeScore')
        else '{}'::jsonb end
    end
  ) stored;

comment on column public.analysis_runs.validation_public is
  'T-915: kun teamGateAnswers og financeScore fra validation_result; det, browserens rolle må læse.';

revoke all on table public.analysis_runs, public.analysis_run_steps from authenticated;

grant select (id, fund_id, case_id, config_version_id, previous_run_id, kind, status,
  raw_response, validation_public, input_evidence_ids, error_message, requested_by, approved_by,
  approved_at, started_at, completed_at, created_at, ai_tier, cost_cap_dkk, playbook_bullet_ids)
  on public.analysis_runs to authenticated;

grant select (id, fund_id, run_id, step_key, step_order, status, error_message, started_at,
  completed_at, created_at)
  on public.analysis_run_steps to authenticated;

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
          'screening_team_gate_answers', sv.validation_public -> 'teamGateAnswers',
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

commit;
