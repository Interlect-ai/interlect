-- Tilbagerulning af 0001_m2_identity_access.sql.
-- Alle objekter er nye, så ingen eksisterende data berøres.

begin;

drop trigger if exists profiles_identity_immutable on public.profiles;
drop trigger if exists audit_events_immutable on public.audit_events;
drop trigger if exists memberships_protect_last_admin on public.fund_memberships;
drop trigger if exists membership_roles_protect_last_admin on public.fund_membership_roles;
drop trigger if exists fund_membership_roles_no_self_grant on public.fund_membership_roles;
drop trigger if exists fund_memberships_no_self_deactivation on public.fund_memberships;

drop function if exists public.profiles_protect_identity();
drop function if exists public.audit_events_are_immutable();
drop function if exists public.protect_last_administrator_on_deactivate();
drop function if exists public.protect_last_administrator_on_role_delete();
drop function if exists public.prevent_self_role_grant();
drop function if exists public.prevent_self_deactivation();

drop policy if exists "audit_select_member" on public.audit_events;
drop policy if exists "invitations_select_admin" on public.invitations;
drop policy if exists "membership_roles_select_member" on public.fund_membership_roles;
drop policy if exists "memberships_select_member" on public.fund_memberships;
drop policy if exists "funds_update_admin" on public.funds;
drop policy if exists "funds_select_member" on public.funds;
drop policy if exists "profiles_update_self_name_only" on public.profiles;
drop policy if exists "profiles_select_self_or_same_fund" on public.profiles;

drop function if exists public.membership_fund_id(uuid);
drop function if exists public.has_fund_role(uuid, uuid, public.app_role);
drop function if exists public.fund_roles(uuid, uuid);
drop function if exists public.is_fund_member(uuid, uuid);

drop table if exists public.audit_events;
drop table if exists public.invitations;
drop table if exists public.fund_membership_roles;
drop table if exists public.fund_memberships;
drop table if exists public.funds;
drop table if exists public.profiles;

drop type if exists public.audit_actor_type;
drop type if exists public.membership_status;
drop type if exists public.app_role;

commit;
