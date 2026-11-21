-- (komitémemo, spor E i 1.1, produktejeren): database og server til komitémemoen.
-- Spec: og
-- .
--
-- 1. case_memo_inputs: forslagsstillerens begrundelse og kommentarer pr. tese (én række pr. case).
-- 2. case_memo_gap_answers: svar på "Mangler før komiteen" (filled | not_needed), én pr. mangel.
-- 3. case_memo_versions: memoens versioner (prosa pr. afsnit), kladde eller godkendt. En godkendt
--    version er frosset: en trigger afviser enhver ændring og sletning, også fra serveren. En ny
--    dyb analyse giver en ny version; gamle versioner bliver.
-- Mandatkrav gemmes ikke her: de bruger case_tasks og answerCaseTask.
--
-- Alle i teamet kan læse (RLS pr. team). Kun Admin, Lead og Medlem kan skrive, og kun gennem
-- funktionerne nedenfor (Læser og andre teams kan ikke); brugere har ingen skriveret på tabellerne.
-- Fejlbeskeder er dansk med præfikset "Komitémemo:"; serveren viser dem på brugerens sprog
-- (src/lib/memo/memo.ts). Ingen AI, ingen UI. Rollback: 0132_case_memo.down.sql.

begin;

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Rettighed: Admin, Lead eller Medlem i teamet (ikke Læser, ikke en uden for teamet)
-- ---------------------------------------------------------------------------

create or replace function private.can_write_case_memo(_fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.fund_memberships m
    join public.fund_membership_roles r on r.membership_id = m.id
    where m.user_id = auth.uid()
      and m.fund_id = _fund_id
      and m.status = 'active'::public.membership_status
      and r.role in ('admin'::public.app_role, 'lead'::public.app_role, 'member'::public.app_role)
  )
$$;

revoke all on function private.can_write_case_memo(uuid) from public, anon, authenticated;

-- Casens team, efter at rettigheden er tjekket. En case i et andet team ser ud som "ikke fundet",
-- så funktionen ikke afslører, at den findes. Med _lock låses casen (versionsnumre og godkendelse
-- tages én ad gangen pr. case).
create or replace function private.case_memo_fund(_case_id uuid, _lock boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund uuid;
begin
  select c.fund_id into v_fund from public.cases c where c.id = _case_id;
  if v_fund is null or not public.is_fund_member(auth.uid(), v_fund) then
    raise exception 'Komitémemo: casen blev ikke fundet.';
  end if;
  if not private.can_write_case_memo(v_fund) then
    raise exception 'Komitémemo: kun Admin, Lead og Medlem kan skrive.';
  end if;
  if _lock then
    perform 1 from public.cases c where c.id = _case_id for no key update;
  end if;
  return v_fund;
end;
$$;

revoke all on function private.case_memo_fund(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Forslagsstillerens input
-- ---------------------------------------------------------------------------

create table public.case_memo_inputs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  -- Den, der sidst gemte forslaget.
  author_id uuid references auth.users (id) on delete set null,
  rationale text not null default '' check (char_length(rationale) <= 8000),
  -- {"<tesens nøgle>": "<kommentar>"}; kun tekst (tjekket i save_case_memo_input).
  belief_comments jsonb not null default '{}'::jsonb
    check (jsonb_typeof(belief_comments) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_memo_inputs_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade,
  constraint case_memo_inputs_one_per_case unique (case_id)
);

create index case_memo_inputs_fund_idx on public.case_memo_inputs (fund_id);
create index case_memo_inputs_author_idx on public.case_memo_inputs (author_id);

-- ---------------------------------------------------------------------------
-- 2. Svar på mangler før komiteen
-- ---------------------------------------------------------------------------

create table public.case_memo_gap_answers (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  -- Manglens nøgle fra memoGaps, fx "customer_references".
  gap_key text not null check (gap_key ~ '^[a-z0-9][a-z0-9_.:-]{0,119}$'),
  state text not null check (state in ('filled', 'not_needed')),
  -- "Ikke nødvendigt" kræver en begrundelse på mindst 10 tegn (samme regel som gate-answer.ts).
  reason text check (reason is null or char_length(reason) between 1 and 2000),
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz not null default now(),
  constraint case_memo_gap_answers_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade,
  constraint case_memo_gap_answers_one_per_gap unique (case_id, gap_key),
  constraint case_memo_gap_answers_not_needed_reason
    check (state <> 'not_needed' or char_length(btrim(coalesce(reason, ''))) >= 10)
);

create index case_memo_gap_answers_fund_idx on public.case_memo_gap_answers (fund_id);
create index case_memo_gap_answers_answered_by_idx on public.case_memo_gap_answers (answered_by);

-- ---------------------------------------------------------------------------
-- 3. Memoens versioner
-- ---------------------------------------------------------------------------

create table public.case_memo_versions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  case_id uuid not null,
  -- Den dybe analyse, memoen bygger på. En kladde følger med, hvis analysen slettes; en godkendt
  -- version afviser det (triggeren nedenfor), undtagen når casen eller teamet slettes.
  analysis_run_id uuid not null,
  version integer not null check (version >= 1),
  -- {"<afsnit>": "<prosa>"}; kun tekst (tal og grafer kommer fra koden, R1).
  sections jsonb not null default '{}'::jsonb check (jsonb_typeof(sections) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  constraint case_memo_versions_case_same_fund
    foreign key (case_id, fund_id) references public.cases (id, fund_id) on delete cascade,
  constraint case_memo_versions_run_same_fund
    foreign key (analysis_run_id, fund_id) references public.analysis_runs (id, fund_id)
    on delete cascade,
  constraint case_memo_versions_number unique (case_id, version),
  constraint case_memo_versions_approved_pair check ((status = 'approved') = (approved_at is not null))
);

-- Højst én kladde pr. case og analyse: et nyt udkast til samme analyse retter kladden.
create unique index case_memo_versions_one_draft_idx
  on public.case_memo_versions (case_id, analysis_run_id)
  where status = 'draft';
create index case_memo_versions_fund_idx on public.case_memo_versions (fund_id, case_id, version desc);
create index case_memo_versions_run_idx on public.case_memo_versions (analysis_run_id);
create index case_memo_versions_created_by_idx on public.case_memo_versions (created_by);
create index case_memo_versions_approved_by_idx on public.case_memo_versions (approved_by);

-- En godkendt version er frosset. Nye rækker er altid kladder (godkendelse sker kun gennem
-- approve_case_memo_version). En kladdes nøgle (team, case, analyse, nummer) ændres aldrig.
-- Undtagelser: sletning af casen eller teamet (casens eller teamets række er da allerede væk,
-- eller delete_fund er i gang), og at en slettet bruger bliver null. At slette analysen alene
-- fjerner aldrig en godkendt version (kaskaden afvises her). "Nulstil demo" kører med alle vagter
-- og melder en afvist række, som den gør ved faser.
create or replace function public.case_memo_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_at is not null or new.approved_by is not null then
      raise exception 'Komitémemo: en ny version er altid en kladde.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'draft'
       or not exists (select 1 from public.cases c where c.id = old.case_id)
       or not exists (select 1 from public.funds f where f.id = old.fund_id)
       or current_setting('interlect.deleting_fund', true) = old.fund_id::text then
      return old;
    end if;
    raise exception 'Komitémemo: en godkendt version kan ikke ændres.';
  end if;

  if old.status = 'approved' then
    -- Kun fremmednøglens "set null", når en bruger slettes.
    if pg_trigger_depth() > 1
       and (to_jsonb(new) - 'created_by' - 'approved_by')
         = (to_jsonb(old) - 'created_by' - 'approved_by')
       and (new.created_by is null or new.created_by = old.created_by)
       and (new.approved_by is null or new.approved_by = old.approved_by) then
      return new;
    end if;
    raise exception 'Komitémemo: en godkendt version kan ikke ændres.';
  end if;

  if new.id <> old.id
     or new.fund_id <> old.fund_id
     or new.case_id <> old.case_id
     or new.analysis_run_id <> old.analysis_run_id
     or new.version <> old.version
     or new.created_at <> old.created_at then
    raise exception 'Komitémemo: versionens nøgle kan ikke ændres.';
  end if;
  return new;
end;
$$;

revoke all on function public.case_memo_versions_guard() from public, anon, authenticated;

create trigger case_memo_versions_guard
before insert or update or delete on public.case_memo_versions
for each row execute function public.case_memo_versions_guard();

-- ---------------------------------------------------------------------------
-- Adgang: alle i teamet læser; ingen skriveret for brugere (kun funktionerne skriver)
-- ---------------------------------------------------------------------------

revoke all on table public.case_memo_inputs, public.case_memo_gap_answers,
  public.case_memo_versions from public, anon, authenticated;
grant select on table public.case_memo_inputs, public.case_memo_gap_answers,
  public.case_memo_versions to authenticated;
grant all on table public.case_memo_inputs, public.case_memo_gap_answers,
  public.case_memo_versions to service_role;
-- TRUNCATE springer rækketriggere over og ville kunne tømme de frosne versioner.
revoke truncate on table public.case_memo_versions from service_role;

alter table public.case_memo_inputs enable row level security;
alter table public.case_memo_gap_answers enable row level security;
alter table public.case_memo_versions enable row level security;

create policy case_memo_inputs_select_member on public.case_memo_inputs
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy case_memo_gap_answers_select_member on public.case_memo_gap_answers
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy case_memo_versions_select_member on public.case_memo_versions
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

create policy mfa_required on public.case_memo_inputs as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy mfa_required on public.case_memo_gap_answers as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
create policy mfa_required on public.case_memo_versions as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- ---------------------------------------------------------------------------
-- Funktionerne (kaldes af serveren med brugerens egen session: auth.uid() er brugeren)
-- ---------------------------------------------------------------------------

-- Gem forslaget: begrundelse og kommentarer pr. tese. Returnerer rækkens id.
create or replace function public.save_case_memo_input(
  _case_id uuid,
  _rationale text,
  _belief_comments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund uuid;
  v_comments jsonb := coalesce(_belief_comments, '{}'::jsonb);
  v_rationale text := coalesce(_rationale, '');
  v_id uuid;
begin
  v_fund := private.case_memo_fund(_case_id, false);
  if char_length(v_rationale) > 8000 then
    raise exception 'Komitémemo: begrundelsen er for lang.';
  end if;
  -- Typen først i sin egen if: SQL lover ingen rækkefølge i "or", og jsonb_each fejler på andet
  -- end et objekt.
  if jsonb_typeof(v_comments) <> 'object' then
    raise exception 'Komitémemo: kommentarerne til teserne er ugyldige.';
  end if;
  if (select count(*) from jsonb_each(v_comments)) > 50
     or exists (
       select 1 from jsonb_each(v_comments) e
       where char_length(e.key) not between 1 and 120
          or jsonb_typeof(e.value) <> 'string'
          or char_length(e.value #>> '{}') > 2000
     ) then
    raise exception 'Komitémemo: kommentarerne til teserne er ugyldige.';
  end if;

  insert into public.case_memo_inputs (fund_id, case_id, author_id, rationale, belief_comments)
  values (v_fund, _case_id, auth.uid(), v_rationale, v_comments)
  on conflict (case_id) do update
    set author_id = excluded.author_id,
        rationale = excluded.rationale,
        belief_comments = excluded.belief_comments,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_case_memo_input(uuid, text, jsonb) from public, anon;
grant execute on function public.save_case_memo_input(uuid, text, jsonb) to authenticated;

-- Svar på en mangel: "filled" (udfyldt) eller "not_needed" (med begrundelse). Et nyt svar
-- erstatter det forrige. Returnerer svarets id.
create or replace function public.answer_case_memo_gap(
  _case_id uuid,
  _gap_key text,
  _state text,
  _reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund uuid;
  v_reason text := nullif(btrim(coalesce(_reason, '')), '');
  v_id uuid;
begin
  v_fund := private.case_memo_fund(_case_id, false);
  if _gap_key is null or _gap_key !~ '^[a-z0-9][a-z0-9_.:-]{0,119}$' then
    raise exception 'Komitémemo: manglens nøgle er ugyldig.';
  end if;
  if _state is null or _state not in ('filled', 'not_needed') then
    raise exception 'Komitémemo: ukendt svar på en mangel.';
  end if;
  if _state = 'not_needed' and char_length(coalesce(v_reason, '')) < 10 then
    raise exception 'Komitémemo: skriv en begrundelse på mindst 10 tegn.';
  end if;
  if char_length(coalesce(v_reason, '')) > 2000 then
    raise exception 'Komitémemo: begrundelsen for manglen er for lang.';
  end if;

  insert into public.case_memo_gap_answers (fund_id, case_id, gap_key, state, reason, answered_by)
  values (v_fund, _case_id, _gap_key, _state, v_reason, auth.uid())
  on conflict (case_id, gap_key) do update
    set state = excluded.state,
        reason = excluded.reason,
        answered_by = excluded.answered_by,
        answered_at = now()
  returning id into v_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund, 'user', auth.uid(), 'case_memo_gap_answered', 'case_memo_gap_answers', v_id,
    jsonb_build_object('case_id', _case_id, 'gap_key', _gap_key, 'state', _state));
  return v_id;
end;
$$;

revoke all on function public.answer_case_memo_gap(uuid, text, text, text) from public, anon;
grant execute on function public.answer_case_memo_gap(uuid, text, text, text) to authenticated;

-- Opret (eller ret) en kladde til en færdig dyb analyse af casen. Findes der allerede en kladde
-- til samme analyse, får den de nye afsnit; ellers bliver det næste version. Returnerer versionens id.
create or replace function public.create_case_memo_draft(
  _case_id uuid,
  _analysis_run_id uuid,
  _sections jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund uuid;
  v_sections jsonb := coalesce(_sections, '{}'::jsonb);
  v_run record;
  v_id uuid;
  v_version integer;
begin
  v_fund := private.case_memo_fund(_case_id, true);
  select r.case_id, r.fund_id, r.kind, r.status into v_run
  from public.analysis_runs r where r.id = _analysis_run_id;
  if not found then
    raise exception 'Komitémemo: analysen hører ikke til casen.';
  end if;
  if v_run.case_id <> _case_id or v_run.fund_id <> v_fund then
    raise exception 'Komitémemo: analysen hører ikke til casen.';
  end if;
  if v_run.kind <> 'deep'::public.analysis_kind
     or v_run.status <> 'complete'::public.analysis_run_status then
    raise exception 'Komitémemo: memoen bygger på en færdig dyb analyse.';
  end if;
  if jsonb_typeof(v_sections) <> 'object' then
    raise exception 'Komitémemo: afsnittene skal være tekst.';
  end if;
  if (select count(*) from jsonb_each(v_sections)) > 40
     or exists (
       select 1 from jsonb_each(v_sections) e
       where e.key !~ '^[a-z0-9_]{1,60}$'
          or jsonb_typeof(e.value) <> 'string'
          or char_length(e.value #>> '{}') > 20000
     ) then
    raise exception 'Komitémemo: afsnittene skal være tekst.';
  end if;

  update public.case_memo_versions
  set sections = v_sections, updated_at = now()
  where case_id = _case_id and analysis_run_id = _analysis_run_id and status = 'draft'
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version
  from public.case_memo_versions v where v.case_id = _case_id;

  insert into public.case_memo_versions (fund_id, case_id, analysis_run_id, version, sections,
    created_by)
  values (v_fund, _case_id, _analysis_run_id, v_version, v_sections, auth.uid())
  returning id into v_id;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund, 'user', auth.uid(), 'case_memo_draft_created', 'case_memo_versions', v_id,
    jsonb_build_object('case_id', _case_id, 'version', v_version,
      'analysis_run_id', _analysis_run_id));
  return v_id;
end;
$$;

revoke all on function public.create_case_memo_draft(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_case_memo_draft(uuid, uuid, jsonb) to authenticated;

-- Godkend en kladde: versionen fryses (triggeren afviser alle senere ændringer).
create or replace function public.approve_case_memo_version(_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.case_memo_versions%rowtype;
begin
  select * into v_version from public.case_memo_versions where id = _version_id;
  if v_version.id is null or not public.is_fund_member(auth.uid(), v_version.fund_id) then
    raise exception 'Komitémemo: versionen blev ikke fundet.';
  end if;
  perform private.case_memo_fund(v_version.case_id, true);
  -- Læst igen efter låsen: en anden kan have godkendt imens.
  select * into v_version from public.case_memo_versions where id = _version_id;
  if not found then
    raise exception 'Komitémemo: versionen blev ikke fundet.';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'Komitémemo: versionen er allerede godkendt.';
  end if;

  update public.case_memo_versions
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = _version_id and status = 'draft';
  if not found then
    raise exception 'Komitémemo: versionen blev ikke fundet.';
  end if;

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_version.fund_id, 'user', auth.uid(), 'case_memo_approved', 'case_memo_versions',
    _version_id, jsonb_build_object('case_id', v_version.case_id, 'version', v_version.version,
      'analysis_run_id', v_version.analysis_run_id));
end;
$$;

revoke all on function public.approve_case_memo_version(uuid) from public, anon;
grant execute on function public.approve_case_memo_version(uuid) to authenticated;

commit;
