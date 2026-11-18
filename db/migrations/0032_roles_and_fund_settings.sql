-- Redesignet: roller omdøbes til Admin, Lead, Medlem og Læser,
-- og fonden får to indstillinger for, hvad et Medlem må. Plan:
-- (0032) og gap-analysen
--
-- 1. Enum-værdierne omdøbes. Policies gemmer rollen som værdi og følger automatisk med;
--    eksisterende medlemskaber og invitationer beholder deres rolle under det nye navn.
-- 2. Funktioner gemmer deres krop som tekst, så de omskrives mekanisk. Migrationen fejler,
--    hvis et gammelt rollenavn står tilbage i en funktion i public, så intet ændres halvt.
--    'administrator_configuration' er en kildetype (ikke en rolle) og røres ikke.
-- 3. funds får member_can_decide og member_can_publish (standard fra). Kun serveren
--    ændrer dem; brugere kan kun rette fondens navn direkte.
-- 4. Nye hjælpere i skemaet private (ikke eksponeret over API'et): can_publish_fund_config og
--    can_decide_case. Udgivelse af fondsopsætningen følger can_publish_fund_config.
--    public.seat_usage kan kun kaldes af serveren (service_role).
-- 5. Alle aktive medlemmer, også Læsere, må skrive noter (write_notes).
--
-- Pladser tælles pr. installation; grænserne er miljøvariabler i appen.

begin;

set local search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Roller
-- ---------------------------------------------------------------------------

alter type public.app_role rename value 'administrator' to 'admin';
alter type public.app_role rename value 'partner' to 'lead';
alter type public.app_role rename value 'analyst' to 'member';
alter type public.app_role rename value 'observer' to 'reader';

-- ---------------------------------------------------------------------------
-- 2. Funktioner med rollenavne som tekst
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
  definition text;
  changed integer := 0;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosrc ~* '(administrator|partner|analyst|observer)'
  loop
    definition := pg_get_functiondef(f.oid);
    definition := replace(definition, '''administrator''', '''admin''');
    definition := replace(definition, '''partner''', '''lead''');
    definition := replace(definition, '''analyst''', '''member''');
    definition := replace(definition, '''observer''', '''reader''');
    definition := replace(definition, 'Kun en administrator eller partner kan', 'Kun en Admin eller Lead kan');
    definition := replace(definition, 'Kun en administrator kan', 'Kun en Admin kan');
    definition := replace(definition, 'mindst én aktiv administrator', 'mindst én aktiv Admin');
    execute definition;
    changed := changed + 1;
  end loop;

  if changed < 9 then
    raise exception 'Forventede mindst 9 funktioner med rollenavne, fandt %.', changed;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ '''(administrator|partner|analyst|observer)'''
  ) then
    raise exception 'En funktion i public bruger stadig et gammelt rollenavn.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Fondens indstillinger
-- ---------------------------------------------------------------------------

alter table public.funds
  add column member_can_decide boolean not null default false,
  add column member_can_publish boolean not null default false;

comment on column public.funds.member_can_decide is
  'Medlem må beslutte investeret eller luk (Phillip 28. sep: standard fra). Ændres kun af serveren.';
comment on column public.funds.member_can_publish is
  'Medlem må udgive fondsopsætningen (Phillip 28. sep: standard fra). Ændres kun af serveren.';

-- Brugere må kun rette fondens navn direkte (policyen funds_update_admin kræver stadig Admin).
-- Indstillingerne ændres af en server-funktion efter et rettighedstjek.
revoke update on public.funds from authenticated;
grant update (name, updated_at) on public.funds to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rettighedshjælpere i private (kan ikke kaldes over API'et) og pladsoptælling
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Udgivelse: Admin og Lead altid, Medlem kun når fonden har slået det til.
create or replace function private.can_publish_fund_config(_user_id uuid, _fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_fund_role(_user_id, _fund_id, 'admin')
      or public.has_fund_role(_user_id, _fund_id, 'lead')
      or (
        public.has_fund_role(_user_id, _fund_id, 'member')
        and exists (select 1 from public.funds f where f.id = _fund_id and f.member_can_publish)
      );
$$;

-- Beslutning (investeret eller luk): Admin og Lead altid, Medlem kun når fonden har slået det til.
create or replace function private.can_decide_case(_user_id uuid, _fund_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_fund_role(_user_id, _fund_id, 'admin')
      or public.has_fund_role(_user_id, _fund_id, 'lead')
      or (
        public.has_fund_role(_user_id, _fund_id, 'member')
        and exists (select 1 from public.funds f where f.id = _fund_id and f.member_can_decide)
      );
$$;

-- Pladser pr. installation, talt som unikke personer (e-mail): Admin, Lead og Medlem bruger
-- en plads, en person med kun Læser tæller som læser. Afventende invitationer reserverer.
-- Ligger i public, så serveren kan kalde den over API'et; kun service_role har EXECUTE.
-- Med _email fortæller den også, om personen allerede tæller (så en invitation til en
-- person, der allerede har en plads, ikke tælles dobbelt).
create or replace function public.seat_usage(_email text default null)
returns table (
  seats_used integer,
  readers_used integer,
  email_uses_seat boolean,
  email_is_reader boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    -- Nøglen er e-mailen (så en invitation og et medlemskab er samme person); findes den
    -- ikke, tæller brugeren alligevel med sit id, så ingen falder ud af optællingen.
    select coalesce(p.email_normalized, lower(u.email), m.user_id::text) as person,
           r.role <> 'reader'::public.app_role as uses_seat
    from public.fund_memberships m
    join public.fund_membership_roles r on r.membership_id = m.id
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.status = 'active'::public.membership_status
    union all
    select i.email_normalized, role <> 'reader'::public.app_role
    from public.invitations i
    cross join lateral unnest(i.roles) as role
    where i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
  ),
  per_person as (
    select person, bool_or(uses_seat) as uses_seat from people group by person
  )
  select
    (count(*) filter (where uses_seat))::integer,
    (count(*) filter (where not uses_seat))::integer,
    coalesce(bool_or(uses_seat) filter (where person = lower(trim(_email))), false),
    coalesce(bool_or(not uses_seat) filter (where person = lower(trim(_email))), false)
  from per_person;
$$;

revoke all on function private.can_publish_fund_config(uuid, uuid) from public, anon;
revoke all on function private.can_decide_case(uuid, uuid) from public, anon;
revoke all on function public.seat_usage(text) from public, anon, authenticated;
grant execute on function private.can_publish_fund_config(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_decide_case(uuid, uuid) to authenticated, service_role;
grant execute on function public.seat_usage(text) to service_role;

-- Udgivelse følger nu can_publish_fund_config i stedet for can_configure_fund.
do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.activate_fund_config(uuid)'::regprocedure);
  if definition not like '%public.can_configure_fund(auth.uid(), v_fund_id)%' then
    raise exception 'activate_fund_config har ikke den forventede rettighedskontrol.';
  end if;
  definition := replace(
    definition,
    'public.can_configure_fund(auth.uid(), v_fund_id)',
    'private.can_publish_fund_config(auth.uid(), v_fund_id)'
  );
  definition := replace(
    definition,
    'Kun en Admin eller Lead kan publicere en fondsprofil.',
    'Din rolle kan ikke udgive fondsopsætningen.'
  );
  execute definition;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Noter: alle aktive medlemmer (også Læser) må skrive; stadig kun egne og append-only.
-- ---------------------------------------------------------------------------

drop policy "case_notes_insert_team" on public.case_notes;
create policy "case_notes_insert_member" on public.case_notes
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.is_fund_member((select auth.uid()), fund_id)
  and exists (
    select 1 from public.cases c where c.id = case_id and c.fund_id = case_notes.fund_id
  )
);

commit;
