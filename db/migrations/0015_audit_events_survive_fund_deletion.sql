-- Fixes a real bug found in live QA testing: deleting a fund always failed
-- with "Fonden kunne ikke slettes fra databasen." (masking a raw Postgres
-- error: "Revisionshændelser kan ikke ændres eller slettes.").
--
-- Root cause: `audit_events.fund_id` is `on delete cascade` against `funds`,
-- but `audit_events` also has an unconditional `before update or delete`
-- trigger (`audit_events_are_immutable`, 0001_m2_identity_access.sql) that
-- blocks ANY modification or deletion of an audit row -- deliberately, even
-- for the service role. The cascade tries to delete a fund's historical
-- audit rows as part of deleting the fund; the immutability trigger then
-- always blocks that delete, so the whole fund deletion fails for any fund
-- that has ever produced an audit event (i.e. virtually every real fund).
--
-- `on delete set null` would not help either: a FK-driven SET NULL is still
-- an UPDATE, which the same trigger blocks unconditionally.
--
-- Fix: audit events are a historical record and are meant to survive the
-- deletion of the entity they describe -- that is the point of an audit
-- log. Drop the foreign key so a fund can be deleted while its audit trail
-- (still naming the now-deleted fund_id, action, entity and payload)
-- remains, untouched, exactly as the immutability trigger requires. The
-- column and its index are unchanged; only the enforced-cascade relationship
-- is removed.

begin;

alter table public.audit_events drop constraint if exists audit_events_fund_id_fkey;

commit;
