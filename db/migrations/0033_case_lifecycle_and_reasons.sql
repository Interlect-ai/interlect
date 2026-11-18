-- Redesignet: de 13 procestrin bliver til 4 faser + status, og hver
-- bevægelse logges med hvem, hvornår, årsager og note. Plan:
-- (0033) og Brain-planen.
--
-- 1. cases får phase, status og last_action_at. Eksisterende cases udfyldes med
--    case_lifecycle_from_legacy (kan efterregnes). "Afventer beslutning" er afledt:
--    phase = 'committee' og status = 'active'. Fasen 'decided' hører altid sammen med status
--    'closed' eller 'invested' (check).
-- 2. Fase og status ændres kun af transition_case (kun service_role), som låser casen, tjekker
--    rettigheder, skriver loggen og holder de gamle kolonner workspace_status/process_stage i trit,
--    så de nuværende sider virker til. En trigger afviser alle andre ændringer, også fra
--    server-kode. Brugere kan ikke længere oprette eller rette cases direkte (alt går allerede
--    gennem serveren eller security definer-funktioner).
-- 3. case_transition_events udvides med movement_kind, årsager, note, fase/status før og efter,
--    score, opsætningsversion, batch og fortryd. Loggen er append-only.
-- 4. brain_reason_codes med standardsættet for hver fond (også nye fonde, via trigger).
-- 5. undo_case_transitions fortryder en batch inden for få sekunder (omvendt overgang, logget).
-- 6. last_action_at følger overgange, noter og kørsler (trigger).
-- 7. View brain_case_decisions (security invoker).
-- 8. unique (id, fund_id) på cases, companies og fund_config_versions (samme-fond-reglen).

begin;

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Fase, status og sidste handling
-- ---------------------------------------------------------------------------

create type public.case_phase as enum ('screening', 'deep_analysis', 'committee', 'decided');
create type public.case_status as enum ('active', 'on_hold', 'closed', 'invested');

-- Én sandhed for oversættelsen fra de gamle kolonner (gap-analysen afsnit 3).
create or replace function public.case_lifecycle_from_legacy(
  _workspace public.case_workspace_status,
  _process public.investment_process_stage,
  _has_deep_run boolean
)
returns table (phase public.case_phase, status public.case_status)
language sql
immutable
set search_path = ''
as $$
  select
    case
      when _process = 'invested' then 'decided'
      when _process = 'closed_without_investment' or _workspace = 'archived' then 'decided'
      when _process in ('investment_memo', 'investment_committee') then 'committee'
      when _workspace = 'on_hold' and _has_deep_run then 'deep_analysis'
      when _workspace = 'on_hold' then 'screening'
      when _workspace = 'deep_analysis' then 'deep_analysis'
      else 'screening'
    end::public.case_phase,
    case
      when _process = 'invested' then 'invested'
      when _process = 'closed_without_investment' or _workspace = 'archived' then 'closed'
      when _workspace = 'on_hold' then 'on_hold'
      else 'active'
    end::public.case_status
$$;

alter table public.cases
  add column phase public.case_phase,
  add column status public.case_status,
  add column last_action_at timestamptz;

update public.cases c
set (phase, status) = (
      select l.phase, l.status
      from public.case_lifecycle_from_legacy(
        c.workspace_status,
        c.process_stage,
        exists (select 1 from public.analysis_runs r where r.case_id = c.id and r.kind = 'deep')
      ) as l
    ),
    -- "Dage uden handling" starter fra casens seneste rigtige handling, ikke fra i dag.
    last_action_at = greatest(
      c.created_at,
      (select max(e.occurred_at) from public.case_transition_events e where e.case_id = c.id),
      (select max(n.created_at) from public.case_notes n where n.case_id = c.id),
      (select max(r.created_at) from public.analysis_runs r where r.case_id = c.id)
    );

alter table public.cases
  alter column phase set default 'screening',
  alter column phase set not null,
  alter column status set default 'active',
  alter column status set not null,
  alter column last_action_at set default now(),
  alter column last_action_at set not null,
  add constraint cases_decided_has_final_status
    check ((phase = 'decided') = (status in ('closed', 'invested')));

create index cases_fund_phase_status_idx
  on public.cases (fund_id, phase, status, last_action_at desc);

-- ---------------------------------------------------------------------------
-- 8. Samme-fond-reglen: sammensatte nøgler kan pege på (id, fund_id)
-- ---------------------------------------------------------------------------

alter table public.cases add constraint cases_id_fund_key unique (id, fund_id);
alter table public.companies add constraint companies_id_fund_key unique (id, fund_id);
alter table public.fund_config_versions
  add constraint fund_config_versions_id_fund_key unique (id, fund_id);

-- ---------------------------------------------------------------------------
-- 2a. Brugere skriver ikke længere direkte i cases
-- ---------------------------------------------------------------------------

drop policy "cases_insert_team" on public.cases;
drop policy "cases_update_team" on public.cases;
revoke insert, update, delete on public.cases from authenticated;

-- Fase og status ændres kun gennem transition_case, uanset hvem der skriver.
create or replace function public.guard_case_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('interlect.case_transition', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.phase <> 'screening'::public.case_phase or new.status <> 'active'::public.case_status then
      raise exception 'En ny case starter i Screening som Aktiv.';
    end if;
  elsif new.phase is distinct from old.phase or new.status is distinct from old.status then
    raise exception 'Fase og status ændres kun gennem en logget overgang (transition_case).';
  end if;
  return new;
end;
$$;

create trigger cases_guard_lifecycle
before insert or update of phase, status on public.cases
for each row execute function public.guard_case_lifecycle();

-- ---------------------------------------------------------------------------
-- 3. Overgangsloggen
-- ---------------------------------------------------------------------------

alter table public.case_transition_events
  drop constraint case_transition_events_field_check;
alter table public.case_transition_events
  add constraint case_transition_events_field_check check (field in (
    'execution_status', 'pap_recommendation', 'process_stage',
    'mandate_gate_override', 'workspace_status', 'phase', 'status'
  ));

alter table public.case_transition_events
  add column movement_kind text,
  add column reason_codes text[] not null default '{}',
  add column reason_confidence text
    check (reason_confidence in ('user', 'ai_suggested_confirmed')),
  add column config_version_id uuid,
  add column screening_score numeric,
  add column deep_score numeric,
  add column note text check (note is null or char_length(note) <= 2000),
  add column from_phase public.case_phase,
  add column to_phase public.case_phase,
  add column from_status public.case_status,
  add column to_status public.case_status,
  add column batch_id uuid,
  add column undo_of uuid,
  add constraint case_transition_events_config_same_fund
    foreign key (config_version_id, fund_id)
    references public.fund_config_versions (id, fund_id)
    on delete set null (config_version_id);

-- Én sandhed for bevægelsestypen (Brain §2.2); src/lib/brain/movement.ts spejler den, og
-- npm run test:rls sammenligner de to.
create or replace function public.brain_movement_kind(
  _field text,
  _previous text,
  _new text,
  _from_phase text default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when _field = 'status' then case
      when _new = 'on_hold' then 'hold'
      when _new = 'closed' and _from_phase = 'committee' then 'decline_ic'
      when _new = 'closed' then 'reject'
      when _new = 'invested' then 'invest'
      when _new = 'active' and _previous in ('closed', 'invested', 'on_hold') then 'reopen'
      else 'system'
    end
    when _field = 'phase' then case
      when array_position(array['screening', 'deep_analysis', 'committee', 'decided'], _new)
         > array_position(array['screening', 'deep_analysis', 'committee', 'decided'], _previous)
        then 'advance'
      else 'system'
    end
    when _field = 'process_stage' then case
      when _new = 'closed_without_investment' and _previous = 'investment_committee' then 'decline_ic'
      when _new = 'closed_without_investment' then 'reject'
      when _new = 'invested' then 'invest'
      when _previous = 'closed_without_investment' then 'reopen'
      when array_position(array[
          'new_case', 'initial_screening', 'preliminary_analysis', 'partner_review',
          'ready_for_contact', 'contacted', 'first_meeting', 'further_evaluation',
          'due_diligence', 'investment_memo', 'investment_committee'], _new)
        > array_position(array[
          'new_case', 'initial_screening', 'preliminary_analysis', 'partner_review',
          'ready_for_contact', 'contacted', 'first_meeting', 'further_evaluation',
          'due_diligence', 'investment_memo', 'investment_committee'], _previous)
        then 'advance'
      -- further_evaluation → partner_review er et skridt frem i den gamle proces (Brain §2.2).
      when _previous = 'further_evaluation' and _new = 'partner_review' then 'advance'
      else 'system'
    end
    when _field = 'workspace_status' then case
      when _new = 'on_hold' then 'hold'
      when _previous = 'on_hold' and _new in ('screening', 'deep_analysis') then 'reopen'
      when _previous = 'screening' and _new = 'deep_analysis' then 'advance'
      else 'system'
    end
    else 'system'
  end
$$;

-- Eksisterende rækker og de gamle indsættelsessteder får bevægelsestypen automatisk.
update public.case_transition_events
set movement_kind = public.brain_movement_kind(field, previous_value, new_value, null);

alter table public.case_transition_events
  alter column movement_kind set not null,
  add constraint case_transition_events_movement_kind_check check (movement_kind in (
    'advance', 'hold', 'reject', 'decline_ic', 'invest', 'reopen', 'system'
  ));

create or replace function public.set_case_transition_movement_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.movement_kind is null then
    new.movement_kind := public.brain_movement_kind(
      new.field, new.previous_value, new.new_value, new.from_phase::text
    );
  end if;
  return new;
end;
$$;

create trigger case_transition_events_movement_kind
before insert on public.case_transition_events
for each row execute function public.set_case_transition_movement_kind();

-- Append-only: sletning kun som cascade (case eller fond slettes), ændring kun af årsagerne
-- (senere AI-forslag) eller af GDPR-funktionerne (brain.gdpr = 'on').
create or replace function public.case_transition_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1
       or not exists (select 1 from public.cases c where c.id = old.case_id) then
      return old;
    end if;
    raise exception 'Overgangsloggen kan ikke slettes.';
  end if;
  if coalesce(current_setting('brain.gdpr', true), '') = 'on' then
    return new;
  end if;
  if (to_jsonb(new) - 'reason_codes' - 'reason_confidence')
     = (to_jsonb(old) - 'reason_codes' - 'reason_confidence') then
    return new;
  end if;
  raise exception 'Overgangsloggen kan ikke ændres.';
end;
$$;

create trigger case_transition_events_append_only
before update or delete on public.case_transition_events
for each row execute function public.case_transition_events_append_only();

create index cte_fund_kind_idx
  on public.case_transition_events (fund_id, movement_kind, occurred_at desc);
create index cte_reason_codes_idx on public.case_transition_events using gin (reason_codes);
create index cte_case_occurred_idx on public.case_transition_events (case_id, occurred_at desc);
create index cte_batch_idx on public.case_transition_events (fund_id, batch_id)
  where batch_id is not null;
create unique index cte_undo_of_key on public.case_transition_events (undo_of)
  where undo_of is not null;

-- ---------------------------------------------------------------------------
-- 4. Årsagskoder (Brain §2.3)
-- ---------------------------------------------------------------------------

create table public.brain_reason_codes (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  label text not null check (char_length(label) between 1 and 120),
  group_key text not null check (group_key in (
    'thesis', 'team', 'market', 'product', 'traction', 'economics',
    'timing', 'portfolio', 'process', 'positive', 'other'
  )),
  applies_to text[] not null check (
    applies_to <@ array['advance', 'hold', 'reject', 'decline_ic', 'invest', 'reopen']::text[]
  ),
  revisit boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (fund_id, code)
);

grant select on public.brain_reason_codes to authenticated;
grant all on public.brain_reason_codes to service_role;
alter table public.brain_reason_codes enable row level security;

create policy "brain_reason_codes_select_member" on public.brain_reason_codes
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

create or replace function public.seed_brain_reason_codes(_fund_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.brain_reason_codes
    (fund_id, code, label, group_key, applies_to, revisit, sort_order)
  select _fund_id, s.code, s.label, s.group_key, s.applies_to, s.revisit, s.sort_order
  from (values
    ('outside_sector', 'Uden for sektor', 'thesis', false, 10),
    ('outside_geography', 'Uden for geografi', 'thesis', false, 11),
    ('wrong_stage', 'Forkert stadie', 'thesis', true, 12),
    ('ticket_mismatch', 'Ticket passer ikke', 'thesis', false, 13),
    ('dealbreaker_hit', 'Dealbreaker ramt', 'thesis', false, 14),
    ('weak_founder_market_fit', 'Svagt founder-market fit', 'team', false, 20),
    ('missing_key_competence', 'Mangler nøglekompetence', 'team', true, 21),
    ('team_risk', 'Team-risiko', 'team', false, 22),
    ('small_market', 'For lille marked', 'market', false, 30),
    ('wrong_timing', 'Forkert timing', 'market', true, 31),
    ('strong_competition', 'Stærk konkurrence', 'market', false, 32),
    ('unclear_solution', 'Uklar løsning', 'product', false, 40),
    ('technology_risk', 'Teknologirisiko', 'product', true, 41),
    ('no_differentiation', 'Ingen differentiering', 'product', false, 42),
    ('too_early', 'For tidligt, ingen traction', 'traction', true, 50),
    ('weak_growth', 'Svag vækst', 'traction', true, 51),
    ('awaiting_milestone', 'Afventer milepæl', 'traction', true, 52),
    ('valuation_too_high', 'Værdiansættelse for høj', 'economics', true, 60),
    ('runway_risk', 'Runway/finansieringsrisiko', 'economics', false, 61),
    ('weak_financials', 'Svage nøgletal', 'economics', true, 62),
    ('portfolio_overlap', 'Overlap med eksisterende investering', 'portfolio', false, 70),
    ('portfolio_construction', 'Porteføljekonstruktion', 'portfolio', false, 71),
    ('founder_withdrew', 'Founder trak sig', 'process', false, 80),
    ('lost_to_other_investor', 'Tabt til anden investor', 'process', false, 81),
    ('deadline', 'Tidsfrist', 'process', false, 82),
    ('strong_team', 'Stærkt team', 'positive', false, 90),
    ('large_market', 'Stort marked', 'positive', false, 91),
    ('clear_traction', 'Tydelig traction', 'positive', false, 92),
    ('thesis_fit', 'Passer tesen', 'positive', false, 93),
    ('other', 'Andet', 'other', false, 100)
  ) as v(code, label, group_key, revisit, sort_order)
  cross join lateral (
    select v.code, v.label, v.group_key, v.revisit, v.sort_order,
      case
        when v.group_key = 'positive' then array['advance', 'invest', 'reopen']
        when v.group_key = 'other' then array['advance', 'hold', 'reject', 'decline_ic', 'invest', 'reopen']
        else array['hold', 'reject', 'decline_ic']
      end::text[] as applies_to
  ) as s
  on conflict (fund_id, code) do nothing;
$$;

revoke all on function public.seed_brain_reason_codes(uuid) from public, anon, authenticated;
grant execute on function public.seed_brain_reason_codes(uuid) to service_role;

create or replace function public.seed_reason_codes_for_new_fund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_brain_reason_codes(new.id);
  return null;
end;
$$;

create trigger funds_seed_reason_codes
after insert on public.funds
for each row execute function public.seed_reason_codes_for_new_fund();

select public.seed_brain_reason_codes(f.id) from public.funds f;

-- ---------------------------------------------------------------------------
-- 2b. Den eneste vej til fase og status
-- ---------------------------------------------------------------------------

-- Kaldes af server-funktionen transitionCases efter dens eget rettighedstjek; databasen tjekker
-- rollen igen ud fra _actor_id. _to_phase null = uændret; genåbning af en besluttet case
-- vender tilbage til fasen før beslutningen. _expected_phase gør en automatisk overgang
-- betinget (fx tilbage til Screening, når en dyb analyse fejler, men kun hvis casen stadig er
-- i Dyb analyse). _movement_kind kan kun tvinges til 'system' (fortryd, automatiske skift).
create or replace function public.transition_case(
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
  _undo_of uuid default null
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

  if _expected_phase is not null and v_case.phase <> _expected_phase then
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

  select v.id into v_config
  from public.fund_config_versions v
  where v.fund_id = _fund_id and v.status = 'active'
  limit 1;

  select rec.overall_score into v_screening
  from public.analysis_runs ar
  join public.recommendations rec on rec.run_id = ar.id
  where ar.case_id = _case_id and ar.fund_id = _fund_id and ar.kind = 'screening'
    and ar.completed_at is not null
  order by ar.completed_at desc
  limit 1;

  select rec.overall_score into v_deep
  from public.analysis_runs ar
  join public.recommendations rec on rec.run_id = ar.id
  where ar.case_id = _case_id and ar.fund_id = _fund_id and ar.kind = 'deep'
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
  public.audit_actor_type, public.case_phase, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.transition_case(
  uuid, uuid, uuid, public.case_phase, public.case_status, text[], text, uuid,
  public.audit_actor_type, public.case_phase, uuid, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Fortryd (5 s i UI'et + lidt ekstra tid til netværket)
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
begin
  for e in
    select t.*
    from public.case_transition_events t
    where t.fund_id = _fund_id
      and t.batch_id = _batch_id
      and t.actor_id = _actor_id
      and t.undo_of is null
      and t.field in ('phase', 'status')
      and t.occurred_at > now() - make_interval(secs => _window_seconds)
      and not exists (
        select 1 from public.case_transition_events u where u.undo_of = t.id
      )
    order by t.occurred_at desc, t.id desc
  loop
    -- Kun hvis casen stadig står, hvor overgangen efterlod den.
    if exists (
      select 1 from public.cases c
      where c.id = e.case_id and c.phase = e.to_phase and c.status = e.to_status
    ) then
      select * into v_result
      from public.transition_case(
        _fund_id, e.case_id, _actor_id, e.from_phase, e.from_status, '{}'::text[], 'Fortrudt',
        v_undo_batch, 'user', null, null, 'system', e.id
      );
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

-- Den gamle vej til at flytte en case (0007/0017) skrev kun workspace_status. Den erstattes af
-- transition_case, så ingen kan flytte en case uden om fase, status og loggen.
drop function public.move_case_workspace(uuid, uuid, public.case_workspace_status, text);

-- ---------------------------------------------------------------------------
-- 6. Sidste handling
-- ---------------------------------------------------------------------------

create or replace function public.touch_case_last_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cases c
  set last_action_at = greatest(c.last_action_at, now())
  where c.id = new.case_id;
  return null;
end;
$$;

revoke all on function public.touch_case_last_action() from public, anon, authenticated;

create trigger case_notes_touch_case
after insert on public.case_notes
for each row execute function public.touch_case_last_action();

create trigger analysis_runs_touch_case
after insert on public.analysis_runs
for each row execute function public.touch_case_last_action();

-- ---------------------------------------------------------------------------
-- 7. Beslutninger pr. case (Brain §2.4; historiske beslutninger kommer i 0044)
-- ---------------------------------------------------------------------------

create view public.brain_case_decisions
with (security_invoker = true)
as
select latest.fund_id,
       latest.case_id,
       c.company_id,
       latest.movement_kind as decision_kind,
       latest.occurred_at as decided_at,
       latest.reason_codes,
       false as is_historical
from (
  select distinct on (e.case_id) e.*
  from public.case_transition_events e
  where e.movement_kind in ('reject', 'decline_ic', 'invest', 'reopen')
     or e.undo_of is not null
  order by e.case_id, e.occurred_at desc, e.id desc
) as latest
join public.cases c on c.id = latest.case_id and c.fund_id = latest.fund_id
where latest.movement_kind in ('reject', 'decline_ic', 'invest')
  and latest.undo_of is null;

grant select on public.brain_case_decisions to authenticated, service_role;

commit;
