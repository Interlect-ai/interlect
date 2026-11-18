-- PAP Intelligence — Milepæl 2: identitet, fond, medlemskaber, roller,
-- invitationer og uforanderlige revisionshændelser.
--
-- Køres én gang i SQL-editoren i det eksterne Supabase-projekt "PAP-intelligence".
-- Hele migrationen kører i én transaktion.

begin;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('administrator', 'partner', 'analyst', 'observer');
create type public.membership_status as enum ('active', 'deactivated');
create type public.audit_actor_type as enum ('pap', 'user', 'system');

-- ---------------------------------------------------------------------------
-- 2. Tabeller
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email_normalized text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.funds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fund_memberships (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, user_id)
);

create table public.fund_membership_roles (
  membership_id uuid not null references public.fund_memberships (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (membership_id, role)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  email_normalized text not null,
  roles public.app_role[] not null check (array_length(roles, 1) >= 1),
  token_hash text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  -- Ejerskabsmarkør for det igangværende accept-forsøg. Kun forsøget med
  -- samme claim_id må færdiggøre eller frigive invitationen.
  claim_id uuid,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index invitations_fund_idx on public.invitations (fund_id, created_at desc);

-- Append-only: der findes ingen UPDATE/DELETE-policy for nogen rolle.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid references public.funds (id) on delete cascade,
  actor_type public.audit_actor_type not null,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_events_fund_idx on public.audit_events (fund_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 3. Security-definer hjælpefunktioner (tom search_path, fuldt kvalificeret)
-- ---------------------------------------------------------------------------

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

create or replace function public.membership_fund_id(_membership_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.fund_id from public.fund_memberships m where m.id = _membership_id
$$;

revoke all on function public.is_fund_member(uuid, uuid) from public, anon;
revoke all on function public.fund_roles(uuid, uuid) from public, anon;
revoke all on function public.has_fund_role(uuid, uuid, public.app_role) from public, anon;
revoke all on function public.membership_fund_id(uuid) from public, anon;

grant execute on function public.is_fund_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.fund_roles(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_fund_role(uuid, uuid, public.app_role) to authenticated, service_role;
grant execute on function public.membership_fund_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. GRANTs på Data API. Ingen anon-adgang nogen steder.
-- ---------------------------------------------------------------------------

-- Identitetsdata er beskyttet: brugeren må kun rette sit eget viste navn.
-- E-mail og id vedligeholdes udelukkende af verificerede serverflows
-- (service-rollen). Derfor ingen INSERT og kun kolonnen full_name på UPDATE.
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;

grant select, update on public.funds to authenticated;   -- INSERT bevidst udeladt
grant all on public.funds to service_role;

grant select on public.fund_memberships to authenticated;
grant all on public.fund_memberships to service_role;

grant select on public.fund_membership_roles to authenticated;
grant all on public.fund_membership_roles to service_role;

grant select on public.invitations to authenticated;
grant all on public.invitations to service_role;

grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS og policies
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.funds enable row level security;
alter table public.fund_memberships enable row level security;
alter table public.fund_membership_roles enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles_select_self_or_same_fund" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.fund_memberships mine
    join public.fund_memberships theirs on theirs.fund_id = mine.fund_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = public.profiles.id
  )
);

-- Ingen INSERT-policy: profiler oprettes kun af verificerede serverflows.

create policy "profiles_update_self_name_only" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Bælte og seler ud over kolonne-grantet: uændret identitet er et krav.
create or replace function public.profiles_protect_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id then
    if new.email_normalized is distinct from old.email_normalized
       or new.id is distinct from old.id then
      raise exception 'E-mail kan kun ændres af verificerede serverflows.';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_identity_immutable
before update on public.profiles
for each row execute function public.profiles_protect_identity();

create policy "funds_select_member" on public.funds
for select to authenticated
using (public.is_fund_member(auth.uid(), id));

create policy "funds_update_admin" on public.funds
for update to authenticated
using (public.has_fund_role(auth.uid(), id, 'administrator'))
with check (public.has_fund_role(auth.uid(), id, 'administrator'));
-- Ingen INSERT-policy: kun bootstrap-scriptet opretter en fond.

create policy "memberships_select_member" on public.fund_memberships
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));
-- Ingen INSERT/UPDATE/DELETE-policy: alle skrivninger går gennem
-- verificerede serverfunktioner med service-rollen.

create policy "membership_roles_select_member" on public.fund_membership_roles
for select to authenticated
using (public.is_fund_member(auth.uid(), public.membership_fund_id(membership_id)));

create policy "invitations_select_admin" on public.invitations
for select to authenticated
using (public.has_fund_role(auth.uid(), fund_id, 'administrator'));

create policy "audit_select_member" on public.audit_events
for select to authenticated
using (fund_id is not null and public.is_fund_member(auth.uid(), fund_id));
-- Ingen INSERT/UPDATE/DELETE-policy: kun triggere og serverfunktioner skriver.

-- ---------------------------------------------------------------------------
-- 6. Beskyttende triggere
-- ---------------------------------------------------------------------------

create or replace function public.prevent_self_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'deactivated'::public.membership_status
     and old.status = 'active'::public.membership_status
     and auth.uid() is not null
     and new.user_id = auth.uid() then
    raise exception 'En bruger kan ikke deaktivere sit eget medlemskab.';
  end if;
  return new;
end;
$$;

create trigger fund_memberships_no_self_deactivation
before update on public.fund_memberships
for each row execute function public.prevent_self_deactivation();

create or replace function public.prevent_self_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
begin
  select m.user_id into target_user
  from public.fund_memberships m
  where m.id = new.membership_id;

  if auth.uid() is not null and target_user = auth.uid() then
    raise exception 'En bruger kan ikke tildele sig selv en rolle.';
  end if;
  return new;
end;
$$;

create trigger fund_membership_roles_no_self_grant
before insert on public.fund_membership_roles
for each row execute function public.prevent_self_role_grant();

-- Den sidste aktive administrator må hverken miste rollen eller blive deaktiveret.
create or replace function public.protect_last_administrator_on_role_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_fund uuid;
  remaining integer;
begin
  if old.role <> 'administrator'::public.app_role then
    return old;
  end if;

  target_fund := public.membership_fund_id(old.membership_id);

  select count(*) into remaining
  from public.fund_memberships m
  join public.fund_membership_roles r on r.membership_id = m.id
  where m.fund_id = target_fund
    and m.status = 'active'::public.membership_status
    and r.role = 'administrator'::public.app_role
    and r.membership_id <> old.membership_id;

  if remaining = 0 then
    raise exception 'Fonden skal altid have mindst én aktiv administrator.';
  end if;

  return old;
end;
$$;

create trigger membership_roles_protect_last_admin
before delete on public.fund_membership_roles
for each row execute function public.protect_last_administrator_on_role_delete();

create or replace function public.protect_last_administrator_on_deactivate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  if new.status <> 'deactivated'::public.membership_status
     or old.status = 'deactivated'::public.membership_status then
    return new;
  end if;

  select count(*) into remaining
  from public.fund_memberships m
  join public.fund_membership_roles r on r.membership_id = m.id
  where m.fund_id = new.fund_id
    and m.status = 'active'::public.membership_status
    and r.role = 'administrator'::public.app_role
    and m.id <> new.id;

  if remaining = 0 then
    raise exception 'Fonden skal altid have mindst én aktiv administrator.';
  end if;

  return new;
end;
$$;

create trigger memberships_protect_last_admin
before update on public.fund_memberships
for each row execute function public.protect_last_administrator_on_deactivate();

-- Revisionshændelser er uforanderlige, også for service-rollen.
create or replace function public.audit_events_are_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Revisionshændelser kan ikke ændres eller slettes.';
end;
$$;

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function public.audit_events_are_immutable();

commit;
