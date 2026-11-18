-- Trigger functions execute through their triggers and must not be callable as RPCs.

begin;

revoke all on function public.prevent_self_deactivation() from public, anon, authenticated;
revoke all on function public.prevent_self_role_grant() from public, anon, authenticated;
revoke all on function public.protect_last_administrator_on_deactivate()
  from public, anon, authenticated;
revoke all on function public.protect_last_administrator_on_role_delete()
  from public, anon, authenticated;

commit;
