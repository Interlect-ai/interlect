-- 0082 · "Glem kilde" og "Glem person" rører også sider, lektioner og indsigter.
--
-- Siden 0052 og 0072 er der kommet Brain-sider med versioner (0062/0064), lektioner med tæller-log
-- (0062/0075) og nye indsigter, der peger på lektioner (0063/0075). Glem rørte dem ikke, så et
-- glemt navn eller en glemt kildes tal kunne stå videre i en side, en gammel version af en side
-- eller en lektion.
--
--   Glem kilde (brain_forget_source erstattes):
--     * en lektion, hvis beviser peger på kildens episoder, mister sin tekst ("[kilde slettet]"),
--       sin vektor og de beviser; en åben lektion pensioneres. Indsigter, der peger på lektionen,
--       mister teksten (som indsigter om kildens fakta), og loggen og tæller-loggens begrundelser
--       for lektionen maskeres.
--     * en sidesektion, der henviser til en slettet fakta (fact_ids, ellers [f:id] i teksten) eller
--       viser en tømt lektion (tesens "Lektioner") eller en tømt modsigelse (selskabets
--       "Modsigelser"), fjernes straks (også en låst), og gamle versioner med den slettes. Siden får
--       en ny version uden sektionen, og entiteten er beskidt, så L4 tegner resten i nat.
--       "Slettet" er fakta, der kun havde kilden, og fakta, hvis tekst stammede fra kilden.
--   Glem person (gdpr_forget_person erstattes, brain_forget_person er uændret):
--     * personens egen side og dens versioner forsvinder med entiteten (cascade, tælles nu)
--     * andre sider: titel og sektioner maskeres (også en låst), ny version, ny søgetekst, ingen
--       vektor, entiteten beskidt; gamle versioner (og ændringsnoter) med navnet slettes
--     * lektioner: tekst, beviser og scope maskeres; en lektion, hvis tekst ændres, mister sin
--       vektor, og serveren embedder den igen (som fondens gamle hukommelse); tæller-loggens
--       begrundelser maskeres. Indsigterne maskeres allerede af brain_forget_person (0072).
--
-- Vagten på siderne (0062) lader nu GDPR-funktionerne (brain.gdpr = 'on') ændre og fjerne en låst
-- sektion, og versionen står som ændret af 'gdpr'. Ingen tabel, kolonne, policy eller rettighed
-- ændres; nye funktioner kun for service_role.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Vagten og historikken på siderne
-- ---------------------------------------------------------------------------
create or replace function public.brain_pages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  end if;
  if tg_op = 'UPDATE' then
    if new.fund_id <> old.fund_id or new.kind <> old.kind
       or new.entity_id is distinct from old.entity_id then
      raise exception 'brain_pages: fund, kind and entity of a page cannot change';
    end if;
    if new.sections is distinct from old.sections then
      -- Only an edit the server marks as a user's (set_config('brain.user_edit', 'on', true)) may
      -- change a locked section; whatever the writer puts in updated_by. The GDPR functions
      -- (brain.gdpr = 'on') may too: a forgotten name or source does not stay because it is locked.
      if coalesce(current_setting('brain.gdpr', true), '') <> 'on'
         and (new.updated_by = 'L4' or current_setting('brain.user_edit', true) is distinct from 'on') then
        for v_old in select e from jsonb_array_elements(old.sections) e
                     where coalesce((e ->> 'locked_by_user')::boolean, false)
        loop
          select e into v_new from jsonb_array_elements(new.sections) e
           where e ->> 'key' = v_old ->> 'key' limit 1;
          if v_new is null
             or (v_new ->> 'body_md') is distinct from (v_old ->> 'body_md')
             or (v_new ->> 'heading') is distinct from (v_old ->> 'heading')
             or coalesce((v_new ->> 'locked_by_user')::boolean, false) is not true then
            raise exception 'brain_pages: section % is locked by a user and cannot be changed by L4 or a writer that is not a user edit',
              v_old ->> 'key';
          end if;
        end loop;
      end if;
      -- Every change of the sections is a new version, whatever the caller wrote.
      new.version := old.version + 1;
      new.updated_at := now();
    elsif new.version <> old.version then
      raise exception 'brain_pages: the version only changes with the sections';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.brain_pages_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.brain_page_versions (page_id, fund_id, version, sections, change_note, changed_by)
  values (new.id, new.fund_id, new.version, new.sections,
          left(nullif(current_setting('brain.change_note', true), ''), 500),
          case when coalesce(current_setting('brain.gdpr', true), '') = 'on' then 'gdpr'
               else new.updated_by end)
  on conflict (page_id, version) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Hjælpefunktioner
-- ---------------------------------------------------------------------------
-- The readable text of a page's sections (headings and bodies, fact references included).
create or replace function public.brain_sections_text(_sections jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(coalesce(s ->> 'heading', '') || E'\n' || coalesce(s ->> 'body_md', ''),
                             E'\n\n'), '')
  from jsonb_array_elements(case when jsonb_typeof(_sections) = 'array' then _sections
                                 else '[]'::jsonb end) s;
$$;

-- search_fts as brain_page_user_edit (0079) builds it: title, headings and bodies without [f:id].
create or replace function public.brain_page_fts(_title text, _sections jsonb)
returns tsvector
language sql
stable
set search_path = ''
as $$
  select to_tsvector('danish'::regconfig, left(coalesce(_title, '') || ' ' || regexp_replace(
    public.brain_sections_text(_sections), '\[f:[^\]\s]+\]', '', 'g'), 200000));
$$;

-- Does a section show something the forget removes? A deleted fact: its id in fact_ids (every
-- writer fills fact_ids from the body's [f:id], pages.ts and 0079; the body is read only when
-- fact_ids is missing). A list line ("pb-00001: ..." in the thesis' lessons, an insight title in
-- the contradictions): only those two computed lists are searched for text, so the cost does not
-- grow with every section times every marker.
create or replace function public.brain_section_hits(
  _section jsonb,
  _fact_ids text[],
  _list_markers text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    case when jsonb_typeof(_section -> 'fact_ids') = 'array'
           then (_section -> 'fact_ids') ?| coalesce(_fact_ids, '{}')
         else exists (
           select 1 from regexp_matches(coalesce(_section ->> 'body_md', ''), '\[f:([^\]\s]+)\]', 'g') as m
           where m[1] = any (_fact_ids))
    end
    or (coalesce(_section ->> 'key', '') in ('lessons', 'contradictions')
        and exists (
          select 1 from unnest(_list_markers) as x(marker)
          where coalesce(x.marker, '') <> ''
            and strpos(coalesce(_section ->> 'body_md', ''), x.marker) > 0));
$$;

-- Glem kilde: sections that show a deleted fact or list line are removed now (locked or not), the
-- rest of the page stays and is drawn again tonight; versions that show one are deleted.
create or replace function public.brain_pages_forget_refs(
  _fund_id uuid,
  _fact_ids uuid[],
  _list_markers text[],
  _note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facts text[] := array(select x::text from unnest(coalesce(_fact_ids, '{}')) x);
  v_lists text[] := coalesce(_list_markers, '{}');
  v_page record;
  v_sections jsonb;
  v_pages int := 0;
  v_versions int := 0;
begin
  if _fund_id is null or (cardinality(v_facts) = 0 and cardinality(v_lists) = 0) then
    return jsonb_build_object('pagesChanged', 0, 'pageVersionsDeleted', 0);
  end if;
  perform set_config('brain.gdpr', 'on', true);
  perform set_config('brain.change_note', left(coalesce(_note, ''), 500), true);

  for v_page in
    select p.id, p.title, p.sections, p.entity_id
      from public.brain_pages p
     where p.fund_id = _fund_id
       and exists (select 1 from jsonb_array_elements(p.sections) s
                   where public.brain_section_hits(s, v_facts, v_lists))
     for update
  loop
    select coalesce(jsonb_agg(s order by ord), '[]'::jsonb) into v_sections
      from jsonb_array_elements(v_page.sections) with ordinality as t(s, ord)
     where not public.brain_section_hits(s, v_facts, v_lists);
    update public.brain_pages p
       set sections = v_sections,
           search_fts = public.brain_page_fts(v_page.title, v_sections),
           embedding = null
     where p.id = v_page.id and p.fund_id = _fund_id;
    if v_page.entity_id is not null then
      update public.brain_entities e set dirty_at = now()
       where e.id = v_page.entity_id and e.fund_id = _fund_id;
    end if;
    v_pages := v_pages + 1;
  end loop;

  delete from public.brain_page_versions v
   where v.fund_id = _fund_id
     and exists (select 1 from jsonb_array_elements(v.sections) s
                 where public.brain_section_hits(s, v_facts, v_lists));
  get diagnostics v_versions = row_count;

  perform set_config('brain.change_note', '', true);
  perform set_config('brain.gdpr', 'off', true);
  return jsonb_build_object('pagesChanged', v_pages, 'pageVersionsDeleted', v_versions);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Glem kilde
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
begin
  if _fund_id is null or _source_id is null then
    raise exception 'brain_forget_source: fund and source are required';
  end if;
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
    'logRowsMasked', v_masked
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Glem person: sider og lektioner
-- ---------------------------------------------------------------------------
create or replace function public.brain_forget_person_derived(_fund_id uuid, _terms text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pattern text := public.gdpr_term_pattern(_terms);
  v_json_pattern text := public.gdpr_term_pattern(public.gdpr_json_terms(_terms));
  v_page record;
  v_sections jsonb;
  v_title text;
  v_pages int := 0;
  v_versions int := 0;
  v_lessons int := 0;
  v_events int := 0;
  v_embed jsonb := '[]'::jsonb;
begin
  if _fund_id is null or v_pattern is null then
    raise exception 'brain_forget_person_derived: fund and terms are required';
  end if;
  perform set_config('brain.gdpr', 'on', true);
  perform set_config('brain.change_note', 'Navn fjernet', true);

  -- Other pages that name the person (the person's own page went with the entity): the headings
  -- and bodies are masked as text (a name across a line break too), then the rest of the json.
  for v_page in
    select p.id, p.title, p.sections, p.entity_id
      from public.brain_pages p
     where p.fund_id = _fund_id
       and (p.title ~* v_pattern
            or public.brain_sections_text(p.sections) ~* v_pattern
            or p.sections::text ~* v_json_pattern)
     for update
  loop
    select coalesce(jsonb_agg(
             case when jsonb_typeof(s) = 'object' then
               s || jsonb_strip_nulls(jsonb_build_object(
                 'heading', public.gdpr_replace_terms(s ->> 'heading', _terms),
                 'body_md', public.gdpr_replace_terms(s ->> 'body_md', _terms)))
             else s end
             order by ord), '[]'::jsonb)
      into v_sections
      from jsonb_array_elements(v_page.sections) with ordinality as t(s, ord);
    v_sections := public.gdpr_replace_terms_jsonb(v_sections, _terms);
    if jsonb_typeof(v_sections) is distinct from 'array' then
      v_sections := '[]'::jsonb;
    end if;
    v_title := public.gdpr_replace_terms(v_page.title, _terms);
    update public.brain_pages p
       set title = v_title,
           sections = v_sections,
           search_fts = public.brain_page_fts(v_title, v_sections),
           embedding = null
     where p.id = v_page.id and p.fund_id = _fund_id;
    if v_page.entity_id is not null then
      update public.brain_entities e set dirty_at = now()
       where e.id = v_page.entity_id and e.fund_id = _fund_id;
    end if;
    v_pages := v_pages + 1;
  end loop;

  -- Old versions that name the person are deleted; the new, masked version stays.
  delete from public.brain_page_versions v
   where v.fund_id = _fund_id
     and (public.brain_sections_text(v.sections) ~* v_pattern
          or v.sections::text ~* v_json_pattern
          or v.change_note ~* v_pattern);
  get diagnostics v_versions = row_count;

  -- Lessons: text, evidence and scope. A lesson whose text changed loses its vector; the server
  -- embeds the masked text again (lessonsToEmbed).
  with hit as (
    select b.id, b.text ~* v_pattern as text_hit, b.embedding is not null as had_vector
      from public.brain_playbook_bullets b
     where b.fund_id = _fund_id
       and (b.text ~* v_pattern or b.evidence::text ~* v_json_pattern
            or b.scope::text ~* v_json_pattern)
  ), changed as (
    update public.brain_playbook_bullets b
       set text = public.gdpr_replace_terms(b.text, _terms),
           evidence = case
             when jsonb_typeof(public.gdpr_replace_terms_jsonb(b.evidence, _terms)) = 'array'
               then public.gdpr_replace_terms_jsonb(b.evidence, _terms)
             else '[]'::jsonb end,
           scope = case
             when jsonb_typeof(public.gdpr_replace_terms_jsonb(b.scope, _terms)) = 'object'
               then public.gdpr_replace_terms_jsonb(b.scope, _terms)
             else '{}'::jsonb end,
           embedding = case when hit.text_hit then null else b.embedding end
      from hit
     where b.id = hit.id and b.fund_id = _fund_id
    returning b.id, b.text, hit.text_hit, hit.had_vector
  )
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'text', c.text))
                    filter (where c.text_hit and c.had_vector), '[]'::jsonb)
    into v_lessons, v_embed
    from changed c;

  -- The lessons' count log (append-only, open to the GDPR functions).
  update public.brain_bullet_events e
     set reason = public.gdpr_replace_terms(e.reason, _terms)
   where e.fund_id = _fund_id and e.reason ~* v_pattern;
  get diagnostics v_events = row_count;

  perform set_config('brain.change_note', '', true);
  perform set_config('brain.gdpr', 'off', true);
  return jsonb_build_object(
    'pagesMasked', v_pages,
    'pageVersionsDeleted', v_versions,
    'lessonsMasked', v_lessons,
    'lessonEventsMasked', v_events,
    'lessonsToEmbed', v_embed
  );
end;
$$;

-- The entry point (0072) with the pages and lessons: Brain first (knows the entity), then the
-- derived stores, then the raw person.
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
  v_who jsonb := public.gdpr_person_terms(_fund_id, _person_id, _entity_id);
  v_terms text[] := array(select jsonb_array_elements_text(v_who -> 'terms'));
  v_entities uuid[] := array(select (jsonb_array_elements_text(v_who -> 'entity_ids'))::uuid);
  v_person uuid := nullif(v_who ->> 'person_id', '')::uuid;
  v_raw jsonb;
  v_brain jsonb;
  v_own_pages int;
begin
  -- Rå data først: den maskerede tekst er det, en senere capture læser. Selve rækken i people
  -- slettes sidst i samme transaktion, efter at Brain har brugt entiteten.
  v_raw := public.gdpr_forget_person_raw(_fund_id, null, v_terms);
  -- The person's own pages go with the entity (cascade, versions included).
  select count(*)::int into v_own_pages
    from public.brain_pages p
   where p.fund_id = _fund_id and p.entity_id = any (v_entities);
  v_brain := public.brain_forget_person(_fund_id, v_person, v_entities, v_terms);
  v_brain := v_brain || jsonb_build_object('pagesDeleted', v_own_pages)
             || public.brain_forget_person_derived(_fund_id, v_terms);
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
revoke all on function public.brain_pages_guard(), public.brain_pages_history()
  from public, anon, authenticated;
revoke all on function public.brain_sections_text(jsonb) from public, anon, authenticated;
revoke all on function public.brain_page_fts(text, jsonb) from public, anon, authenticated;
revoke all on function public.brain_section_hits(jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function public.brain_pages_forget_refs(uuid, uuid[], text[], text)
  from public, anon, authenticated;
revoke all on function public.brain_forget_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_forget_person_derived(uuid, text[])
  from public, anon, authenticated;
revoke all on function public.gdpr_forget_person(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.brain_sections_text(jsonb) to service_role;
grant execute on function public.brain_page_fts(text, jsonb) to service_role;
grant execute on function public.brain_section_hits(jsonb, text[], text[]) to service_role;
grant execute on function public.brain_pages_forget_refs(uuid, uuid[], text[], text) to service_role;
grant execute on function public.brain_forget_source(uuid, uuid) to service_role;
grant execute on function public.brain_forget_person_derived(uuid, text[]) to service_role;
grant execute on function public.gdpr_forget_person(uuid, uuid, uuid) to service_role;

commit;
