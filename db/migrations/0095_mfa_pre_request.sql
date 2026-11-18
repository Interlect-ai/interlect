-- 0095 · MFA uden ekstra pris pr. række.
--
-- 0094 lagde MFA-tjekket ind i is_fund_member, has_fund_role og fund_roles. De kaldes pr. række i
-- RLS-policies, så hjernekortet (brain_graph_payload) blev ca. 10 gange langsommere (CI: 450 ms →
-- 5-6 s). Tjekket flyttes derfor ud af dem, og det, de dækkede, dækkes billigere:
--   1. Funktionerne får deres form fra 0001 tilbage.
--   2. storage.objects får samme begrænsende policy mfa_required som tabellerne i public (0094);
--      den regnes én gang pr. forespørgsel, ikke pr. række.
--   3. public.mfa_pre_request() køres af PostgREST før hvert kald til Data API
--      (pgrst.db_pre_request på rollen authenticator) og afviser med 401, når en bruger med en
--      bekræftet faktor bruger en aal1-session. Det dækker også security definer-funktioner, som
--      RLS ikke gælder i. Ét tjek pr. kald.
-- Tabellernes policy mfa_required fra 0094 bliver stående.

begin;

set local lock_timeout = '5s';

create or replace function public.is_fund_member(_user_id uuid, _fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fund_memberships m
    where m.user_id = _user_id
      and m.fund_id = _fund_id
      and m.status = 'active'::public.membership_status
  )
$$;

create or replace function public.fund_roles(_user_id uuid, _fund_id uuid)
returns public.app_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.role order by r.role), '{}'::public.app_role[])
  from public.fund_memberships m
  join public.fund_membership_roles r on r.membership_id = m.id
  where m.user_id = _user_id
    and m.fund_id = _fund_id
    and m.status = 'active'::public.membership_status
$$;

create or replace function public.has_fund_role(_user_id uuid, _fund_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fund_memberships m
    join public.fund_membership_roles r on r.membership_id = m.id
    where m.user_id = _user_id
      and m.fund_id = _fund_id
      and m.status = 'active'::public.membership_status
      and r.role = _role
  )
$$;

drop policy if exists mfa_required on storage.objects;
create policy mfa_required on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create or replace function public.mfa_pre_request()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    -- PostgREST answers PTxyz with HTTP status xyz.
    raise sqlstate 'PT401' using message = 'MFA required';
  end if;
end
$$;

revoke all on function public.mfa_pre_request() from public;
grant execute on function public.mfa_pre_request() to anon, authenticated, service_role;
grant execute on function public.mfa_satisfied() to anon;

alter role authenticator set pgrst.db_pre_request = 'public.mfa_pre_request';

-- PostgREST reads the setting again when this transaction commits.
notify pgrst, 'reload config';

commit;
