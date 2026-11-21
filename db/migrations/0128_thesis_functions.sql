-- tese-funktionerne med rettigheder og audit.
-- Spec: afsnit 2.3, 3 og 4.7.
--
-- Serveren læser nu casens (eller den valgte) tese i stedet for "teamets aktive version" (i koden),
-- så et team kan have flere aktive teser. Derfor:
--   1. create_thesis_from (0127) må kaldes af en logget ind bruger (rettighedstjekket er i den);
--   2. create_thesis laver en tom tese (kladde, uden versioner); serveren lægger v1 fra skabelonen;
--   3. rename_thesis, set_default_thesis, archive_thesis og reactivate_thesis.
-- Alle kræver can_configure_fund (Admin og Lead, 4.7), låser teamets teser, og skriver en linje i
-- audit_events. "Slet tese" er arkivér: intet slettes (afsnit 3). Kan køres igen.

begin;

grant execute on function public.create_thesis_from(uuid, text) to authenticated;

-- Fælles navnetjek: 2-80 tegn og unikt blandt teamets ikke-arkiverede teser (undtagen _except).
create or replace function private.thesis_name_ok(_fund_id uuid, _name text, _except uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(_name, ''));
begin
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Tesens navn skal være 2-80 tegn.';
  end if;
  if exists (
    select 1 from public.fund_theses t
    where t.fund_id = _fund_id and t.status <> 'archived'
      and t.id is distinct from _except
      and lower(btrim(t.name)) = lower(v_name)
  ) then
    raise exception 'Der findes allerede en tese med det navn.';
  end if;
  return v_name;
end;
$$;

revoke all on function private.thesis_name_ok(uuid, text, uuid) from public, anon, authenticated;

-- Låser tesen og alle teamets teser (så to samtidige arkiveringer ikke efterlader nul aktive),
-- og tjekker rettigheden. Returnerer tesens række.
create or replace function private.lock_thesis_for_change(_thesis_id uuid)
returns public.fund_theses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thesis public.fund_theses%rowtype;
begin
  select * into v_thesis from public.fund_theses where id = _thesis_id;
  if v_thesis.id is null then raise exception 'Tesen blev ikke fundet.'; end if;
  if not public.can_configure_fund(auth.uid(), v_thesis.fund_id) then
    raise exception 'Kun en Admin eller Lead kan ændre teser.';
  end if;
  perform 1 from public.fund_theses where fund_id = v_thesis.fund_id order by id for update;
  select * into v_thesis from public.fund_theses where id = _thesis_id;
  return v_thesis;
end;
$$;

revoke all on function private.lock_thesis_for_change(uuid) from public, anon, authenticated;

-- Ny, tom tese (kladde uden versioner). Serveren lægger version 1 fra skabelonen bagefter.
create or replace function public.create_thesis(_fund_id uuid, _name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
begin
  if not public.can_configure_fund(auth.uid(), _fund_id) then
    raise exception 'Kun en Admin eller Lead kan oprette en tese.';
  end if;
  perform 1 from public.funds where id = _fund_id for update;
  v_name := private.thesis_name_ok(_fund_id, _name, null);

  insert into public.fund_theses (fund_id, name, status, created_by)
  values (_fund_id, v_name, 'draft', auth.uid())
  returning id into v_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (_fund_id, 'user', auth.uid(), 'fund_thesis_created', 'fund_theses', v_id,
    jsonb_build_object('name', v_name, 'source', 'template'));
  return v_id;
end;
$$;

revoke all on function public.create_thesis(uuid, text) from public, anon;
grant execute on function public.create_thesis(uuid, text) to authenticated, service_role;

create or replace function public.rename_thesis(_thesis_id uuid, _name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thesis public.fund_theses%rowtype;
  v_name text;
begin
  v_thesis := private.lock_thesis_for_change(_thesis_id);
  if v_thesis.status = 'archived' then
    raise exception 'Genaktivér tesen for at omdøbe den.';
  end if;
  v_name := private.thesis_name_ok(v_thesis.fund_id, _name, v_thesis.id);
  if v_name = v_thesis.name then return; end if;

  update public.fund_theses set name = v_name where id = v_thesis.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_thesis.fund_id, 'user', auth.uid(), 'fund_thesis_renamed', 'fund_theses', v_thesis.id,
    jsonb_build_object('from', v_thesis.name, 'to', v_name));
end;
$$;

revoke all on function public.rename_thesis(uuid, text) from public, anon;
grant execute on function public.rename_thesis(uuid, text) to authenticated, service_role;

create or replace function public.set_default_thesis(_thesis_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thesis public.fund_theses%rowtype;
  v_previous uuid;
begin
  v_thesis := private.lock_thesis_for_change(_thesis_id);
  if v_thesis.status <> 'active' then
    raise exception 'Kun en udgivet tese kan være standard.';
  end if;
  if v_thesis.is_default then return; end if;

  select id into v_previous from public.fund_theses
  where fund_id = v_thesis.fund_id and is_default;
  update public.fund_theses set is_default = false
  where fund_id = v_thesis.fund_id and is_default;
  update public.fund_theses set is_default = true where id = v_thesis.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_thesis.fund_id, 'user', auth.uid(), 'fund_thesis_default_set', 'fund_theses', v_thesis.id,
    jsonb_build_object('previous_default', v_previous));
end;
$$;

revoke all on function public.set_default_thesis(uuid) from public, anon;
grant execute on function public.set_default_thesis(uuid) to authenticated, service_role;

-- "Slet tese" = arkivér (afsnit 3). Den sidste aktive tese kan ikke arkiveres. Var tesen standard,
-- bliver den ældste anden aktive tese standard; dens id returneres (ellers null).
create or replace function public.archive_thesis(_thesis_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thesis public.fund_theses%rowtype;
  v_new_default uuid;
  v_cases integer;
begin
  v_thesis := private.lock_thesis_for_change(_thesis_id);
  if v_thesis.status = 'archived' then
    raise exception 'Tesen er allerede arkiveret.';
  end if;
  if v_thesis.status = 'active' and not exists (
    select 1 from public.fund_theses t
    where t.fund_id = v_thesis.fund_id and t.status = 'active' and t.id <> v_thesis.id
  ) then
    raise exception 'Et team skal have mindst én aktiv tese.';
  end if;
  -- Et team, der aldrig har udgivet, beholder sin sidste tese, så opsætningen kan åbnes.
  if not exists (
    select 1 from public.fund_theses t
    where t.fund_id = v_thesis.fund_id and t.status <> 'archived' and t.id <> v_thesis.id
  ) then
    raise exception 'Et team skal have mindst én aktiv tese.';
  end if;

  update public.fund_theses
  set status = 'archived', is_default = false, archived_at = now(), archived_by = auth.uid()
  where id = v_thesis.id;

  if v_thesis.is_default then
    select t.id into v_new_default from public.fund_theses t
    where t.fund_id = v_thesis.fund_id and t.status = 'active'
    order by t.created_at, t.id
    limit 1;
    update public.fund_theses set is_default = true where id = v_new_default;
  end if;

  select count(*) into v_cases from public.cases where thesis_id = v_thesis.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_thesis.fund_id, 'user', auth.uid(), 'fund_thesis_archived', 'fund_theses', v_thesis.id,
    jsonb_build_object('name', v_thesis.name, 'previous_status', v_thesis.status,
      'cases', v_cases, 'new_default', v_new_default));
  return v_new_default;
end;
$$;

revoke all on function public.archive_thesis(uuid) from public, anon;
grant execute on function public.archive_thesis(uuid) to authenticated, service_role;

-- Genaktivér: aktiv igen, hvis tesen har en udgivet version, ellers kladde. _name (valgfri) giver
-- et nyt navn, når en anden tese har fået det gamle imens. Har teamet ingen standard, bliver den det.
create or replace function public.reactivate_thesis(_thesis_id uuid, _name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thesis public.fund_theses%rowtype;
  v_name text;
  v_status text;
begin
  v_thesis := private.lock_thesis_for_change(_thesis_id);
  if v_thesis.status <> 'archived' then
    raise exception 'Tesen er ikke arkiveret.';
  end if;
  v_name := private.thesis_name_ok(
    v_thesis.fund_id, coalesce(nullif(btrim(_name), ''), v_thesis.name), v_thesis.id);
  v_status := case when exists (
    select 1 from public.fund_config_versions v
    where v.thesis_id = v_thesis.id and v.status = 'active'::public.fund_config_status
  ) then 'active' else 'draft' end;

  update public.fund_theses
  set status = v_status, name = v_name, archived_at = null, archived_by = null,
      is_default = (v_status = 'active' and not exists (
        select 1 from public.fund_theses t where t.fund_id = v_thesis.fund_id and t.is_default))
  where id = v_thesis.id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_thesis.fund_id, 'user', auth.uid(), 'fund_thesis_reactivated', 'fund_theses', v_thesis.id,
    jsonb_build_object('name', v_name, 'previous_name', v_thesis.name, 'status', v_status));
end;
$$;

revoke all on function public.reactivate_thesis(uuid, text) from public, anon;
grant execute on function public.reactivate_thesis(uuid, text) to authenticated, service_role;

-- Cases-listen viser hver case med sin egen teses opsætning (tærskel, kriterier, krav): listen
-- sender casens tese og dens aktive version med, så serveren kan vælge profil pr. case (4.2).
create or replace function private.patch_function_text(_definition text, _old text, _new text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if position(_new in _definition) > 0 then
    return _definition; -- allerede rettet
  end if;
  v_count := (char_length(_definition) - char_length(replace(_definition, _old, ''))) / char_length(_old);
  if v_count = 1 then
    return replace(_definition, _old, _new);
  end if;
  raise exception 'T-1047: stedet blev fundet % gange: %', v_count, left(_old, 120);
end;
$$;

revoke all on function private.patch_function_text(text, text, text) from public, anon, authenticated;

do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.case_list_payload(uuid, uuid, uuid)'::regprocedure);
  definition := private.patch_function_text(definition,
    'coalesce(c.assigned_to, c.created_by) as assignee_id, av.id as active_config_id',
    'coalesce(c.assigned_to, c.created_by) as assignee_id, av.id as active_config_id, c.thesis_id');
  definition := private.patch_function_text(definition,
    E'          ''assignee_id'', fc.assignee_id,\n',
    E'          ''assignee_id'', fc.assignee_id,\n          ''thesis_id'', fc.thesis_id,\n          ''active_config_id'', fc.active_config_id,\n');
  execute definition;
end
$$;

revoke all on function public.case_list_payload(uuid, uuid, uuid) from public, anon;
grant execute on function public.case_list_payload(uuid, uuid, uuid) to authenticated, service_role;

drop function private.patch_function_text(text, text, text);

commit;
