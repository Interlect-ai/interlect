-- Rettelser efter /harden (30. sep 2026, run 20260929-2217-4e3c4eb). 0032–0038 er kørt på
-- staging og rettes derfor fremad her. Ingen nye tabeller.
-- 1. transition_case får _expected_status (F5): en side, der viser en gammel tilstand, kan ikke
--    overskrive en nyere beslutning; serveren sender den tilstand, brugeren så. Øjebliksbilledet
--    i loggen gemmer den seneste screenings egen tese-version og den score, koden senest
--    regnede for den screening (teamets gate-svar indregnet), ellers screeningens egen score.
--    Kun færdige screeninger tæller (en fejlet screening har også completed_at).
-- 2. Fortryd (F7) måler tidsvinduet fra batchens seneste overgang, så en flytning af mange cases
--    enten fortrydes helt eller slet ikke.
-- 3. case_tasks.deleted_by (F1): hvem der slettede et svar.
-- 4. Tabeller, som kun serveren skriver i, mister insert/update/delete for authenticated.
--    Hidtil stoppede kun manglende policies skrivningen.
-- 5. delete_fund låser fonden først, så en analyse, der oprettes midt i sletningen, venter.
-- 6. Den ansvarlige på en opgave: fejlkoden IL001 i stedet for tekstmatch.
-- 7. Indekser på fremmednøgler, som cascaden i delete_fund går igennem, og en policy, der
--    nævner sin egen tabel eksplicit.
-- 8. Revisionsloggen (invitationer med e-mails, tilsidesættelser, indstillinger) kan kun læses af
--    fondens Admin, som Sikkerhed og data (harden/S5-4). Før kunne alle medlemmer læse den.
-- 9. Runde 2 (samme dag, før 0039 er kørt nogen steder): fortryd låser casen og sender den
--    forventede tilstand til transition_case (G10), flere indekser (G22), og kun Admin, Lead og
--    Medlem kan registrere et pitch deck (G24; Læser har ikke upload_document).

begin;

set local lock_timeout = '5s';
set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. transition_case med _expected_status og rettet øjebliksbillede
-- ---------------------------------------------------------------------------

drop function public.transition_case(
  uuid, uuid, uuid, public.case_phase, public.case_status, text[], text, uuid,
  public.audit_actor_type, public.case_phase, uuid, text, uuid
);

create function public.transition_case(
  _fund_id uuid,
  _case_id uuid,
  _actor_id uuid,
  _to_phase public.case_phase,
  _to_status public.case_status,
  _reason_codes text[] default '{}',
  _note text default null,
  _batch_id uuid default null,
  _actor_type public.audit_actor_type default 'user',
  _expected_phase public.case_phase default null,
  _analysis_run_id uuid default null,
  _movement_kind text default null,
  _undo_of uuid default null,
  _expected_status public.case_status default null
)
returns table (
  event_id uuid,
  changed boolean,
  from_phase public.case_phase,
  from_status public.case_status,
  to_phase public.case_phase,
  to_status public.case_status,
  movement_kind text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_case record;
  v_phase public.case_phase;
  v_status public.case_status;
  v_field text;
  v_previous text;
  v_new text;
  v_kind text;
  v_codes text[] := coalesce(_reason_codes, '{}'::text[]);
  v_note text := nullif(trim(coalesce(_note, '')), '');
  v_reason text;
  v_event uuid;
  v_config uuid;
  v_screening_run uuid;
  v_screening numeric;
  v_deep numeric;
  v_workspace public.case_workspace_status;
  v_process public.investment_process_stage;
begin
  select c.id, c.phase, c.status, c.process_stage into v_case
  from public.cases c
  where c.id = _case_id and c.fund_id = _fund_id
  for update;
  if v_case.id is null then
    raise exception 'Casen blev ikke fundet i den valgte fond.';
  end if;

  -- Casen står ikke længere, hvor kalderen så den: intet ændres, og kalderen får den aktuelle
  -- tilstand tilbage (event_id null, changed false).
  if (_expected_phase is not null and v_case.phase <> _expected_phase)
     or (_expected_status is not null and v_case.status <> _expected_status) then
    return query select null::uuid, false, v_case.phase, v_case.status, v_case.phase, v_case.status, null::text;
    return;
  end if;

  v_status := coalesce(_to_status, v_case.status);
  v_phase := _to_phase;
  if v_phase is null then
    if v_case.phase = 'decided' and v_status in ('active', 'on_hold') then
      select e.from_phase into v_phase
      from public.case_transition_events e
      where e.case_id = _case_id
        and e.fund_id = _fund_id
        and e.to_phase = 'decided'
        and e.from_phase <> 'decided'
      order by e.occurred_at desc, e.id desc
      limit 1;
      v_phase := coalesce(v_phase, 'committee');
    else
      v_phase := v_case.phase;
    end if;
  end if;

  if (v_phase = 'decided') <> (v_status in ('closed', 'invested')) then
    raise exception 'Besluttet hører sammen med Lukket eller Investeret.';
  end if;

  if v_phase = v_case.phase and v_status = v_case.status then
    return query select null::uuid, false, v_case.phase, v_case.status, v_phase, v_status, null::text;
    return;
  end if;

  if v_status <> v_case.status then
    v_field := 'status';
    v_previous := v_case.status::text;
    v_new := v_status::text;
  else
    v_field := 'phase';
    v_previous := v_case.phase::text;
    v_new := v_phase::text;
  end if;

  if _movement_kind is not null and _movement_kind <> 'system' then
    raise exception 'Kun systembevægelser kan angives direkte.';
  end if;
  v_kind := coalesce(
    _movement_kind,
    public.brain_movement_kind(v_field, v_previous, v_new, v_case.phase::text)
  );

  -- Databasens eget rettighedstjek (serveren har allerede tjekket capability).
  if _actor_type = 'user' then
    if _actor_id is null or not (
      public.has_fund_role(_actor_id, _fund_id, 'admin')
      or public.has_fund_role(_actor_id, _fund_id, 'lead')
      or public.has_fund_role(_actor_id, _fund_id, 'member')
    ) then
      raise exception 'Din rolle kan ikke flytte casen.';
    end if;
    if (v_case.phase = 'decided' or v_phase = 'decided')
       and not private.can_decide_case(_actor_id, _fund_id) then
      raise exception 'Din rolle kan ikke beslutte investeret eller luk.';
    end if;
    if v_kind in ('hold', 'reject', 'decline_ic', 'invest') and cardinality(v_codes) = 0 then
      raise exception 'Vælg mindst én årsag.';
    end if;
  end if;

  if exists (
    select 1 from unnest(v_codes) as wanted(code)
    where not exists (
      select 1 from public.brain_reason_codes r
      where r.fund_id = _fund_id and r.code = wanted.code and r.is_active
    )
  ) then
    raise exception 'En af årsagerne findes ikke for denne investeringstese.';
  end if;
  if 'other' = any (v_codes) and v_note is null then
    raise exception 'Skriv en kort begrundelse, når årsagen er "Andet".';
  end if;

  v_reason := coalesce(
    v_note,
    (select string_agg(r.label, ', ' order by array_position(v_codes, r.code))
     from public.brain_reason_codes r
     where r.fund_id = _fund_id and r.code = any (v_codes))
  );

  -- Øjebliksbilledet (Brain lærer af det, og loggen kan ikke rettes bagefter): den seneste
  -- færdige screening, dens egen tese-version og den score, koden senest regnede for netop den
  -- screening. Uden screening: den aktive tese-version.
  select ar.id, ar.config_version_id, rec.overall_score
    into v_screening_run, v_config, v_screening
  from public.analysis_runs ar
  left join public.recommendations rec on rec.run_id = ar.id
  where ar.case_id = _case_id and ar.fund_id = _fund_id and ar.kind = 'screening'
    and ar.status in ('complete', 'awaiting_approval')
    and ar.completed_at is not null
  order by ar.completed_at desc
  limit 1;

  if v_screening_run is not null then
    select coalesce(
      (select r.overall_score
       from public.case_score_recalculations r
       where r.fund_id = _fund_id and r.case_id = _case_id and r.run_id = v_screening_run
       order by r.created_at desc
       limit 1),
      v_screening
    ) into v_screening;
  end if;

  if v_config is null then
    select v.id into v_config
    from public.fund_config_versions v
    where v.fund_id = _fund_id and v.status = 'active'
    limit 1;
  end if;

  select rec.overall_score into v_deep
  from public.analysis_runs ar
  join public.recommendations rec on rec.run_id = ar.id
  where ar.case_id = _case_id and ar.fund_id = _fund_id and ar.kind = 'deep'
    and ar.status = 'complete'
    and ar.completed_at is not null
  order by ar.completed_at desc
  limit 1;

  -- De gamle kolonner læses af de nuværende sider, indtil R-4 bygger dem om.
  v_workspace := case
    when v_status = 'on_hold' then 'on_hold'
    when v_status = 'closed' then 'archived'
    when v_phase = 'screening' then 'screening'
    else 'deep_analysis'
  end;
  v_process := case
    when v_status = 'invested' then 'invested'
    when v_status = 'closed' then 'closed_without_investment'
    when v_phase = 'committee' then 'investment_committee'
    when v_case.process_stage in (
      'investment_memo', 'investment_committee', 'invested', 'closed_without_investment'
    ) then 'new_case'
    else v_case.process_stage
  end;

  perform set_config('interlect.case_transition', 'on', true);
  update public.cases c
  set phase = v_phase,
      status = v_status,
      last_action_at = now(),
      updated_at = now(),
      workspace_status = v_workspace,
      workspace_reason = v_reason,
      workspace_changed_at = now(),
      deep_analysis_requested_at = case
        when v_phase = 'deep_analysis' and v_case.phase <> 'deep_analysis' then now()
        else c.deep_analysis_requested_at
      end,
      archived_at = case when v_status = 'closed' then now() else null end,
      process_stage = v_process
  where c.id = _case_id and c.fund_id = _fund_id;
  perform set_config('interlect.case_transition', 'off', true);

  insert into public.case_transition_events (
    fund_id, case_id, field, actor_type, actor_id, previous_value, new_value, reason, note,
    movement_kind, reason_codes, reason_confidence, config_version_id, screening_score,
    deep_score, from_phase, to_phase, from_status, to_status, batch_id, undo_of,
    analysis_run_id
  )
  values (
    _fund_id, _case_id, v_field, _actor_type, _actor_id, v_previous, v_new, v_reason, v_note,
    v_kind, v_codes,
    case when cardinality(v_codes) > 0 and _actor_type = 'user' then 'user' end,
    v_config, v_screening, v_deep, v_case.phase, v_phase, v_case.status, v_status,
    _batch_id, _undo_of, _analysis_run_id
  )
  returning id into v_event;

  return query select v_event, true, v_case.phase, v_case.status, v_phase, v_status, v_kind;
end;
$$;

revoke all on function public.transition_case(
  uuid, uuid, uuid, public.case_phase, public.case_status, text[], text, uuid,
  public.audit_actor_type, public.case_phase, uuid, text, uuid, public.case_status
) from public, anon, authenticated;
grant execute on function public.transition_case(
  uuid, uuid, uuid, public.case_phase, public.case_status, text[], text, uuid,
  public.audit_actor_type, public.case_phase, uuid, text, uuid, public.case_status
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Fortryd: vinduet måles fra batchens seneste overgang
-- ---------------------------------------------------------------------------

create or replace function public.undo_case_transitions(
  _fund_id uuid,
  _actor_id uuid,
  _batch_id uuid,
  _window_seconds integer default 7
)
returns table (case_id uuid, undone boolean, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  e record;
  v_result record;
  v_undo_batch uuid := gen_random_uuid();
  v_last timestamptz;
begin
  select max(t.occurred_at) into v_last
  from public.case_transition_events t
  where t.fund_id = _fund_id and t.batch_id = _batch_id and t.actor_id = _actor_id
    and t.undo_of is null;
  if v_last is null or v_last <= now() - make_interval(secs => _window_seconds) then
    return;
  end if;

  for e in
    select t.*
    from public.case_transition_events t
    where t.fund_id = _fund_id
      and t.batch_id = _batch_id
      and t.actor_id = _actor_id
      and t.undo_of is null
      and t.field in ('phase', 'status')
      and not exists (
        select 1 from public.case_transition_events u where u.undo_of = t.id
      )
    order by t.occurred_at desc, t.id desc
  loop
    -- Kun hvis casen stadig står, hvor overgangen efterlod den. transition_case låser casen og
    -- tjekker den forventede fase og status i samme transaktion, så en ændring, der når at
    -- blive gemt imellem, ikke rulles tilbage (harden G10).
    select * into v_result
    from public.transition_case(
      _fund_id, e.case_id, _actor_id, e.from_phase, e.from_status, '{}'::text[], 'Fortrudt',
      v_undo_batch, 'user', e.to_phase, null, 'system', e.id, e.to_status
    );
    if v_result.changed then
      return query select e.case_id, true, v_result.event_id;
    else
      return query select e.case_id, false, null::uuid;
    end if;
  end loop;
end;
$$;

revoke all on function public.undo_case_transitions(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.undo_case_transitions(uuid, uuid, uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Hvem slettede en opgave
-- ---------------------------------------------------------------------------

alter table public.case_tasks
  add column deleted_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Kun serveren skriver i disse tabeller
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger on
  public.case_tasks,
  public.case_score_recalculations,
  public.case_messages,
  public.brain_reason_codes,
  public.case_transition_events
from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.brain_case_decisions
  from authenticated;

-- ---------------------------------------------------------------------------
-- 5. delete_fund låser fonden først
-- ---------------------------------------------------------------------------

create or replace function public.delete_fund(_fund_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nye analyser og cases i fonden venter på låsen (deres fremmednøgle til funds tager en
  -- delt lås), så intet nyt kan blokere sletningen midt i den.
  perform 1 from public.funds f where f.id = _fund_id for update;
  if not found then
    raise exception 'Fonden blev ikke fundet.';
  end if;
  perform set_config('interlect.deleting_fund', _fund_id::text, true);
  delete from public.financial_data_points where fund_id = _fund_id;
  delete from public.analysis_runs where fund_id = _fund_id;
  delete from public.scanner_signals where fund_id = _fund_id;
  delete from public.scanner_runs where fund_id = _fund_id;
  delete from public.funds where id = _fund_id;
  if not found then
    raise exception 'Fonden blev ikke fundet.';
  end if;
  perform set_config('interlect.deleting_fund', '', true);
end;
$$;

revoke all on function public.delete_fund(uuid) from public, anon, authenticated;
grant execute on function public.delete_fund(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Den ansvarlige skal være medlem: fast fejlkode
-- ---------------------------------------------------------------------------

create or replace function public.case_tasks_check_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not public.is_fund_member(new.assignee_id, new.fund_id) then
    raise exception 'Den ansvarlige er ikke medlem af investeringstesen.' using errcode = 'IL001';
  end if;
  return new;
end;
$$;

revoke all on function public.case_tasks_check_assignee() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Indekser og en tydelig policy
-- ---------------------------------------------------------------------------

create index if not exists case_tasks_answer_evidence_idx on public.case_tasks (answer_evidence_id)
  where answer_evidence_id is not null;
create index if not exists case_tasks_answer_document_idx on public.case_tasks (answer_document_id)
  where answer_document_id is not null;
create index if not exists case_tasks_source_run_idx on public.case_tasks (source_run_id)
  where source_run_id is not null;
create index if not exists case_score_recalculations_run_idx
  on public.case_score_recalculations (run_id);
create index if not exists case_score_recalculations_task_idx
  on public.case_score_recalculations (task_id) where task_id is not null;
create index if not exists case_messages_author_idx on public.case_messages (author_id);
create index if not exists documents_task_idx on public.documents (task_id)
  where task_id is not null;
-- case_transition_events.undo_of har allerede et unikt indeks (cte_undo_of_key, 0033).

drop policy "case_notes_insert_member" on public.case_notes;
create policy "case_notes_insert_member" on public.case_notes
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.is_fund_member((select auth.uid()), fund_id)
  and exists (
    select 1 from public.cases c
    where c.id = case_notes.case_id and c.fund_id = case_notes.fund_id
  )
);


-- ---------------------------------------------------------------------------
-- 8. Revisionsloggen kun for Admin
-- ---------------------------------------------------------------------------

drop policy "audit_select_member" on public.audit_events;
create policy "audit_select_admin" on public.audit_events
for select to authenticated
using (
  fund_id is not null
  and public.has_fund_role((select auth.uid()), fund_id, 'admin'::public.app_role)
);


-- ---------------------------------------------------------------------------
-- 9. Runde 2: flere indekser og pitch deck kun for roller med upload-ret
-- ---------------------------------------------------------------------------

create index if not exists case_transition_events_run_idx
  on public.case_transition_events (analysis_run_id) where analysis_run_id is not null;
create index if not exists case_transition_events_config_idx
  on public.case_transition_events (config_version_id) where config_version_id is not null;
create index if not exists case_tasks_deleted_by_idx on public.case_tasks (deleted_by)
  where deleted_by is not null;
create index if not exists case_tasks_resolved_by_idx on public.case_tasks (resolved_by)
  where resolved_by is not null;

create or replace function public.register_pitch_deck(
  _case_id uuid,
  _file_name text,
  _storage_path text,
  _mime_type text,
  _size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_document_id uuid;
  v_extension text;
begin
  select fund_id into v_fund_id from public.cases where id = _case_id;
  if v_fund_id is null or not public.is_fund_member(auth.uid(), v_fund_id) then
    raise exception 'Casen blev ikke fundet.';
  end if;
  -- Læser har ikke upload_document (rettighedsmatricen, R-3 §2).
  if not (
    public.has_fund_role(auth.uid(), v_fund_id, 'admin')
    or public.has_fund_role(auth.uid(), v_fund_id, 'lead')
    or public.has_fund_role(auth.uid(), v_fund_id, 'member')
  ) then
    raise exception 'Din rolle kan ikke uploade dokumenter.' using errcode = '42501';
  end if;

  v_extension := lower(split_part(_storage_path, '.', array_length(string_to_array(_storage_path, '.'), 1)));
  if split_part(_storage_path, '/', 1) <> v_fund_id::text
     or split_part(_storage_path, '/', 2) <> _case_id::text
     or v_extension not in ('pdf', 'pptx') then
    raise exception 'Ugyldig filsti.';
  end if;
  if _mime_type not in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) or _size_bytes <= 0 or _size_bytes > 52428800 then
    raise exception 'Kun PDF- og PPTX-filer op til 50 MB accepteres.';
  end if;

  insert into public.documents
    (fund_id, case_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values
    (v_fund_id, _case_id, 'pitch_deck', trim(_file_name), _storage_path, _mime_type, _size_bytes, auth.uid())
  returning id into v_document_id;
  insert into public.pitch_decks (document_id, fund_id, case_id)
  values (v_document_id, v_fund_id, _case_id);
  insert into public.case_origins (fund_id, case_id, source, is_primary, source_reference, created_by)
  values (v_fund_id, _case_id, 'pitch_deck', false, v_document_id::text, auth.uid())
  on conflict do nothing;
  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'pitch_deck_uploaded', 'documents', v_document_id,
    jsonb_build_object('case_id', _case_id, 'file_name', trim(_file_name), 'mime_type', _mime_type));
  return v_document_id;
end;
$$;

revoke all on function public.register_pitch_deck(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.register_pitch_deck(uuid, text, text, text, bigint)
  to authenticated, service_role;

commit;
