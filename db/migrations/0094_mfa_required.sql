-- 0094 · MFA håndhæves i databasen.
--
-- Appen tilmelder en TOTP-faktor efter første login eller invitation og udfordrer ved hvert login
-- (Supabase Auth). Serverfunktionerne afviser en session uden aal2, når brugeren har en faktor
-- (src/lib/supabase/auth-middleware.ts). Det er ikke nok alene: browserens nøgle er offentlig, så
-- en, der kun kender adgangskoden, kunne ellers gå direkte til databasen med en aal1-session.
--
-- Derfor her:
--   1. public.mfa_satisfied(): sand, medmindre kalderen er en indlogget bruger med en bekræftet
--      faktor og en session, der ikke er aal2. Tjenesterollen, scripts og brugere uden faktor er
--      uændrede.
--   2. En begrænsende ("restrictive") policy på hver tabel i public med RLS, for rollen
--      authenticated. Den lægges oven på de eksisterende policies og giver aldrig mere adgang.
--   3. Fondens adgangsfunktioner (is_fund_member, has_fund_role, fund_roles) kræver det samme, så
--      også storage-policies og security definer-funktioner, der spørger dem, afviser aal1.
-- Nye tabeller skal have samme policy; test:rls fejler, hvis en tabel med RLS mangler den.

begin;

set local lock_timeout = '5s';

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The request's JWT claims, as PostgREST sets them (the local test image has no auth.jwt()).
  with claims as (
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), ''),
      '{}'
    )::jsonb as c
  )
  select auth.uid() is null
    or coalesce((select c ->> 'role' from claims), '') = 'service_role'
    or coalesce((select c ->> 'aal' from claims), '') = 'aal2'
    or not exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = auth.uid()
        and f.status::text = 'verified'
    )
$$;

revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

do $$
declare
  _table record;
begin
  for _table in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists mfa_required on public.%I', _table.relname);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated '
        'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      _table.relname
    );
  end loop;
end
$$;

create or replace function public.is_fund_member(_user_id uuid, _fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.mfa_satisfied() and exists (
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
    and public.mfa_satisfied()
$$;

create or replace function public.has_fund_role(_user_id uuid, _fund_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.mfa_satisfied() and exists (
    select 1
    from public.fund_memberships m
    join public.fund_membership_roles r on r.membership_id = m.id
    where m.user_id = _user_id
      and m.fund_id = _fund_id
      and m.status = 'active'::public.membership_status
      and r.role = _role
  )
$$;

commit;
