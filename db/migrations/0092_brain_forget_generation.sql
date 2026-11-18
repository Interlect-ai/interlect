-- 0092 · En glemsel kan ikke lægges tilbage af nattens sider.
--
-- L4 læser en sides data (brain_page_data), lader side-skriveren arbejde i op til et par minutter
-- og gemmer siden bagefter (brain_save_page). Kom "Glem kilde" eller "Glem person" imellem, gemte
-- L4 det, den havde læst før glemslen: en slettet fakta, en tømt lektion eller et glemt navn stod
-- igen på siden og i en ny version i sidens historik (0082 havde lige ryddet dem).
--
--   * brain_forget_generations: en tæller pr. fond, som hver glemsel tæller op. Glemslen tager
--     fondens lås fra 0091 (`brain_forget:<fond>`) eksklusivt, før den rører noget, og tæller op
--     (private.brain_forget_begin), både i brain_forget_source og i gdpr_forget_person (som ikke
--     tog låsen før). Tælleren læses kun af L4's sidegem; et chatsvar, der læste personen før
--     glemslen, maskeres stadig ikke ved gem (anden halvdel).
--   * brain_forget_generation(fond): L4 læser tælleren, før den læser data til siderne.
--   * brain_save_page tager låsen delt og et nyt, krævet argument `_forget_generation`. Er
--     tælleren talt op siden L4 læste den, gemmes intet (`skipped: 'forgotten'`), entiteten er
--     beskidt, og L4 stopper nattens sider; næste nat tegnes de ud fra data efter glemslen. Enten
--     venter gemmet på, at glemslen er gemt (og ser tælleren), eller glemslen venter på gemmet og
--     rydder den gemte side bagefter (0082).
--   * Glem person maskerer også navnet i andre entiteters navn og nøgle (fx et selskab eller et
--     produkt opkaldt efter personen); L4 skriver sidens titel fra entitetens navn, så titlen
--     maskeret af 0082 kom igen i nat. Selskabets navne i rå data (companies.name og legal_name,
--     det juridiske navn fra CVR, som researchen og casevisningen bruger) maskeres også,
--     ellers skriver næste opsamling (brain_project_db_entities) navnet tilbage i selskabets og
--     casens entitet og i "har en case"-faktaen. Rammer to maskerede nøgler hinanden, får den ene
--     sit id-præfiks bagpå, så ingen entitet flettes eller forsvinder.
--
-- L2's lektioner hviler i dag kun på analyse-, fund- og risiko-episoder (brain_reflection_input,
-- 0075), aldrig på en kilde, så Glem kildes lektionsgren (0082) kan kun prøves med syntetiske
-- beviser; den er et værn til den dag, analyserne bruger Brain. Ingen ændring.
--
-- Én ny tabel (kun serveren, RLS uden policies). brain_save_page får et nyt argument (den gamle
-- udgave fjernes, så et kald uden tælleren fejler i stedet for at gemme). Ingen policy ændres;
-- de nye funktioner kun for service_role.

begin;

set local lock_timeout = '5s';

create table public.brain_forget_generations (
  fund_id uuid primary key references public.funds(id) on delete cascade,
  generation bigint not null default 0 check (generation >= 0),
  forgotten_at timestamptz not null default now()
);
revoke all on public.brain_forget_generations from public, anon, authenticated;
grant all on public.brain_forget_generations to service_role;
alter table public.brain_forget_generations enable row level security;

-- ---------------------------------------------------------------------------
-- 1. Tælleren
-- ---------------------------------------------------------------------------
-- A forgetting starts here: the fund's lock (0091) exclusively, before anything is read or
-- changed, and the counter up. Writers that may hold what is forgotten take the lock shared.
create or replace function private.brain_forget_begin(_fund_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
begin
  if _fund_id is null then
    raise exception 'brain_forget_begin: fund is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('brain_forget:' || _fund_id::text, 0));
  insert into public.brain_forget_generations as g (fund_id, generation, forgotten_at)
  values (_fund_id, 1, now())
  on conflict (fund_id) do update
    set generation = g.generation + 1, forgotten_at = now()
  returning g.generation into v_generation;
  return v_generation;
end;
$$;

-- What L4 reads before it reads the pages' data: 0 when nothing was ever forgotten.
create or replace function public.brain_forget_generation(_fund_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select g.generation from public.brain_forget_generations g
                    where g.fund_id = _fund_id), 0);
$$;

-- ---------------------------------------------------------------------------
-- 2. Gem en side (0064) med tælleren
-- ---------------------------------------------------------------------------
drop function public.brain_save_page(uuid, text, uuid, text, jsonb, text, timestamptz, text, boolean, text);

create function public.brain_save_page(
  _fund_id uuid,
  _kind text,
  _entity_id uuid,
  _title text,
  _sections jsonb,
  _search_text text default null,
  _dirty_at timestamptz default null,
  _change_note text default null,
  _finished boolean default true,
  _input_hash text default null,
  _forget_generation bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_title text := left(btrim(coalesce(_title, '')), 300);
  v_fts tsvector;
  v_changed boolean := false;
begin
  if _fund_id is null or _kind is null or nullif(v_title, '') is null
     or jsonb_typeof(_sections) is distinct from 'array' then
    raise exception 'brain_save_page: fund, kind, title and sections are required';
  end if;
  if _forget_generation is null then
    raise exception 'brain_save_page: the forget generation read before the page data is required';
  end if;

  -- A forgetting holds this lock until it is saved: wait for it, then look at the counter.
  perform pg_advisory_xact_lock_shared(hashtextextended('brain_forget:' || _fund_id::text, 0));
  if public.brain_forget_generation(_fund_id) <> _forget_generation then
    -- Something was forgotten after the run read its data: what it would save may hold it. The
    -- page stays as the forgetting left it and is drawn again from clean data next night.
    if _entity_id is not null then
      update public.brain_entities e set dirty_at = coalesce(e.dirty_at, now())
       where e.id = _entity_id and e.fund_id = _fund_id;
    end if;
    return jsonb_build_object('skipped', 'forgotten');
  end if;

  if _entity_id is not null and not exists (
    select 1 from public.brain_entities e
    where e.id = _entity_id and e.fund_id = _fund_id and e.status = 'active') then
    return jsonb_build_object('skipped', 'entity_gone');
  end if;
  perform set_config('brain.change_note', left(coalesce(_change_note, ''), 500), true);
  v_fts := to_tsvector('danish'::regconfig, left(v_title || ' ' || coalesce(_search_text, ''), 200000));

  select * into v_page
  from public.brain_pages p
  where p.fund_id = _fund_id and p.kind = _kind and p.entity_id is not distinct from _entity_id
  for update;
  if not found then
    insert into public.brain_pages (fund_id, kind, entity_id, title, sections, search_fts, updated_by)
    values (_fund_id, _kind, _entity_id, v_title, _sections, v_fts, 'L4')
    returning * into v_page;
    v_changed := true;
  elsif v_page.sections is distinct from _sections or v_page.title is distinct from v_title then
    update public.brain_pages p
       set title = v_title, sections = _sections, search_fts = v_fts, updated_by = 'L4'
     where p.id = v_page.id
    returning * into v_page;
    v_changed := true;
  end if;

  if _input_hash is not null and v_page.input_hash is distinct from _input_hash then
    update public.brain_pages p set input_hash = _input_hash where p.id = v_page.id;
  end if;

  if _entity_id is not null and not coalesce(_finished, true) then
    update public.brain_entities e set dirty_at = coalesce(e.dirty_at, now())
     where e.id = _entity_id and e.fund_id = _fund_id;
  elsif _entity_id is not null and _dirty_at is not null then
    update public.brain_entities e set dirty_at = null
     where e.id = _entity_id and e.fund_id = _fund_id and e.dirty_at = _dirty_at;
  end if;
  return jsonb_build_object('pageId', v_page.id, 'version', v_page.version, 'changed', v_changed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Glem kilde (0090) tager låsen og tæller op, før den rører noget; ellers uændret
-- ---------------------------------------------------------------------------
create or replace function public.brain_forget_source(_fund_id uuid, _source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode_ids uuid[];
  v_source_refs text[];
  v_chunk_ids uuid[];
  v_sole_facts uuid[];
  v_shared_facts uuid[];
  v_gone_facts uuid[];
  v_entity_ids uuid[];
  v_bullet_ids uuid[];
  v_object_ids uuid[];
  v_markers text[];
  v_contradictions text[];
  v_pages jsonb;
  v_deleted_facts int := 0;
  v_dirty int := 0;
  v_masked int := 0;
  v_insights int := 0;
  v_lessons int := 0;
  v_chat jsonb;
begin
  if _fund_id is null or _source_id is null then
    raise exception 'brain_forget_source: fund and source are required';
  end if;
  -- T-723: the lock and the counter before anything is read, so a page saved by L4 from data
  -- read before this commits is not saved after it.
  perform private.brain_forget_begin(_fund_id);
  perform 1 from public.brain_sources s
   where s.id = _source_id and s.fund_id = _fund_id
   for update;
  if not found then
    raise exception 'brain_forget_source: unknown source' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(e.id), '{}') into v_episode_ids
    from public.brain_episodes e
   where e.fund_id = _fund_id and e.brain_source_id = _source_id;
  select coalesce(array_agg(c.id), '{}') into v_chunk_ids
    from public.brain_chunks c
   where c.fund_id = _fund_id and c.episode_id = any (v_episode_ids);
  v_source_refs := array(select x::text from unnest(v_episode_ids || v_chunk_ids || _source_id) x);

  -- Facts that stand on this source alone are deleted for good, wording and embedding included.
  select coalesce(array_agg(distinct fe.fact_id), '{}') into v_sole_facts
    from public.brain_fact_episodes fe
   where fe.fund_id = _fund_id
     and fe.episode_id = any (v_episode_ids)
     and not exists (
       select 1 from public.brain_fact_episodes other
       where other.fact_id = fe.fact_id and not (other.episode_id = any (v_episode_ids)));
  select coalesce(array_agg(distinct fe.fact_id), '{}') into v_shared_facts
    from public.brain_fact_episodes fe
   where fe.fund_id = _fund_id
     and fe.episode_id = any (v_episode_ids)
     and not (fe.fact_id = any (v_sole_facts));

  -- The entities these facts were about are marked for a rewrite.
  select coalesce(array_agg(distinct x.entity_id), '{}') into v_entity_ids
    from (
      select f.subject_id as entity_id
        from public.brain_facts f
        join public.brain_fact_episodes fe on fe.fact_id = f.id and fe.fund_id = f.fund_id
       where f.fund_id = _fund_id and fe.episode_id = any (v_episode_ids)
      union
      select f.object_id
        from public.brain_facts f
        join public.brain_fact_episodes fe on fe.fact_id = f.id and fe.fund_id = f.fund_id
       where f.fund_id = _fund_id and fe.episode_id = any (v_episode_ids) and f.object_id is not null
    ) x;

  -- Lessons that rest on the source (T-313): the text may come from it, so it goes, with the
  -- vector, the evidence that pointed at the source and the reasons in its count log. An open
  -- lesson is retired; it no longer says anything. The thesis pages that list it ("pb-00001: ",
  -- whatever text it had then) lose that section below.
  select coalesce(array_agg(b.id), '{}'),
         coalesce(array_agg(b.short_id || ': '), '{}')
    into v_bullet_ids, v_markers
    from public.brain_playbook_bullets b
   where b.fund_id = _fund_id
     and exists (select 1 from jsonb_array_elements(b.evidence) r
                 where (r ->> 'id') = any (v_source_refs));
  update public.brain_playbook_bullets b
     set text = '[kilde slettet]',
         evidence = coalesce((
           select jsonb_agg(r order by ord)
           from jsonb_array_elements(b.evidence) with ordinality as t(r, ord)
           where not coalesce((r ->> 'id') = any (v_source_refs), false)), '[]'::jsonb),
         embedding = null,
         status = case when b.status in ('candidate', 'active') then 'retired' else b.status end
   where b.fund_id = _fund_id and b.id = any (v_bullet_ids);
  get diagnostics v_lessons = row_count;
  if v_lessons > 0 then
    perform set_config('brain.gdpr', 'on', true);
    update public.brain_bullet_events e
       set reason = '[kilde slettet]'
     where e.fund_id = _fund_id and e.bullet_id = any (v_bullet_ids)
       and e.reason <> '[kilde slettet]';
    perform set_config('brain.gdpr', 'off', true);
  end if;

  -- The log of every fact the source touched is masked: the ones deleted and the ones that only
  -- lose their wording (a before/after may hold text from the source). The same for the lessons.
  v_object_ids := v_episode_ids || v_chunk_ids || v_sole_facts || v_shared_facts || v_bullet_ids
                  || array[_source_id];

  delete from public.brain_facts f
   where f.fund_id = _fund_id and f.id = any (v_sole_facts);
  get diagnostics v_deleted_facts = row_count;

  update public.brain_entities en
     set dirty_at = now()
   where en.fund_id = _fund_id and en.id = any (v_entity_ids);
  get diagnostics v_dirty = row_count;

  -- Insights that quote the source, its facts or a lesson that rested on it lose their text. A
  -- contradiction's title is also a line in the company page's contradictions (pages.ts), so the
  -- titles are kept as markers for the pages below.
  select coalesce(array_agg(i.title), '{}') into v_contradictions
    from public.brain_insights i
   where i.fund_id = _fund_id and i.kind = 'contradiction'
     and exists (
       select 1 from unnest(v_object_ids) as x(id)
       where i.refs::text like '%' || x.id::text || '%');
  update public.brain_insights i
     set title = '[kilde slettet]', body_md = '[kilde slettet]', refs = '[]'::jsonb
   where i.fund_id = _fund_id
     and exists (
       select 1 from unnest(v_object_ids) as x(id)
       where i.refs::text like '%' || x.id::text || '%');
  get diagnostics v_insights = row_count;

  v_masked := public.gdpr_mask_log(_fund_id, v_object_ids);

  -- The source goes; episodes, chunks and the remaining fact links follow by cascade, and the
  -- trigger (0052) empties the wording of any fact whose wording came from this source.
  delete from public.brain_sources s where s.id = _source_id and s.fund_id = _fund_id;

  -- Pages (T-313): a section that cites a deleted fact, or a fact that just lost its wording, or
  -- lists a lesson or a contradiction emptied above, is removed now; old versions with it go too.
  select v_sole_facts || coalesce(array_agg(f.id), '{}') into v_gone_facts
    from public.brain_facts f
   where f.fund_id = _fund_id and f.id = any (v_shared_facts) and f.statement = '[kilde slettet]';
  v_pages := public.brain_pages_forget_refs(_fund_id, v_gone_facts, v_markers || v_contradictions,
                                            'Kilde slettet');

  -- Chat (T-722): an old answer's citation of a chunk, a gone fact or an emptied lesson is marked
  -- deleted and loses the source's words; the search log forgets them as candidates.
  v_chat := public.brain_forget_chat_refs(_fund_id, v_chunk_ids || v_gone_facts || v_bullet_ids);

  return jsonb_build_object(
    'episodes', cardinality(v_episode_ids),
    'chunks', cardinality(v_chunk_ids),
    'factsDeleted', v_deleted_facts,
    'factsUnlinked', cardinality(v_shared_facts),
    'entitiesMarked', v_dirty,
    'insightsEmptied', v_insights,
    'lessonsEmptied', v_lessons,
    'pagesChanged', coalesce((v_pages ->> 'pagesChanged')::int, 0),
    'pageVersionsDeleted', coalesce((v_pages ->> 'pageVersionsDeleted')::int, 0),
    'chatMessagesChanged', coalesce((v_chat ->> 'chatMessagesChanged')::int, 0),
    'retrievalEventsChanged', coalesce((v_chat ->> 'retrievalEventsChanged')::int, 0),
    'logRowsMasked', v_masked
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Glem person: navne i andre entiteter og i selskabets navn
-- ---------------------------------------------------------------------------
-- Another entity named after the person (a company "Anna Hansen ApS", its case, a product) keeps
-- the name in its name and key, and L4 writes the page title from the name. Both are masked, the
-- vector goes (the server embeds nothing from a masked name), and the entity is dirty. The
-- company's own names (raw: name, and legal_name from the registry) are masked first: the next capture writes it into the company and case
-- entities and the "has a case" fact (brain_project_db_entities). A masked key that another entity
-- of the same type already has gets the entity's id prefix, so nothing is merged or lost.
create or replace function public.brain_forget_person_names(_fund_id uuid, _terms text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pattern text := public.gdpr_term_pattern(_terms);
  v_entity record;
  v_key text;
  v_companies int := 0;
  v_entities int := 0;
begin
  if _fund_id is null or v_pattern is null then
    raise exception 'brain_forget_person_names: fund and terms are required';
  end if;

  update public.companies c
     set name = public.gdpr_replace_terms(c.name, _terms),
         legal_name = public.gdpr_replace_terms(c.legal_name, _terms)
   where c.fund_id = _fund_id and (c.name ~* v_pattern or c.legal_name ~* v_pattern);
  get diagnostics v_companies = row_count;

  for v_entity in
    select e.id, e.type, e.name, e.normalized_key
      from public.brain_entities e
     where e.fund_id = _fund_id
       and (e.name ~* v_pattern or e.normalized_key ~* v_pattern)
     order by e.created_at, e.id
     for update
  loop
    v_key := public.gdpr_replace_terms(v_entity.normalized_key, _terms);
    if exists (select 1 from public.brain_entities o
                where o.fund_id = _fund_id and o.type = v_entity.type
                  and o.normalized_key = v_key and o.id <> v_entity.id) then
      v_key := left(v_key, 380) || ' #' || left(v_entity.id::text, 8);
    end if;
    update public.brain_entities e
       set name = public.gdpr_replace_terms(e.name, _terms),
           normalized_key = v_key,
           embedding = null,
           dirty_at = now()
     where e.id = v_entity.id and e.fund_id = _fund_id;
    v_entities := v_entities + 1;
  end loop;

  return jsonb_build_object('companiesRenamed', v_companies, 'entitiesRenamed', v_entities);
end;
$$;

-- The entry point (0082) with the lock and the counter first, and the names above after Brain has
-- deleted the person's own entities.
create or replace function public.gdpr_forget_person(
  _fund_id uuid,
  _person_id uuid default null,
  _entity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_who jsonb;
  v_terms text[];
  v_entities uuid[];
  v_person uuid;
  v_raw jsonb;
  v_brain jsonb;
  v_names jsonb;
  v_own_pages int;
begin
  if _fund_id is null then
    raise exception 'gdpr_forget_person: fund is required';
  end if;
  -- T-723: before anything is read, so a page L4 read before this commits is not saved after it
  -- (brain_save_page checks the counter). A chat answer only waits for the lock (T-735 b).
  perform private.brain_forget_begin(_fund_id);

  v_who := public.gdpr_person_terms(_fund_id, _person_id, _entity_id);
  v_terms := array(select jsonb_array_elements_text(v_who -> 'terms'));
  v_entities := array(select (jsonb_array_elements_text(v_who -> 'entity_ids'))::uuid);
  v_person := nullif(v_who ->> 'person_id', '')::uuid;

  -- Rå data først: den maskerede tekst er det, en senere capture læser. Selve rækken i people
  -- slettes sidst i samme transaktion, efter at Brain har brugt entiteten.
  v_raw := public.gdpr_forget_person_raw(_fund_id, null, v_terms);
  -- The person's own pages go with the entity (cascade, versions included).
  select count(*)::int into v_own_pages
    from public.brain_pages p
   where p.fund_id = _fund_id and p.entity_id = any (v_entities);
  v_brain := public.brain_forget_person(_fund_id, v_person, v_entities, v_terms);
  v_names := public.brain_forget_person_names(_fund_id, v_terms);
  v_brain := v_brain || jsonb_build_object('pagesDeleted', v_own_pages,
                                           'entitiesRenamed', (v_names -> 'entitiesRenamed'))
             || public.brain_forget_person_derived(_fund_id, v_terms);
  if coalesce((v_names ->> 'companiesRenamed')::int, 0) > 0 then
    v_raw := jsonb_set(v_raw, '{rawMasked}',
                       coalesce(v_raw -> 'rawMasked', '{}'::jsonb)
                       || jsonb_build_object('companies.name', (v_names -> 'companiesRenamed')));
  end if;
  if v_person is not null then
    delete from public.people p where p.id = v_person and p.fund_id = _fund_id;
    v_raw := v_raw || jsonb_build_object('peopleDeleted', 1);
  end if;
  return jsonb_build_object(
    'raw', v_raw,
    'brain', v_brain,
    'notCovered', jsonb_build_array('Filer i Storage (decks og uploads)', 'Enkeltfornavne uden efternavn')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rettigheder: kun serveren
-- ---------------------------------------------------------------------------
revoke all on function private.brain_forget_begin(uuid) from public, anon, authenticated;
revoke all on function public.brain_forget_generation(uuid) from public, anon, authenticated;
revoke all on function public.brain_save_page(uuid, text, uuid, text, jsonb, text, timestamptz, text, boolean, text, bigint)
  from public, anon, authenticated;
revoke all on function public.brain_forget_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_forget_person_names(uuid, text[]) from public, anon, authenticated;
revoke all on function public.gdpr_forget_person(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.brain_forget_generation(uuid) to service_role;
grant execute on function public.brain_save_page(uuid, text, uuid, text, jsonb, text, timestamptz, text, boolean, text, bigint)
  to service_role;
grant execute on function public.brain_forget_source(uuid, uuid) to service_role;
grant execute on function public.brain_forget_person_names(uuid, text[]) to service_role;
grant execute on function public.gdpr_forget_person(uuid, uuid, uuid) to service_role;

commit;
