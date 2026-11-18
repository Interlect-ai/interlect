-- 0119 · Model, pris og tokens i Brain- og kredittabellerne når ikke browseren (fra slut-/harden;
-- lukkede kun analysis_runs og analysis_run_steps).
--
-- Browserens rolle (authenticated) havde stadig SELECT på hele tabellerne, med RLS kun på
-- medlemskab, så et medlem af teamet med ét REST-kald (`/rest/v1/brain_usage?select=model,cost_usd`)
-- kunne læse Interlects model, USD-priser, tokens og værktøjskald:
--   brain_messages (model, cost_usd, tool_calls; 0047), brain_usage (model, tokens, pris; 0040),
--   brain_model_config (model pr. rolle; 0043), brain_jobs og brain_eval_runs (cost_usd, stats,
--   results; 0043) og ai_credit_ledger (model, loop, user_id; 0070).
--
-- Appen læser ingen af dem med brugerens klient, undtagen beskederne i Brain-chatten
-- (chat.functions.ts: id, thread_id, role, content, citations, used_web, created_at). Resten
-- læses af serveren med service-rollen (kreditmåleren, Brain-sløjferne, eval-scriptet).
--
-- 1. brain_usage, brain_model_config, brain_jobs, brain_eval_runs og ai_credit_ledger: authenticated
--    mister al adgang. RLS-policyerne består (de gør ingen skade uden grant).
-- 2. brain_messages: SELECT kun på de kolonner chatten viser, plus fund_id (RLS og
--    brain_feedback-policyen læser den). En ny kolonne er lukket for browseren, til den står her.
-- Ingen data ændres. service_role er urørt.

begin;
set local lock_timeout = '5s';

revoke all on table public.brain_usage, public.brain_model_config, public.brain_jobs,
  public.brain_eval_runs, public.ai_credit_ledger from authenticated;

revoke all on table public.brain_messages from authenticated;
grant select (id, fund_id, thread_id, role, content, citations, used_web, created_at)
  on public.brain_messages to authenticated;

commit;
