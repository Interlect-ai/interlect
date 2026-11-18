-- PAP Intelligence — Milepæl 3: versionerede fondsprofiler.
-- Kør efter 0001_m2_identity_access.sql.

begin;

create type public.fund_config_status as enum ('draft', 'active', 'superseded');
create type public.gate_treatment as enum ('hard', 'review');
create type public.fund_approval_mode as enum ('partner_approval', 'automatic');

create table public.fund_config_versions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  version integer not null,
  profile_key text not null,
  status public.fund_config_status not null default 'draft',
  source_basis text not null,
  researched_at date,
  activated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (fund_id, version),
  unique (fund_id, profile_key, version)
);

create unique index fund_config_one_active_idx
  on public.fund_config_versions (fund_id)
  where status = 'active';

create table public.fund_mandates (
  config_version_id uuid primary key references public.fund_config_versions (id) on delete cascade,
  thesis text not null,
  stages text[] not null,
  geographies text[] not null,
  sectors text[] not null,
  ticket_min_eur numeric,
  ticket_max_eur numeric,
  ticket_note text not null,
  analysis_threshold numeric not null check (analysis_threshold between 0 and 100),
  approval_mode public.fund_approval_mode not null default 'partner_approval',
  risk_posture text not null,
  check (ticket_min_eur is null or ticket_min_eur >= 0),
  check (ticket_max_eur is null or ticket_max_eur >= ticket_min_eur)
);

create table public.mandate_gates (
  id uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.fund_config_versions (id) on delete cascade,
  gate_key text not null,
  label text not null,
  description text not null,
  treatment public.gate_treatment not null,
  sort_order integer not null,
  unique (config_version_id, gate_key)
);

create table public.assessment_criteria (
  id uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.fund_config_versions (id) on delete cascade,
  criterion_key text not null,
  label text not null,
  description text not null,
  score_category text not null,
  weight numeric not null check (weight > 0 and weight <= 100),
  sort_order integer not null,
  unique (config_version_id, criterion_key)
);

create table public.fund_profile_sources (
  id uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.fund_config_versions (id) on delete cascade,
  label text not null,
  url text not null,
  supports text not null,
  source_type text not null check (source_type in ('official_website', 'official_legal_document')),
  collected_at timestamptz not null default now(),
  unique (config_version_id, url)
);

create index mandate_gates_version_idx on public.mandate_gates (config_version_id, sort_order);
create index assessment_criteria_version_idx on public.assessment_criteria (config_version_id, sort_order);
create index fund_profile_sources_version_idx on public.fund_profile_sources (config_version_id);

grant select, insert, update, delete on public.fund_config_versions to authenticated;
grant select, insert, update, delete on public.fund_mandates to authenticated;
grant select, insert, update, delete on public.mandate_gates to authenticated;
grant select, insert, update, delete on public.assessment_criteria to authenticated;
grant select, insert, update, delete on public.fund_profile_sources to authenticated;

grant all on public.fund_config_versions to service_role;
grant all on public.fund_mandates to service_role;
grant all on public.mandate_gates to service_role;
grant all on public.assessment_criteria to service_role;
grant all on public.fund_profile_sources to service_role;

alter table public.fund_config_versions enable row level security;
alter table public.fund_mandates enable row level security;
alter table public.mandate_gates enable row level security;
alter table public.assessment_criteria enable row level security;
alter table public.fund_profile_sources enable row level security;

create policy "fund_config_select_member" on public.fund_config_versions
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

create policy "fund_config_insert_admin" on public.fund_config_versions
for insert to authenticated
with check (public.has_fund_role(auth.uid(), fund_id, 'administrator'));

create policy "fund_config_update_admin" on public.fund_config_versions
for update to authenticated
using (public.has_fund_role(auth.uid(), fund_id, 'administrator'))
with check (public.has_fund_role(auth.uid(), fund_id, 'administrator'));

create policy "fund_config_delete_admin_draft" on public.fund_config_versions
for delete to authenticated
using (
  status = 'draft'
  and public.has_fund_role(auth.uid(), fund_id, 'administrator')
);

create policy "fund_mandates_select_member" on public.fund_mandates
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

create policy "fund_mandates_write_admin_draft" on public.fund_mandates
for all to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
)
with check (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
);

create policy "mandate_gates_select_member" on public.mandate_gates
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

create policy "mandate_gates_write_admin_draft" on public.mandate_gates
for all to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
)
with check (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
);

create policy "assessment_criteria_select_member" on public.assessment_criteria
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

create policy "assessment_criteria_write_admin_draft" on public.assessment_criteria
for all to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
)
with check (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
);

create policy "fund_profile_sources_select_member" on public.fund_profile_sources
for select to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id
      and public.is_fund_member(auth.uid(), v.fund_id)
  )
);

create policy "fund_profile_sources_write_admin_draft" on public.fund_profile_sources
for all to authenticated
using (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
)
with check (
  exists (
    select 1 from public.fund_config_versions v
    where v.id = config_version_id and v.status = 'draft'
      and public.has_fund_role(auth.uid(), v.fund_id, 'administrator')
  )
);

-- Aktivering er den eneste tilladte vej fra draft til active. Funktionen
-- validerer vægtene og bevarer tidligere versioner som uforanderlig historik.
create or replace function public.activate_fund_config(_config_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_status public.fund_config_status;
  v_weight numeric;
begin
  select v.fund_id, v.status into v_fund_id, v_status
  from public.fund_config_versions v
  where v.id = _config_version_id;

  if v_fund_id is null then
    raise exception 'Ukendt fondsprofilversion.';
  end if;
  if not public.has_fund_role(auth.uid(), v_fund_id, 'administrator') then
    raise exception 'Kun en administrator kan aktivere en fondsprofil.';
  end if;
  if v_status <> 'draft'::public.fund_config_status then
    raise exception 'Kun en kladde kan aktiveres.';
  end if;
  if not exists (select 1 from public.fund_mandates m where m.config_version_id = _config_version_id) then
    raise exception 'Fondsprofilen mangler mandat.';
  end if;

  select coalesce(sum(c.weight), 0) into v_weight
  from public.assessment_criteria c
  where c.config_version_id = _config_version_id;
  if v_weight <> 100 then
    raise exception 'Aktive kriterievægte skal summe til 100, men summerer til %.', v_weight;
  end if;

  update public.fund_config_versions
  set status = 'superseded'::public.fund_config_status
  where fund_id = v_fund_id and status = 'active'::public.fund_config_status;

  update public.fund_config_versions
  set status = 'active'::public.fund_config_status, activated_at = now()
  where id = _config_version_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (
    v_fund_id, 'user'::public.audit_actor_type, auth.uid(),
    'fund_config_activated', 'fund_config_versions', _config_version_id,
    jsonb_build_object('weight_total', v_weight)
  );
end;
$$;

revoke all on function public.activate_fund_config(uuid) from public, anon;
grant execute on function public.activate_fund_config(uuid) to authenticated, service_role;

-- En aktiv eller afløst version er et revisionsspor og må aldrig redigeres.
create or replace function public.protect_published_fund_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'superseded'::public.fund_config_status then
    raise exception 'Publicerede fondsprofilversioner er uforanderlige.';
  end if;
  if old.status = 'active'::public.fund_config_status
     and new.status <> 'superseded'::public.fund_config_status then
    raise exception 'En aktiv fondsprofil kan kun afløses af en ny version.';
  end if;
  return new;
end;
$$;

create trigger fund_config_versions_immutable
before update on public.fund_config_versions
for each row execute function public.protect_published_fund_config();

commit;
