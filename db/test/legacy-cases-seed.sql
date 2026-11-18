-- Kun til lokale tests: gamle cases (workspace_status/process_stage) i alle kombinationer fra
-- mapping-tabellen, så udfyldningen i 0033 kan testes (npm run db:local -- fresh --until 0032).
begin;
insert into auth.users (id, email) values ('c0000000-0000-4000-8000-000000000001', 'legacy@interlect.test');
insert into public.funds (id, name, slug)
values ('f0000000-0000-4000-8000-000000000001', 'Legacy testfond', 'legacy-testfond');
insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
values ('f0000000-0000-4000-8000-0000000000c1', 'f0000000-0000-4000-8000-000000000001', 1, 'legacy', 'test');

create temp table legacy (n int, ws public.case_workspace_status, ps public.investment_process_stage, deep boolean)
on commit drop;
insert into legacy values
  (1, 'screening', 'new_case', false),
  (2, 'deep_analysis', 'new_case', true),
  (3, 'deep_analysis', 'investment_committee', true),
  (4, 'archived', 'new_case', false),
  (5, 'on_hold', 'new_case', false),
  (6, 'on_hold', 'new_case', true),
  (7, 'on_hold', 'investment_committee', true),
  (8, 'deep_analysis', 'invested', true),
  (9, 'deep_analysis', 'closed_without_investment', true),
  (10, 'archived', 'investment_committee', true),
  (11, 'screening', 'investment_memo', false);

insert into public.companies (id, fund_id, name)
select ('d0000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'f0000000-0000-4000-8000-000000000001', 'Selskab ' || n
from legacy;
insert into public.cases (id, fund_id, company_id, primary_origin, created_by, workspace_status, process_stage, created_at)
select ('e0000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'f0000000-0000-4000-8000-000000000001',
       ('d0000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'manual', 'c0000000-0000-4000-8000-000000000001', ws, ps, now() - interval '30 days'
from legacy;
insert into public.analysis_runs
  (fund_id, case_id, config_version_id, kind, status, workflow_version, prompt_template_name,
   prompt_template_version, requested_by, created_at)
select 'f0000000-0000-4000-8000-000000000001',
       ('e0000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'f0000000-0000-4000-8000-0000000000c1', 'deep', 'complete', 'test', 'test', 'test',
       'c0000000-0000-4000-8000-000000000001', now() - interval '10 days'
from legacy where deep;
insert into public.case_transition_events
  (fund_id, case_id, field, actor_type, actor_id, previous_value, new_value, occurred_at)
values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'process_stage', 'user',
   'c0000000-0000-4000-8000-000000000001', 'new_case', 'investment_committee', now() - interval '5 days'),
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000009', 'process_stage', 'user',
   'c0000000-0000-4000-8000-000000000001', 'investment_committee', 'closed_without_investment', now() - interval '4 days'),
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000005', 'workspace_status', 'user',
   'c0000000-0000-4000-8000-000000000001', 'screening', 'on_hold', now() - interval '3 days'),
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'workspace_status', 'user',
   'c0000000-0000-4000-8000-000000000001', 'screening', 'deep_analysis', now() - interval '12 days');
insert into public.case_notes (fund_id, case_id, author_id, body, created_at)
values ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000001', 'Gammel note', now() - interval '2 days');
commit;
