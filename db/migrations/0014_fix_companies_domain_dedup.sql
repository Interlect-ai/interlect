-- Fixes a real bug found in live QA testing: the companies table's
-- `unique nulls not distinct (fund_id, domain)` constraint treats every
-- company with no domain as a duplicate of every OTHER domain-less company
-- in the same fund, even though `create_manual_case_for_fund` (see
-- 0007_case_workspace_and_analysis_jobs.sql) already falls back to
-- deduplicating by name when no domain is known. Result: creating a second
-- manually-entered company without a website in the same fund always failed
-- with "duplicate key value violates unique constraint
-- companies_fund_id_domain_key" -- a raw Postgres error that also leaked to
-- the end user (see the accompanying app-level fix that stops the leak).
--
-- Fix: only enforce the (fund_id, domain) uniqueness when domain is known.
-- Domain-less companies are deduplicated by name in the RPC instead, as
-- already implemented.

begin;

alter table public.companies drop constraint companies_fund_id_domain_key;

create unique index companies_fund_id_domain_key
  on public.companies (fund_id, domain)
  where domain is not null;

commit;
