-- (midtvejs-/harden, lav). Two holes inside RLS, both limited to what a logged-in user could
-- read directly through PostgREST:
--
-- (a) The fund's own prompt texts (prompt_module_overrides, research_module_overrides) were
--     readable by every member of the team, although the app hides them for Medlem and Læser.
--     SELECT now follows the people who may edit the setup (can_configure_fund). The analysis reads
--     them with the service role, so nothing in the runs changes. (fund_mandates.screening_instruction
--     is a column in a row everyone must read; it is a separate ticket,.)
--
-- (b) is_fund_member / fund_roles / has_fund_role answered for any _user_id and _fund_id, so any
--     logged-in user could probe who belongs to any team. They now answer true only when the
--     caller is the asked user, is a backend (no JWT user: the service role, triggers, migrations),
--     or is an active member of that same team (the task and assignee triggers ask about a
--     colleague). Everything else gets false / no roles.

begin;

set local search_path = public, extensions;

-- (a) ------------------------------------------------------------------------------------------
drop policy if exists "prompt_module_overrides_select_member" on public.prompt_module_overrides;
create policy "prompt_module_overrides_select_configure" on public.prompt_module_overrides
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.can_configure_fund(auth.uid(), v.fund_id)
  )
);

drop policy if exists "research_module_overrides_select_member" on public.research_module_overrides;
create policy "research_module_overrides_select_configure" on public.research_module_overrides
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.can_configure_fund(auth.uid(), v.fund_id)
  )
);

-- (b) ------------------------------------------------------------------------------------------
-- The guard is written into each body (no helper function): these run per row in RLS policies,
-- and a second security definer call per row made brain_graph_payload many times slower (0095).
-- In a policy the asked user is the caller, so the cheap `auth.uid() = _user_id` branch decides.
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
  and (
         auth.uid() is null
         or auth.uid() = _user_id
         or exists (
           select 1
           from public.fund_memberships c
           where c.user_id = auth.uid()
             and c.fund_id = _fund_id
             and c.status = 'active'::public.membership_status
         )
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
    and (
         auth.uid() is null
         or auth.uid() = _user_id
         or exists (
           select 1
           from public.fund_memberships c
           where c.user_id = auth.uid()
             and c.fund_id = _fund_id
             and c.status = 'active'::public.membership_status
         )
       )
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
  and (
         auth.uid() is null
         or auth.uid() = _user_id
         or exists (
           select 1
           from public.fund_memberships c
           where c.user_id = auth.uid()
             and c.fund_id = _fund_id
             and c.status = 'active'::public.membership_status
         )
       )
$$;

commit;
