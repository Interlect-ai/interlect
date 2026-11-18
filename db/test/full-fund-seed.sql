-- Kun til lokale tests: én fond med rækker i alle de tabeller, en sletning skal igennem
-- (Admin, udgivet opsætning, cases, kørsler, log, tasks, genberegninger, beskeder, noter,
-- dokumenter, evidens, finanstal, scanner). Bruges af npm run test:rls (delete_fund).
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-0000000000a1', 'slet-admin@interlect.test');
insert into public.funds (id, name, slug) values ('d0000000-0000-4000-8000-0000000000f1', 'Slettes', 'slettes');
insert into public.fund_memberships (id, fund_id, user_id)
values ('d0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000a1');
insert into public.fund_membership_roles (membership_id, role) values ('d0000000-0000-4000-8000-0000000000b1', 'admin');
insert into public.fund_config_versions (id, fund_id, version, profile_key, source_basis)
values ('d0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000f1', 1, 'slet', 'test');
insert into public.fund_mandates (config_version_id, thesis, stages, geographies, sectors, ticket_note, analysis_threshold, risk_posture)
values ('d0000000-0000-4000-8000-0000000000e1', 'Tese', '{seed}', '{DK}', '{software}', '', 60, 'Høj');
insert into public.mandate_gates (config_version_id, gate_key, label, description, treatment, sort_order)
values ('d0000000-0000-4000-8000-0000000000e1', 'geo', 'Nordisk', 'Nordisk selskab', 'hard', 1);
-- Vægtene skal ligge mellem 5 og 40 % for at en version kan blive aktiv (0051).
insert into public.assessment_criteria (config_version_id, criterion_key, label, description, score_category, weight, sort_order)
values ('d0000000-0000-4000-8000-0000000000e1', 'team', 'Team', 'Team', 'team', 40, 1),
       ('d0000000-0000-4000-8000-0000000000e1', 'market', 'Marked', 'Marked', 'team', 35, 2),
       ('d0000000-0000-4000-8000-0000000000e1', 'traction', 'Traction', 'Traction', 'team', 25, 3);
update public.fund_config_versions set status = 'active' where id = 'd0000000-0000-4000-8000-0000000000e1';
insert into public.companies (id, fund_id, name) values ('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000f1', 'Selskab');
insert into public.cases (id, fund_id, company_id, primary_origin, created_by)
values ('d0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000c1', 'manual', 'd0000000-0000-4000-8000-0000000000a1');
insert into public.analysis_runs (id, fund_id, case_id, config_version_id, kind, status, workflow_version, prompt_template_name, prompt_template_version, requested_by)
values ('d0000000-0000-4000-8000-0000000000e2', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000e1', 'screening', 'complete', 't', 't', 't', 'd0000000-0000-4000-8000-0000000000a1');
select public.transition_case('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000a1', 'decided', 'closed', '{small_market}', _analysis_run_id => 'd0000000-0000-4000-8000-0000000000e2');
insert into public.case_tasks (id, fund_id, case_id, kind, title, origin, created_by)
values ('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'task', 'T', 'user', 'd0000000-0000-4000-8000-0000000000a1');
insert into public.case_score_recalculations (fund_id, case_id, run_id, task_id, overall_score, outcome, formula_version, result, created_by)
values ('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000e2', 'd0000000-0000-4000-8000-0000000000a2', 50, 'blocked', 't', '{}', 'd0000000-0000-4000-8000-0000000000a1');
insert into public.case_messages (fund_id, case_id, author_id, body)
values ('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000a1', 'Hej');
insert into public.case_notes (fund_id, case_id, author_id, body)
values ('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-0000000000a1', 'Note');
insert into public.documents (id, fund_id, case_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by, task_id)
values ('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'other', 'x.pdf', 'd0000000-0000-4000-8000-0000000000f1/d0000000-0000-4000-8000-0000000000d1/x.pdf', 'application/pdf', 10, 'd0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a2');
insert into public.evidence_items (id, fund_id, case_id, claim, created_by, document_id)
values ('d0000000-0000-4000-8000-0000000000a4', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'Omsætning', 'd0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a3');
insert into public.financial_data_points (fund_id, case_id, metric, value, unit, evidence_id)
values ('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000d1', 'revenue', 1, 'DKK', 'd0000000-0000-4000-8000-0000000000a4');
insert into public.scanner_runs (id, fund_id, config_version_id, started_by)
values ('d0000000-0000-4000-8000-0000000000a5', 'd0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000a1');
insert into public.scanner_sources (id, fund_id, source_key, kind, label, base_url)
values ('d0000000-0000-4000-8000-0000000000a6', 'd0000000-0000-4000-8000-0000000000f1', 'hn', 'hacker_news', 'HN', 'https://news.ycombinator.com');
insert into public.scanner_signals (fund_id, scanner_run_id, source_id, external_id, fingerprint, title, url, relevance_score, relevance_explanation)
values ('d0000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-0000000000a5', 'd0000000-0000-4000-8000-0000000000a6', '1', 'f', 'T', 'https://x.test', 0.5, 'x');
