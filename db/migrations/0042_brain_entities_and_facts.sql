-- Brain (track C) · migration 0042 ·
-- The temporal graph: brain_entities, brain_facts (world time valid_from/valid_to plus
-- system time recorded_at/expired_at), brain_fact_episodes (source links with verified
-- quotes), same-fund guards, the deterministic projection from the database
-- (brain_project_db_entities) and the read functions brain_search_facts,
-- brain_search_entities, brain_graph_neighbors and brain_graph_path.
-- Spec: §5, §15 and.
--
-- Instance-ready (no hard-coded ids; runs in order on a fresh or the current database).
-- Depends on 0033 (unique (id, fund_id) on cases/companies, case_transition_events Brain
-- columns, brain_reason_codes) and 0041. Additive only.
--
-- Deliberately NOT done here:
--   * brain_case_decisions keeps its 0033 key (owned by track B); the switch to
--     company_entity_id moves to 0044 together with the historical decisions.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Name normalisation shared by SQL and TypeScript (src/lib/brain/keys.ts mirrors it).
-- ---------------------------------------------------------------------------
create or replace function public.brain_normalize_name(_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(_name, ''))), '\s+', ' ', 'g'),
        '[\s,.]+(aps|a/s|as|ivs|p/s|i/s|k/s|smba|ltd|limited|inc|llc|gmbh|ab|oy|bv|sas)\.?$',
        ''
      )
    ),
    ''
  )
$$;

revoke all on function public.brain_normalize_name(text) from public, anon;
grant execute on function public.brain_normalize_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Entities
-- ---------------------------------------------------------------------------
create table public.brain_entities (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  type text not null check (type in ('company','person','case','sector','geography','stage',
    'investor','fund_vehicle','market','product','theme','metric','reason')),
  name text not null check (char_length(name) between 1 and 300),
  aliases text[] not null default '{}',
  normalized_key text not null check (char_length(normalized_key) between 1 and 400),
  ref_table text,                              -- companies / people / cases / brain_reason_codes
  ref_id uuid,
  summary text,                                -- short, derived (L4). Never a source of facts
  embedding vector(1536),
  status text not null default 'active' check (status in ('active','merged','deleted')),
  merged_into uuid,                            -- merge can be undone via brain_log ("Adskil")
  dirty_at timestamptz,                        -- set by L1/projection when the page needs an update
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique (fund_id, type, normalized_key),
  check ((ref_table is null) = (ref_id is null)),
  check (merged_into is null or merged_into <> id),
  foreign key (merged_into, fund_id)
    references public.brain_entities(id, fund_id) on delete set null (merged_into)
);
create index brain_entities_name_trgm on public.brain_entities
  using gin (name extensions.gin_trgm_ops);
create index brain_entities_emb_idx on public.brain_entities using hnsw (embedding vector_cosine_ops);
create index brain_entities_dirty_idx on public.brain_entities (fund_id) where dirty_at is not null;
create index brain_entities_ref_idx on public.brain_entities (fund_id, ref_table, ref_id)
  where ref_id is not null;
create index brain_entities_merged_idx on public.brain_entities (merged_into)
  where merged_into is not null;

alter table public.brain_sources
  add constraint brain_sources_company_entity_fkey
  foreign key (company_entity_id, fund_id)
  references public.brain_entities(id, fund_id) on delete set null (company_entity_id);
create index brain_sources_company_entity_idx on public.brain_sources (company_entity_id)
  where company_entity_id is not null;

-- Same-fund rule for the polymorphic raw-data reference (ref_table/ref_id).
create or replace function public.brain_entities_check_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if new.ref_table is null then
    return new;
  end if;
  if new.ref_table = 'companies' then
    select exists (select 1 from public.companies x where x.id = new.ref_id and x.fund_id = new.fund_id)
      into v_ok;
  elsif new.ref_table = 'people' then
    select exists (select 1 from public.people x where x.id = new.ref_id and x.fund_id = new.fund_id)
      into v_ok;
  elsif new.ref_table = 'cases' then
    select exists (select 1 from public.cases x where x.id = new.ref_id and x.fund_id = new.fund_id)
      into v_ok;
  elsif new.ref_table = 'brain_reason_codes' then
    select exists (
      select 1 from public.brain_reason_codes x where x.id = new.ref_id and x.fund_id = new.fund_id
    ) into v_ok;
  else
    raise exception 'brain_entities: unsupported ref_table %', new.ref_table;
  end if;
  if not v_ok then
    raise exception 'brain_entities: % % does not exist in this fund', new.ref_table, new.ref_id;
  end if;
  return new;
end;
$$;
revoke all on function public.brain_entities_check_ref() from public, anon, authenticated;

create trigger brain_entities_same_fund_ref
  before insert or update of ref_table, ref_id, fund_id on public.brain_entities
  for each row execute function public.brain_entities_check_ref();

-- ---------------------------------------------------------------------------
-- 3. Facts (the fixed predicate list only grows through a migration)
-- ---------------------------------------------------------------------------
create table public.brain_facts (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  subject_id uuid not null,
  predicate text not null check (predicate in (
    'has_case','founded_by','works_at','board_member_of','in_sector','in_geography','at_stage',
    'decided','because_of',
    'competes_with','operates_in_market','sells_product','partner_of','customer_of',
    'raised_round','invested_in','co_invested_with','valued_at',
    'metric',
    'has_role','previously_at','educated_at',
    'has_risk','has_strength','has_weakness','claims',
    'similar_to',
    'outcome',
    'part_of_theme')),
  object_id uuid,
  value_text text check (value_text is null or char_length(value_text) <= 500),
  value_num numeric,
  unit text check (unit is null or char_length(unit) <= 40),
  statement text not null check (char_length(statement) between 1 and 1000),
  valid_from date,
  valid_to date,
  recorded_at timestamptz not null default now(),
  expired_at timestamptz,
  superseded_by uuid,
  trust_tier text not null check (trust_tier in ('official','partner','customer_doc',
    'third_party','analysis','user_note','company_claim','public_web')),
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'active' check (status in ('proposed','active','rejected')),
  origin text not null check (origin in ('db','extracted','user','derived')),
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (superseded_by is null or superseded_by <> id),
  -- Poisoning guard: web and chat-note facts can only ever be proposals.
  check (trust_tier not in ('public_web','user_note') or status <> 'active'),
  foreign key (subject_id, fund_id)
    references public.brain_entities(id, fund_id) on delete cascade,
  foreign key (object_id, fund_id)
    references public.brain_entities(id, fund_id) on delete cascade,
  foreign key (superseded_by, fund_id)
    references public.brain_facts(id, fund_id) on delete set null (superseded_by)
);
create index brain_facts_subject_idx on public.brain_facts (fund_id, subject_id) where expired_at is null;
create index brain_facts_object_idx on public.brain_facts (fund_id, object_id) where expired_at is null;
create index brain_facts_subject_fk_idx on public.brain_facts (subject_id);
create index brain_facts_object_fk_idx on public.brain_facts (object_id) where object_id is not null;
create index brain_facts_superseded_idx on public.brain_facts (superseded_by)
  where superseded_by is not null;
create index brain_facts_emb_idx on public.brain_facts using hnsw (embedding vector_cosine_ops);
create index brain_facts_fts_idx on public.brain_facts
  using gin (to_tsvector('danish'::regconfig, statement));
-- One current projected fact per natural key; lets the projection upsert idempotently.
create unique index brain_facts_db_uidx on public.brain_facts
  (fund_id, subject_id, predicate, object_id, value_text, valid_from) nulls not distinct
  where origin = 'db' and expired_at is null;

create table public.brain_fact_episodes (
  fact_id uuid not null,
  episode_id uuid not null,
  fund_id uuid not null,
  quote text not null check (char_length(quote) between 1 and 400),  -- verified substring
  created_at timestamptz not null default now(),
  primary key (fact_id, episode_id),
  foreign key (fact_id, fund_id) references public.brain_facts(id, fund_id) on delete cascade,
  foreign key (episode_id, fund_id) references public.brain_episodes(id, fund_id) on delete cascade
);
create index brain_fact_episodes_episode_idx on public.brain_fact_episodes (episode_id);

-- A fact whose last source disappears expires now (L4 deletes it after 30 days).
-- Projected facts (origin = 'db') are maintained by the projection instead.
create or replace function public.brain_fact_episodes_expire_orphans()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.brain_facts f
     set expired_at = now()
   where f.id = old.fact_id
     and f.fund_id = old.fund_id
     and f.expired_at is null
     and f.origin <> 'db'
     and not exists (select 1 from public.brain_fact_episodes fe where fe.fact_id = old.fact_id);
  return null;
end;
$$;
revoke all on function public.brain_fact_episodes_expire_orphans() from public, anon, authenticated;

create trigger brain_fact_episodes_orphans
  after delete on public.brain_fact_episodes
  for each row execute function public.brain_fact_episodes_expire_orphans();

-- ---------------------------------------------------------------------------
-- 4. Projected entities follow deletions in raw data (a deleted person, company or case
--    never stays in Brain). Never fails the original delete.
-- ---------------------------------------------------------------------------
create or replace function public.brain_forget_projected_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    delete from public.brain_entities e
     where e.fund_id = old.fund_id
       and e.ref_table = tg_table_name
       and e.ref_id = old.id;
  exception when others then
    raise warning 'brain_forget_projected_entity on %: %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.brain_forget_projected_entity() from public, anon, authenticated;

create trigger brain_forget_company_entity after delete on public.companies
  for each row execute function public.brain_forget_projected_entity();
create trigger brain_forget_person_entity after delete on public.people
  for each row execute function public.brain_forget_projected_entity();
create trigger brain_forget_case_entity after delete on public.cases
  for each row execute function public.brain_forget_projected_entity();

-- ---------------------------------------------------------------------------
-- 5. Projection helpers (service role only)
-- ---------------------------------------------------------------------------
-- Finds or creates an entity. A raw-data reference wins over the key, so a company that
-- later gets a CVR keeps its entity (the key is updated when that does not collide).
-- A merged entity resolves to the entity it was merged into.
create or replace function public.brain_upsert_ref_entity(
  _fund_id uuid,
  _type text,
  _name text,
  _key text,
  _ref_table text default null,
  _ref_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_merged uuid;
  v_name text := left(coalesce(nullif(btrim(_name), ''), _key), 300);
begin
  if _ref_id is not null then
    select e.id into v_id
    from public.brain_entities e
    where e.fund_id = _fund_id and e.type = _type and e.ref_table = _ref_table and e.ref_id = _ref_id
    order by e.created_at
    limit 1;
    if v_id is not null then
      update public.brain_entities e
         set name = v_name,
             normalized_key = case
               when e.normalized_key = _key then e.normalized_key
               when exists (
                 select 1 from public.brain_entities o
                 where o.fund_id = _fund_id and o.type = _type and o.normalized_key = _key
               ) then e.normalized_key
               else _key end,
             last_seen_at = now(),
             status = case when e.status = 'deleted' then 'active' else e.status end
       where e.id = v_id;
    end if;
  end if;

  if v_id is null then
    insert into public.brain_entities as e (fund_id, type, name, normalized_key, ref_table, ref_id)
    values (_fund_id, _type, v_name, _key, _ref_table, _ref_id)
    on conflict (fund_id, type, normalized_key) do update
      set last_seen_at = now(),
          ref_table = coalesce(e.ref_table, excluded.ref_table),
          ref_id = coalesce(e.ref_id, excluded.ref_id),
          status = case when e.status = 'deleted' then 'active' else e.status end
    returning e.id into v_id;
  end if;

  select e.status, e.merged_into into v_status, v_merged
  from public.brain_entities e where e.id = v_id;
  if v_status = 'merged' and v_merged is not null then
    return v_merged;
  end if;
  return v_id;
end;
$$;

-- Upserts one projected fact (origin = 'db'). Returns the fact id and whether anything
-- changed (new fact or new value), so the projection can mark entities dirty.
create or replace function public.brain_upsert_db_fact(
  _fund_id uuid,
  _subject_id uuid,
  _predicate text,
  _object_id uuid,
  _value_text text,
  _value_num numeric,
  _unit text,
  _statement text,
  _valid_from date,
  _valid_to date,
  _trust_tier text,
  out fact_id uuid,
  out changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  changed := false;
  select f.id, f.value_num, f.unit, f.statement, f.valid_to, f.trust_tier into v_row
  from public.brain_facts f
  where f.fund_id = _fund_id
    and f.subject_id = _subject_id
    and f.predicate = _predicate
    and f.object_id is not distinct from _object_id
    and f.value_text is not distinct from _value_text
    and f.valid_from is not distinct from _valid_from
    and f.origin = 'db'
    and f.expired_at is null;

  if found then
    fact_id := v_row.id;
    if (v_row.value_num, v_row.unit, v_row.statement, v_row.valid_to, v_row.trust_tier)
       is distinct from (_value_num, _unit, _statement, _valid_to, _trust_tier) then
      update public.brain_facts f
         set value_num = _value_num, unit = _unit, statement = _statement,
             valid_to = _valid_to, trust_tier = _trust_tier
       where f.id = v_row.id;
      changed := true;
    end if;
    return;
  end if;

  insert into public.brain_facts (fund_id, subject_id, predicate, object_id, value_text,
    value_num, unit, statement, valid_from, valid_to, trust_tier, status, origin)
  values (_fund_id, _subject_id, _predicate, _object_id, _value_text, _value_num, _unit,
    left(_statement, 1000), _valid_from, _valid_to, _trust_tier, 'active', 'db')
  on conflict (fund_id, subject_id, predicate, object_id, value_text, valid_from)
    where origin = 'db' and expired_at is null
  do nothing
  returning id into fact_id;

  if fact_id is null then
    -- A concurrent projection inserted the same fact first.
    select f.id into fact_id
    from public.brain_facts f
    where f.fund_id = _fund_id and f.subject_id = _subject_id and f.predicate = _predicate
      and f.object_id is not distinct from _object_id
      and f.value_text is not distinct from _value_text
      and f.valid_from is not distinct from _valid_from
      and f.origin = 'db' and f.expired_at is null;
  else
    changed := true;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Deterministic projection for one case. No language model, no cost.
--    company, people (+ company_people), the case, sector/geography/stage, final decisions
--    with reason codes and key metrics from the financial statements. Projected facts
--    that no longer follow from raw data are expired (system time), never deleted.
--    Returns counts as jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.brain_project_db_entities(_fund_id uuid, _case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case record;
  v_company record;
  v_company_entity uuid;
  v_case_entity uuid;
  v_entity uuid;
  v_person_entity uuid;
  v_company_key text;
  v_key text;
  v_name text;
  v_fact uuid;
  v_changed boolean;
  v_any_change boolean := false;
  v_touched uuid[] := '{}';
  v_entities int := 0;
  v_facts int := 0;
  v_expired int := 0;
  v_person record;
  v_decision record;
  v_code text;
  v_code_id uuid;
  v_label text;
  v_metric record;
  v_trust text;
  v_date_text text;
  v_movement_label text;
begin
  if _fund_id is null or _case_id is null then
    raise exception 'brain_project_db_entities: fund id and case id are required';
  end if;

  select c.id, c.company_id, c.created_at into v_case
  from public.cases c where c.id = _case_id and c.fund_id = _fund_id;
  if not found then
    raise exception 'brain_project_db_entities: case not found in this fund';
  end if;

  select co.* into v_company
  from public.companies co where co.id = v_case.company_id and co.fund_id = _fund_id;
  if not found then
    raise exception 'brain_project_db_entities: company not found in this fund';
  end if;

  -- Company: cvr: -> domain: -> name:
  v_company_key := case
    when v_company.cvr_number is not null then 'cvr:' || v_company.cvr_number
    when nullif(btrim(coalesce(v_company.domain, '')), '') is not null
      then 'domain:' || lower(btrim(v_company.domain))
    else 'name:' || coalesce(public.brain_normalize_name(v_company.name), v_company.id::text)
  end;
  v_company_entity := public.brain_upsert_ref_entity(
    _fund_id, 'company', v_company.name, v_company_key, 'companies', v_company.id);
  v_entities := v_entities + 1;

  -- Case entity + has_case
  v_case_entity := public.brain_upsert_ref_entity(
    _fund_id, 'case', v_company.name || ' (case)', 'case:' || _case_id::text, 'cases', _case_id);
  v_entities := v_entities + 1;
  select * into v_fact, v_changed from public.brain_upsert_db_fact(
    _fund_id, v_company_entity, 'has_case', v_case_entity, null, null, null,
    v_company.name || ' har en case i fonden.', v_case.created_at::date, null, 'partner');
  v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;

  -- Sector
  if v_company.sector_key is not null or nullif(btrim(coalesce(v_company.sector, '')), '') is not null then
    if v_company.sector_key is not null then
      v_key := 'sector:' || v_company.sector_key;
      select t.label_da into v_name from public.sector_taxonomy t where t.key = v_company.sector_key;
      v_name := coalesce(v_name, v_company.sector, v_company.sector_key);
    else
      v_key := 'sector:name:' || public.brain_normalize_name(v_company.sector);
      v_name := v_company.sector;
    end if;
    v_entity := public.brain_upsert_ref_entity(_fund_id, 'sector', v_name, v_key);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'in_sector', v_entity, null, null, null,
      v_company.name || ' er i sektoren ' || v_name || '.', null, null, 'partner');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end if;

  -- Geography: hq_country (ISO code) or the free-text geography
  if v_company.hq_country is not null or nullif(btrim(coalesce(v_company.geography, '')), '') is not null then
    if v_company.hq_country is not null then
      v_key := 'geography:' || v_company.hq_country;
      v_name := v_company.hq_country;
    else
      v_key := 'geography:name:' || public.brain_normalize_name(v_company.geography);
      v_name := v_company.geography;
    end if;
    v_entity := public.brain_upsert_ref_entity(_fund_id, 'geography', v_name, v_key);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'in_geography', v_entity, null, null, null,
      v_company.name || ' har hovedsæde i ' || v_name || '.', null, null, 'partner');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end if;

  -- Stage
  if v_company.stage is not null and v_company.stage::text <> 'unknown' then
    v_entity := public.brain_upsert_ref_entity(
      _fund_id, 'stage', v_company.stage::text, 'stage:' || v_company.stage::text);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'at_stage', v_entity, null, null, null,
      v_company.name || ' er på stadiet ' || v_company.stage::text || '.', null, null, 'partner');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end if;

  -- People: founded_by (company -> person), works_at / previously_at (person -> company),
  -- has_role (person -> company, value_text = role). Trust follows the verification.
  for v_person in
    select p.id, p.full_name, cp.role_title, cp.is_founder, cp.is_current, cp.verification_status
    from public.company_people cp
    join public.people p on p.id = cp.person_id and p.fund_id = cp.fund_id
    where cp.company_id = v_company.id and cp.fund_id = _fund_id
    order by p.id
  loop
    v_key := 'name:' || coalesce(public.brain_normalize_name(v_person.full_name), v_person.id::text)
             || '@' || v_company_key;
    v_person_entity := public.brain_upsert_ref_entity(
      _fund_id, 'person', v_person.full_name, v_key, 'people', v_person.id);
    v_entities := v_entities + 1;
    v_trust := case v_person.verification_status
      when 'verified' then 'official'
      when 'partial' then 'third_party'
      else 'company_claim' end;
    if v_person.is_founder then
      select * into v_fact, v_changed from public.brain_upsert_db_fact(
        _fund_id, v_company_entity, 'founded_by', v_person_entity, null, null, null,
        v_company.name || ' er grundlagt af ' || v_person.full_name || '.', null, null, v_trust);
      v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    end if;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_person_entity,
      case when v_person.is_current then 'works_at' else 'previously_at' end,
      v_company_entity, null, null, null,
      v_person.full_name || case when v_person.is_current then ' arbejder i ' else ' har arbejdet i ' end
        || v_company.name || '.',
      null, null, v_trust);
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    if nullif(btrim(coalesce(v_person.role_title, '')), '') is not null then
      select * into v_fact, v_changed from public.brain_upsert_db_fact(
        _fund_id, v_person_entity, 'has_role', v_company_entity, left(btrim(v_person.role_title), 200),
        null, null,
        v_person.full_name || ' er ' || btrim(v_person.role_title) || ' i ' || v_company.name || '.',
        null, null, v_trust);
      v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    end if;
  end loop;

  -- Final decisions (reject / decline_ic / invest). A later reopen closes the fact
  -- (valid_to) instead of removing it: the history stays.
  for v_decision in
    select ev.id, ev.movement_kind, ev.reason_codes, ev.occurred_at,
      (select min(r.occurred_at) from public.case_transition_events r
        where r.case_id = ev.case_id and r.fund_id = ev.fund_id
          and r.movement_kind = 'reopen' and r.occurred_at > ev.occurred_at) as reopened_at
    from public.case_transition_events ev
    where ev.case_id = _case_id and ev.fund_id = _fund_id
      and ev.movement_kind in ('reject','decline_ic','invest')
    order by ev.occurred_at, ev.id
  loop
    v_movement_label := case v_decision.movement_kind
      when 'reject' then 'Kasseret'
      when 'decline_ic' then 'Afvist i komitéen'
      else 'Investeret' end;
    v_date_text := to_char(v_decision.occurred_at at time zone 'UTC', 'YYYY-MM-DD');
    if coalesce(cardinality(v_decision.reason_codes), 0) = 0 then
      select * into v_fact, v_changed from public.brain_upsert_db_fact(
        _fund_id, v_case_entity, 'decided', null, v_decision.movement_kind, null, null,
        v_movement_label || ' ' || v_date_text || ' (' || v_company.name || ').',
        v_decision.occurred_at::date, v_decision.reopened_at::date, 'partner');
      v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
    else
      foreach v_code in array v_decision.reason_codes loop
        v_code_id := null;
        v_label := null;
        select rc.id, rc.label into v_code_id, v_label
        from public.brain_reason_codes rc
        where rc.fund_id = _fund_id and rc.code = v_code;
        v_entity := public.brain_upsert_ref_entity(
          _fund_id, 'reason', coalesce(v_label, v_code), 'reason:' || v_code,
          case when v_code_id is null then null else 'brain_reason_codes' end, v_code_id);
        v_entities := v_entities + 1;
        select * into v_fact, v_changed from public.brain_upsert_db_fact(
          _fund_id, v_case_entity, 'decided', v_entity, v_decision.movement_kind, null, null,
          v_movement_label || ' ' || v_date_text || ' (' || v_company.name || '). Årsag: '
            || coalesce(v_label, v_code) || '.',
          v_decision.occurred_at::date, v_decision.reopened_at::date, 'partner');
        v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
      end loop;
    end if;
  end loop;

  -- Key metrics from the official annual reports (newest fetch per metric and period).
  for v_metric in
    select distinct on (li.metric, fs.period_start, fs.period_end)
      li.metric, li.value, coalesce(nullif(li.unit, ''), fs.currency) as unit,
      fs.period_start, fs.period_end
    from public.financial_statement_line_items li
    join public.financial_statements fs on fs.id = li.statement_id
    where fs.case_id = _case_id and fs.fund_id = _fund_id
      and li.value is not null
      and li.metric in ('revenue','gross_profit','operating_result','result_before_tax',
        'net_result','equity','cash','assets','liabilities','average_employees')
    order by li.metric, fs.period_start, fs.period_end, fs.fetched_at desc, li.id
  loop
    v_entity := public.brain_upsert_ref_entity(
      _fund_id, 'metric', v_metric.metric, 'metric:' || v_metric.metric);
    v_entities := v_entities + 1;
    select * into v_fact, v_changed from public.brain_upsert_db_fact(
      _fund_id, v_company_entity, 'metric', v_entity, v_metric.metric, v_metric.value,
      left(v_metric.unit, 40),
      v_company.name || ': ' || v_metric.metric || ' = ' || v_metric.value::text || ' '
        || coalesce(v_metric.unit, '') || ' (' || v_metric.period_start::text || ' til '
        || v_metric.period_end::text || ').',
      v_metric.period_start, v_metric.period_end, 'official');
    v_touched := v_touched || v_fact; v_facts := v_facts + 1; v_any_change := v_any_change or v_changed;
  end loop;

  -- Expire projected facts in this case's scope that raw data no longer supports.
  update public.brain_facts f
     set expired_at = now()
   where f.fund_id = _fund_id
     and f.origin = 'db'
     and f.expired_at is null
     and not (f.id = any(array_remove(v_touched, null)))
     and (
       (f.subject_id = v_company_entity
          and f.predicate in ('in_sector','in_geography','at_stage','founded_by','metric'))
       or (f.subject_id = v_company_entity and f.predicate = 'has_case' and f.object_id = v_case_entity)
       or (f.object_id = v_company_entity
          and f.predicate in ('works_at','previously_at','has_role'))
       or (f.subject_id = v_case_entity and f.predicate in ('decided','because_of'))
     );
  get diagnostics v_expired = row_count;

  if v_any_change or v_expired > 0 then
    update public.brain_entities e
       set dirty_at = now()
     where e.id in (v_company_entity, v_case_entity);
  end if;

  return jsonb_build_object(
    'company_entity_id', v_company_entity,
    'case_entity_id', v_case_entity,
    'entities', v_entities,
    'facts', v_facts,
    'expired', v_expired,
    'changed', v_any_change or v_expired > 0
  );
end;
$$;

revoke all on function public.brain_upsert_ref_entity(uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.brain_upsert_db_fact(uuid, uuid, text, uuid, text, numeric, text,
  text, date, date, text) from public, anon, authenticated;
revoke all on function public.brain_project_db_entities(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_upsert_ref_entity(uuid, text, text, text, text, uuid)
  to service_role;
grant execute on function public.brain_upsert_db_fact(uuid, uuid, text, uuid, text, numeric, text,
  text, date, date, text) to service_role;
grant execute on function public.brain_project_db_entities(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Read functions (security invoker; RLS applies; foreign fund is refused first).
-- ---------------------------------------------------------------------------

-- Current facts. _valid_at asks about the past in world time.
create or replace function public.brain_search_facts(
  _fund_id uuid,
  _query text default null,
  _query_embedding vector(1536) default null,
  _valid_at date default null,
  _subject_ids uuid[] default null,
  _limit int default 40
)
returns table (fact_id uuid, list text, rank int, score double precision)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(_limit, 40), 1), 100);
  v_at date := coalesce(_valid_at, current_date);
  v_tsq tsquery;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if _query is not null and btrim(_query) <> '' then
    v_tsq := websearch_to_tsquery('danish'::regconfig, left(_query, 1000));
    return query
      select s.id, 'fts'::text, (row_number() over (order by s.r desc, s.id))::int,
             s.r::double precision
      from (
        select f.id, ts_rank_cd(to_tsvector('danish'::regconfig, f.statement), v_tsq) as r
        from public.brain_facts f
        where f.fund_id = _fund_id
          and f.status = 'active'
          and f.expired_at is null
          and (f.valid_to is null or f.valid_to >= v_at)
          and (_valid_at is null or f.valid_from is null or f.valid_from <= _valid_at)
          and (_subject_ids is null or f.subject_id = any(_subject_ids))
          and to_tsvector('danish'::regconfig, f.statement) @@ v_tsq
        order by r desc, f.id
        limit v_limit
      ) s;
  end if;

  if _query_embedding is not null then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.ef_search', '100', true);
    return query
      select s.id, 'vector'::text, (row_number() over (order by s.d, s.id))::int,
             (1 - s.d)::double precision
      from (
        select f.id, f.embedding operator(public.<=>) _query_embedding as d
        from public.brain_facts f
        where f.fund_id = _fund_id
          and f.embedding is not null
          and f.status = 'active'
          and f.expired_at is null
          and (f.valid_to is null or f.valid_to >= v_at)
          and (_valid_at is null or f.valid_from is null or f.valid_from <= _valid_at)
          and (_subject_ids is null or f.subject_id = any(_subject_ids))
        order by f.embedding operator(public.<=>) _query_embedding
        limit v_limit
      ) s;
  end if;
end;
$$;

-- Entities by name (trigram), exact alias and vector.
create or replace function public.brain_search_entities(
  _fund_id uuid,
  _query text default null,
  _query_embedding vector(1536) default null,
  _types text[] default null,
  _limit int default 20
)
returns table (entity_id uuid, list text, rank int, score double precision)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(_limit, 20), 1), 100);
  v_q text := left(btrim(coalesce(_query, '')), 300);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_q <> '' then
    return query
      select s.id, 'name'::text, (row_number() over (order by s.sim desc, s.id))::int,
             s.sim::double precision
      from (
        select e.id,
               greatest(
                 extensions.similarity(e.name, v_q),
                 case when exists (select 1 from unnest(e.aliases) a where lower(a) = lower(v_q))
                      then 1 else 0 end
               ) as sim
        from public.brain_entities e
        where e.fund_id = _fund_id
          and e.status = 'active'
          and (_types is null or e.type = any(_types))
          and (e.name operator(extensions.%) v_q
               or lower(e.name) = lower(v_q)
               or exists (select 1 from unnest(e.aliases) a where lower(a) = lower(v_q)))
        order by sim desc, e.id
        limit v_limit
      ) s;
  end if;

  if _query_embedding is not null then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.ef_search', '100', true);
    return query
      select s.id, 'vector'::text, (row_number() over (order by s.d, s.id))::int,
             (1 - s.d)::double precision
      from (
        select e.id, e.embedding operator(public.<=>) _query_embedding as d
        from public.brain_entities e
        where e.fund_id = _fund_id
          and e.status = 'active'
          and e.embedding is not null
          and (_types is null or e.type = any(_types))
        order by e.embedding operator(public.<=>) _query_embedding
        limit v_limit
      ) s;
  end if;
end;
$$;

-- Active facts one hop from the given entities (graph expansion, step 3).
create or replace function public.brain_graph_neighbors(
  _fund_id uuid,
  _entity_ids uuid[],
  _valid_at date default null,
  _limit int default 50
)
returns table (
  fact_id uuid, subject_id uuid, predicate text, object_id uuid, statement text,
  value_text text, value_num numeric, unit text, valid_from date, valid_to date,
  trust_tier text, recorded_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(_limit, 50), 1), 200);
  v_at date := coalesce(_valid_at, current_date);
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _entity_ids is null or cardinality(_entity_ids) = 0 then
    return;
  end if;
  return query
    select f.id, f.subject_id, f.predicate, f.object_id, f.statement, f.value_text, f.value_num,
           f.unit, f.valid_from, f.valid_to, f.trust_tier, f.recorded_at
    from public.brain_facts f
    where f.fund_id = _fund_id
      and f.status = 'active'
      and f.expired_at is null
      and (f.valid_to is null or f.valid_to >= v_at)
      and (_valid_at is null or f.valid_from is null or f.valid_from <= _valid_at)
      and (f.subject_id = any(_entity_ids) or f.object_id = any(_entity_ids))
    order by f.recorded_at desc, f.id
    limit v_limit;
end;
$$;

-- Shortest path between two entities over active facts (undirected BFS, bounded).
-- Returns one row per step: step 0 is the start entity (fact_id null).
create or replace function public.brain_graph_path(
  _fund_id uuid,
  _from_entity uuid,
  _to_entity uuid,
  _max_depth int default 4
)
returns table (step int, entity_id uuid, fact_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_max int := least(greatest(coalesce(_max_depth, 4), 1), 6);
  v_frontier uuid[];
  v_seen uuid[];
  v_parent jsonb := '{}'::jsonb;   -- node -> [parent node, fact id]
  v_next uuid[];
  v_new jsonb;
  v_found boolean := false;
  v_node uuid;
  v_path uuid[] := '{}';
  v_facts uuid[] := '{}';
  v_depth int;
  i int;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _from_entity is null or _to_entity is null then
    return;
  end if;
  if not exists (select 1 from public.brain_entities e where e.id = _from_entity and e.fund_id = _fund_id)
     or not exists (select 1 from public.brain_entities e where e.id = _to_entity and e.fund_id = _fund_id) then
    return;
  end if;
  if _from_entity = _to_entity then
    step := 0; entity_id := _from_entity; fact_id := null;
    return next;
    return;
  end if;

  v_frontier := array[_from_entity];
  v_seen := array[_from_entity];
  for v_depth in 1 .. v_max loop
    with edges as (
      select f.subject_id as a, f.object_id as b, f.id as fid
      from public.brain_facts f
      where f.fund_id = _fund_id and f.status = 'active' and f.expired_at is null
        and f.object_id is not null and f.subject_id = any(v_frontier)
      union all
      select f.object_id, f.subject_id, f.id
      from public.brain_facts f
      where f.fund_id = _fund_id and f.status = 'active' and f.expired_at is null
        and f.object_id = any(v_frontier)
    ),
    fresh as (
      select distinct on (e.b) e.b, e.a, e.fid
      from edges e
      where not (e.b = any(v_seen))
      order by e.b, e.fid
    )
    select array_agg(fresh.b), jsonb_object_agg(fresh.b::text, jsonb_build_array(fresh.a, fresh.fid))
      into v_next, v_new
    from fresh;

    exit when v_next is null;
    v_parent := v_parent || v_new;
    v_seen := v_seen || v_next;
    v_frontier := v_next;
    if _to_entity = any(v_next) then
      v_found := true;
      exit;
    end if;
    exit when cardinality(v_seen) > 5000;
  end loop;

  if not v_found then
    return;
  end if;

  v_node := _to_entity;
  while v_node <> _from_entity loop
    v_path := v_node || v_path;
    v_facts := ((v_parent -> v_node::text) ->> 1)::uuid || v_facts;
    v_node := ((v_parent -> v_node::text) ->> 0)::uuid;
  end loop;

  step := 0; entity_id := _from_entity; fact_id := null;
  return next;
  for i in 1 .. cardinality(v_path) loop
    step := i; entity_id := v_path[i]; fact_id := v_facts[i];
    return next;
  end loop;
end;
$$;

revoke all on function public.brain_search_facts(uuid, text, vector, date, uuid[], int) from public, anon;
revoke all on function public.brain_search_entities(uuid, text, vector, text[], int) from public, anon;
revoke all on function public.brain_graph_neighbors(uuid, uuid[], date, int) from public, anon;
revoke all on function public.brain_graph_path(uuid, uuid, uuid, int) from public, anon;
grant execute on function public.brain_search_facts(uuid, text, vector, date, uuid[], int)
  to authenticated, service_role;
grant execute on function public.brain_search_entities(uuid, text, vector, text[], int)
  to authenticated, service_role;
grant execute on function public.brain_graph_neighbors(uuid, uuid[], date, int)
  to authenticated, service_role;
grant execute on function public.brain_graph_path(uuid, uuid, uuid, int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Privileges and RLS: members read, only the service role writes.
-- ---------------------------------------------------------------------------
revoke all on public.brain_entities, public.brain_facts, public.brain_fact_episodes
  from public, anon, authenticated;
grant select on public.brain_entities, public.brain_facts, public.brain_fact_episodes
  to authenticated;
grant all on public.brain_entities, public.brain_facts, public.brain_fact_episodes to service_role;

alter table public.brain_entities enable row level security;
alter table public.brain_facts enable row level security;
alter table public.brain_fact_episodes enable row level security;

create policy brain_entities_select_member on public.brain_entities
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_facts_select_member on public.brain_facts
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));
create policy brain_fact_episodes_select_member on public.brain_fact_episodes
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

commit;
