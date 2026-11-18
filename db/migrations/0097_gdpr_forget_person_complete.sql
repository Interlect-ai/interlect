-- 0097 · "Glem person" gjort færdig.
--
-- 0072/0082/0092 fjernede personen fra alle lagre, men fire ting manglede:
--
--   1. Filer i Storage. Navnet står i selve filen (deck, regnskab, upload til Brain), og en ny
--      analyse eller en ny indlæsning læser filen igen og skriver navnet tilbage. Glemslen finder
--      nu filerne, der nævner personen (dokumentets tekst og filnavn, kildens titel og tekst),
--      før teksten maskeres. Med _remove_files mærkes casens filer som fjernet
--      (documents.file_removed_at) og Brain-kildens sti tømmes; serveren sletter selve filerne
--      før kaldet (gdpr_person_preview giver stierne) og igen efter det (stierne står i svaret).
--      Casens fil får en ny sti, da objektnavnet kan bære filnavnet og dermed navnet. Den udtrukne tekst bliver, maskeret. Uden _remove_files
--      røres filerne ikke, og antallet står i svaret. gdpr_person_preview viser navn og filer,
--      før nogen trykker "Glem".
--   2. Aliaser og fornavne. Alle aliaser på personens entitet blev maskeret i hele fonden; et
--      alias som "CEO" eller "Anna" ramte alle andres tekst også, og en anden person-entitet med
--      det navn blev slettet. Nu er kun det, der ligner et fuldt navn (to ord med stort, e-mail,
--      LinkedIn), en fuld term. Øvrige aliaser og fornavn og efternavn alene er kontekst-termer
--      (markeret med "~" foran): de maskeres kun i en tekst, der også nævner et fuldt navn, og
--      ikke når de står ved siden af et andet navn med stort ("Anna Berg"). En entitet med samme
--      navn som et alias slettes ikke længere.
--   3. En lås mod L0/L1, der er i gang. Glemslen tager fondens lås eksklusivt og tæller op (0092).
--      Nu tager L0's opsamling og projektion låsen delt (de læser og skriver i én transaktion), og
--      det, L0, L1 og indlæsningen skriver efter et AI-kald (L1's fakta og entiteter, vektorer),
--      gemmes kun, hvis tælleren er den samme som før, de læste deres data. Ellers gemmes intet,
--      episoderne er stadig 'pending', og næste kørsel læser den maskerede tekst.
--   4. Episoder, hvor personen er eneste emne (alle episodens fakta har personen som subject),
--      slettes nu i stedet for at maskeres. Kommer episoden fra rå data, laver næste opsamling
--      den igen ud fra den maskerede tekst.
--
-- notCovered er nu nøgler, som brugerfladen oversætter: 'first_name_alone' (et fornavn alene i
-- en tekst, der ikke også nævner personen) og 'files_kept' (filer, der blev valgt fra).
--
-- Én ny kolonne (documents.file_removed_at). gdpr_forget_person får et nyt argument (den gamle
-- udgave fjernes). Nye funktioner kun for service_role. Ingen policy ændres.

begin;

set local lock_timeout = '5s';

alter table public.documents add column file_removed_at timestamptz;
comment on column public.documents.file_removed_at is
  'Sat af "Glem person" (0097): filen er slettet i Storage, den maskerede tekst er tilbage.';

-- ---------------------------------------------------------------------------
-- 1. Fulde termer og kontekst-termer ("~")
-- ---------------------------------------------------------------------------
-- Only full terms choose rows (a context term alone never makes a row a match).
create or replace function public.gdpr_term_pattern(_terms text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(public.gdpr_term_regex(t), '|' order by char_length(t) desc, t)
  from (select distinct btrim(x) as t from unnest(_terms) as u(x)
        where x is not null and btrim(x) not like '~%' and char_length(btrim(x)) >= 3) s;
$$;

-- The JSON form of each term keeps its "~".
create or replace function public.gdpr_json_terms(_terms text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v.v), '{}')
  from (
    select case when btrim(x) like '~%' then '~' else '' end as p,
           btrim(ltrim(btrim(x), '~')) as t
    from unnest(_terms) as u(x)
    where x is not null
  ) s
  cross join lateral (values
    (s.p || s.t),
    (s.p || substr(to_json(s.t)::text, 2, char_length(to_json(s.t)::text) - 2))
  ) as v(v)
  where char_length(s.t) >= 3;
$$;

-- Full terms first (longest first). Context terms only in a text that names a full term, with
-- case, and never next to another name: not before a capitalised word ("Anna Berg"), and not
-- after a capitalised word in the middle of a sentence ("og Peter Hansen"); after the first word
-- of a sentence ("Hej Anna") they are masked.
create or replace function public.gdpr_replace_terms(
  _text text,
  _terms text[],
  _replacement text default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_term record;
  v_text text := _text;
  v_full text;
  v_context boolean;
begin
  if _text is null then
    return _text;
  end if;
  v_full := public.gdpr_term_pattern(_terms);
  v_context := v_full is not null and _text ~* v_full;
  for v_term in
    select t, c from (
      select distinct btrim(ltrim(btrim(x), '~')) as t, btrim(x) like '~%' as c
      from unnest(_terms) as u(x)
      where x is not null) s
    where char_length(t) >= 3 and (not c or v_context)
    order by c, char_length(t) desc, t
  loop
    v_text := regexp_replace(
      v_text,
      case when v_term.c
        then '(?<![[:alpha:],;:]\s+[[:upper:]][[:alpha:]]*\s)' || public.gdpr_term_regex(v_term.t)
             || '(?!\s+[[:upper:]])'
        else public.gdpr_term_regex(v_term.t) end,
      coalesce(_replacement, case
        when char_length(v_term.t) >= 15 then '[slettet person]'
        when char_length(v_term.t) >= 9 then '[slettet]'
        else '[x]' end),
      case when v_term.c then 'g' else 'gi' end);
  end loop;
  return v_text;
end;
$$;

-- Is an alias a name of its own? An e-mail or a LinkedIn address, or two words or more that all
-- start with a capital (initials allowed first, name particles like "van" or "af" inside), the
-- first not an acronym ("CEO Ole") and the last a word ("D. L. Kjær" yes, "Head of Product" no).
create or replace function private.gdpr_name_like(_alias text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with w as (select regexp_split_to_array(btrim(coalesce(_alias, '')), '\s+') as w)
  select case
    when _alias is null or char_length(btrim(_alias)) < 3 then false
    when btrim(_alias) ~ '@|://|linkedin\.' then true
    else array_length(w.w, 1) >= 2
         and w.w[1] ~ '^[[:upper:]]([[:lower:]]|\.)'
         and w.w[array_length(w.w, 1)] ~ '^[[:upper:]][[:lower:]]'
         and not exists (
           select 1 from unnest(w.w) as x(word)
            where x.word !~ '^[[:upper:]]'
              and lower(x.word) not in ('van', 'von', 'de', 'der', 'den', 'af', 'la', 'le', 'du',
                                        'da', 'di', 'del', 'ten', 'ter'))
  end
  from w;
$$;

-- Who is the person? As 0072, but only the person's own names and name-like aliases are full
-- terms and find the person's other entities; other aliases and the first and last name alone are
-- context terms.
create or replace function public.gdpr_person_terms(_fund_id uuid, _person_id uuid, _entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person_id uuid := _person_id;
  v_full text[] := '{}';
  v_names text[] := '{}';
  v_context text[] := '{}';
  v_entities uuid[] := '{}';
  v_person record;
  v_entity record;
  v_matches uuid[];
  v_primary text;
  v_person_name text;
  v_terms text[];
begin
  if _fund_id is null or (_person_id is null and _entity_id is null) then
    raise exception 'gdpr_person_terms: fund and a person or an entity are required';
  end if;

  if _entity_id is not null then
    select e.* into v_entity
      from public.brain_entities e
     where e.id = _entity_id and e.fund_id = _fund_id and e.type = 'person';
    if not found then
      raise exception 'gdpr_person_terms: unknown person' using errcode = 'P0002';
    end if;
    v_primary := v_entity.name;
    v_names := array[v_entity.name]
               || array(select a from unnest(v_entity.aliases) a where private.gdpr_name_like(a));
    v_context := array(select a from unnest(v_entity.aliases) a where not private.gdpr_name_like(a));
    if v_person_id is null and v_entity.ref_table = 'people' then
      v_person_id := v_entity.ref_id;
    end if;
  end if;

  if v_person_id is not null then
    select p.* into v_person from public.people p where p.id = v_person_id and p.fund_id = _fund_id;
    if found then
      v_primary := v_person.full_name;
      v_person_name := v_person.full_name;
      v_full := array[v_person.full_name, v_person.email, v_person.linkedin_url];
      v_names := v_names || array[v_person.full_name];
    elsif _entity_id is null then
      raise exception 'gdpr_person_terms: unknown person' using errcode = 'P0002';
    else
      v_person_id := null;
    end if;
  elsif _entity_id is not null then
    select array_agg(p.id) into v_matches
      from public.people p
     where p.fund_id = _fund_id and lower(btrim(p.full_name)) = any (select lower(btrim(n)) from unnest(v_names) n);
    if cardinality(v_matches) = 1 then
      v_person_id := v_matches[1];
      select p.* into v_person from public.people p where p.id = v_person_id;
      v_person_name := v_person.full_name;
      v_full := array[v_person.full_name, v_person.email, v_person.linkedin_url];
    end if;
  end if;

  -- The same person's entities, found by the person's full name and name-like names only: a
  -- single word ("Anna") or an alias like "CEO" is someone else's name too.
  select coalesce(array_agg(distinct e.id), '{}') into v_entities
    from public.brain_entities e
   where e.fund_id = _fund_id and e.type = 'person'
     and (e.id = _entity_id
          or (v_person_id is not null and e.ref_table = 'people' and e.ref_id = v_person_id)
          or e.merged_into = _entity_id
          or lower(btrim(e.name)) = any (
               select lower(btrim(n)) from unnest(v_names) n
                where char_length(btrim(n)) >= 3
                  and (private.gdpr_name_like(n) or lower(btrim(n)) = lower(btrim(v_person_name)))));

  -- And the duplicates merged into any of them (also when the raw person was given).
  select v_entities || coalesce(array_agg(e.id), '{}') into v_entities
    from public.brain_entities e
   where e.fund_id = _fund_id and e.type = 'person'
     and e.merged_into = any (v_entities) and not (e.id = any (v_entities));

  -- The given entity's own name and the raw person's name are full terms; another linked entity's
  -- name (a merged "Anna") only when it looks like a name.
  select v_full || v_names || coalesce(array_agg(x.n) filter (where x.full), '{}'),
         v_context || coalesce(array_agg(x.n) filter (where not x.full), '{}')
    into v_full, v_context
    from (
      select e.name as n,
             e.id = _entity_id or private.gdpr_name_like(e.name)
               or lower(btrim(e.name)) = lower(btrim(v_person_name)) as full
        from public.brain_entities e where e.id = any (v_entities)
      union
      select a, private.gdpr_name_like(a)
        from public.brain_entities e, unnest(e.aliases) as a
       where e.id = any (v_entities)
    ) x;

  select coalesce(array_agg(distinct btrim(t)), '{}') into v_full
    from unnest(v_full) as u(t)
   where t is not null and char_length(btrim(t)) >= 3;
  if cardinality(v_full) = 0 then
    raise exception 'gdpr_person_terms: no usable name' using errcode = 'GD001';
  end if;

  -- First and last name alone, from each full name of two words or more (not an address).
  select v_context || coalesce(array_agg(w), '{}') into v_context
    from (
      select (regexp_split_to_array(t, '\s+'))[1] as w from unnest(v_full) t
       where t !~ '@|://' and t ~ '\s'
      union
      select (regexp_split_to_array(t, '\s+'))[array_length(regexp_split_to_array(t, '\s+'), 1)]
        from unnest(v_full) t
       where t !~ '@|://' and t ~ '\s'
    ) words;

  select v_full || coalesce(array_agg(distinct '~' || btrim(c)), '{}') into v_terms
    from unnest(v_context) as u(c)
   where c is not null and char_length(btrim(c)) >= 3
     and lower(btrim(c)) <> all (select lower(f) from unnest(v_full) f);

  return jsonb_build_object(
    'person_id', v_person_id,
    'entity_ids', to_jsonb(v_entities),
    'terms', to_jsonb(v_terms),
    'primary_name', v_primary
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Filerne, der nævner personen
-- ---------------------------------------------------------------------------
-- Read before the text is masked: the case's files (text or file name) and Brain's sources
-- (title, file name or the text of their episodes and chunks) that hold a full term.
create or replace function private.gdpr_person_files(_fund_id uuid, _terms text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select public.gdpr_term_pattern(_terms) as v)
  select coalesce(jsonb_agg(f order by f ->> 'kind', f ->> 'name'), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', 'document', 'id', d.id, 'name', d.file_name,
                              'bucket', 'pitch-decks', 'path', d.storage_path) as f
      from public.documents d, p
     where d.fund_id = _fund_id and d.file_removed_at is null and p.v is not null
       and (d.extracted_text ~* p.v or d.file_name ~* p.v)
    union all
    select jsonb_build_object('kind', 'brain_source', 'id', s.id,
                              'name', coalesce(s.file_name, s.title),
                              'bucket', 'brain-sources', 'path', s.storage_path)
      from public.brain_sources s, p
     where s.fund_id = _fund_id and s.storage_path is not null and p.v is not null
       and (s.title ~* p.v or s.file_name ~* p.v
            or exists (select 1 from public.brain_episodes e
                        where e.fund_id = _fund_id and e.brain_source_id = s.id
                          and (e.content ~* p.v or e.title ~* p.v))
            or exists (select 1 from public.brain_episodes e
                         join public.brain_chunks c on c.episode_id = e.id and c.fund_id = e.fund_id
                        where e.fund_id = _fund_id and e.brain_source_id = s.id
                          and c.content ~* p.v))
  ) files;
$$;

-- Before "Glem" (no change): the name and the files that name the person. The dialog gets the
-- kind and name; the server deletes the files from Storage before the forgetting (bucket, path).
create or replace function public.gdpr_person_preview(
  _fund_id uuid,
  _person_id uuid default null,
  _entity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_who jsonb := public.gdpr_person_terms(_fund_id, _person_id, _entity_id);
  v_files jsonb;
begin
  v_files := private.gdpr_person_files(
    _fund_id, array(select jsonb_array_elements_text(v_who -> 'terms')));
  return jsonb_build_object(
    'name', v_who ->> 'primary_name',
    'files', v_files
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Indgangen (0092) med filer og episoder, hvor personen er eneste emne
-- ---------------------------------------------------------------------------
drop function public.gdpr_forget_person(uuid, uuid, uuid);

create function public.gdpr_forget_person(
  _fund_id uuid,
  _person_id uuid default null,
  _entity_id uuid default null,
  _remove_files boolean default false
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
  v_files jsonb;
  v_sole int := 0;
  v_not_covered jsonb := jsonb_build_array('first_name_alone');
begin
  if _fund_id is null then
    raise exception 'gdpr_forget_person: fund is required';
  end if;
  perform private.brain_forget_begin(_fund_id);

  v_who := public.gdpr_person_terms(_fund_id, _person_id, _entity_id);
  v_terms := array(select jsonb_array_elements_text(v_who -> 'terms'));
  v_entities := array(select (jsonb_array_elements_text(v_who -> 'entity_ids'))::uuid);
  v_person := nullif(v_who ->> 'person_id', '')::uuid;

  -- The files, while their text still names the person.
  v_files := private.gdpr_person_files(_fund_id, v_terms);
  if coalesce(_remove_files, false) then
    -- The object's name can hold the file name, and with it the person's name.
    update public.documents d
       set file_removed_at = now(),
           storage_path = _fund_id::text || '/forgotten/' || d.id::text
     where d.fund_id = _fund_id
       and d.id in (select (f ->> 'id')::uuid from jsonb_array_elements(v_files) f
                     where f ->> 'kind' = 'document');
    update public.brain_sources s set storage_path = null
     where s.fund_id = _fund_id
       and s.id in (select (f ->> 'id')::uuid from jsonb_array_elements(v_files) f
                     where f ->> 'kind' = 'brain_source');
  elsif jsonb_array_length(v_files) > 0 then
    v_not_covered := v_not_covered || jsonb_build_array('files_kept');
  end if;

  v_raw := public.gdpr_forget_person_raw(_fund_id, null, v_terms);
  select count(*)::int into v_own_pages
    from public.brain_pages p
   where p.fund_id = _fund_id and p.entity_id = any (v_entities);

  -- Episodes only about the person (every fact read from them has the person as subject) go,
  -- when they come from raw data (the next capture makes them again from the masked text). An
  -- upload's or an answer's episode holds more than the facts read from it: it is masked instead.
  delete from public.brain_episodes e
   where e.fund_id = _fund_id
     and e.ref_table is not null and e.ref_table <> 'people'
     and e.brain_source_id is null and e.kind <> 'answer'
     and exists (select 1 from public.brain_fact_episodes fe
                  where fe.episode_id = e.id and fe.fund_id = _fund_id)
     and not exists (select 1 from public.brain_fact_episodes fe
                       join public.brain_facts f on f.id = fe.fact_id and f.fund_id = fe.fund_id
                      where fe.episode_id = e.id and fe.fund_id = _fund_id
                        and (f.subject_id is null or not (f.subject_id = any (v_entities))));
  get diagnostics v_sole = row_count;

  v_brain := public.brain_forget_person(_fund_id, v_person, v_entities, v_terms);
  v_names := public.brain_forget_person_names(_fund_id, v_terms);
  v_brain := v_brain || jsonb_build_object(
               'pagesDeleted', v_own_pages,
               'entitiesRenamed', (v_names -> 'entitiesRenamed'),
               'episodesDeleted', coalesce((v_brain ->> 'episodesDeleted')::int, 0) + v_sole)
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
    -- The server deleted the files it was shown before this call; it deletes these once more after
    -- the commit (a file added in between). Server only: an object's path can hold its file name.
    'filesToRemove', case when coalesce(_remove_files, false)
      then coalesce((select jsonb_agg(jsonb_build_object('kind', f ->> 'kind', 'id', f ->> 'id',
                                                         'bucket', f ->> 'bucket', 'path', f ->> 'path'))
                       from jsonb_array_elements(v_files) f), '[]'::jsonb)
      else '[]'::jsonb end,
    'filesKept', case when coalesce(_remove_files, false) then 0 else jsonb_array_length(v_files) end,
    'notCovered', v_not_covered
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Låsen for L0, L1 og indlæsningen
-- ---------------------------------------------------------------------------
-- Waits for a forgetting that is being saved, then: has anything been forgotten since `_generation`
-- was read (brain_forget_generation, before the data)? The lock is held to the end of the caller.
create or replace function private.brain_forget_unchanged(_fund_id uuid, _generation bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _fund_id is null or _generation is null then
    raise exception 'brain_forget_unchanged: fund and the forget generation are required';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('brain_forget:' || _fund_id::text, 0));
  return public.brain_forget_generation(_fund_id) = _generation;
end;
$$;

-- L0 reads raw data and writes Brain in one transaction: holding the lock shared is enough.
create or replace function public.brain_capture_case_checked(_fund_id uuid, _case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('brain_forget:' || _fund_id::text, 0));
  return public.brain_capture_case(_fund_id, _case_id);
end;
$$;

create or replace function public.brain_project_db_entities_checked(_fund_id uuid, _case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('brain_forget:' || _fund_id::text, 0));
  return public.brain_project_db_entities(_fund_id, _case_id);
end;
$$;

-- L1's batch was read before its model calls: nothing is saved when something was forgotten since.
create or replace function public.brain_apply_extraction_checked(
  _fund_id uuid,
  _case_id uuid,
  _job_id uuid,
  _batch jsonb,
  _forget_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.brain_forget_unchanged(_fund_id, _forget_generation) then
    return jsonb_build_object('skipped', 'forgotten');
  end if;
  return public.brain_apply_extraction(_fund_id, _case_id, _job_id, _batch);
end;
$$;

create or replace function public.brain_apply_extraction_source_checked(
  _fund_id uuid,
  _source_id uuid,
  _job_id uuid,
  _batch jsonb,
  _forget_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.brain_forget_unchanged(_fund_id, _forget_generation) then
    return jsonb_build_object('skipped', 'forgotten');
  end if;
  return public.brain_apply_extraction_source(_fund_id, _source_id, _job_id, _batch);
end;
$$;

-- Vectors made from text read before the embedding call. Rows: {table: chunk|fact|entity, id,
-- embedding, model?, onlyIfNull?, notCase?}. Nothing is stored when something was forgotten since:
-- the forgetting may have masked the text and emptied the vector after it was read.
create or replace function public.brain_store_vectors(
  _fund_id uuid,
  _forget_generation bigint,
  _rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_stored int := 0;
  v_n int;
begin
  if jsonb_typeof(_rows) is distinct from 'array' then
    raise exception 'brain_store_vectors: rows must be an array';
  end if;
  if not private.brain_forget_unchanged(_fund_id, _forget_generation) then
    return jsonb_build_object('skipped', 'forgotten', 'stored', 0);
  end if;
  for v_row in
    select * from jsonb_to_recordset(_rows)
      as x("table" text, id uuid, embedding text, model text, "onlyIfNull" boolean, "notCase" boolean)
  loop
    if v_row."table" = 'chunk' then
      update public.brain_chunks c
         set embedding = v_row.embedding::public.vector,
             embedding_model = coalesce(v_row.model, c.embedding_model)
       where c.id = v_row.id and c.fund_id = _fund_id
         and (not coalesce(v_row."onlyIfNull", false) or c.embedding is null);
    elsif v_row."table" = 'fact' then
      update public.brain_facts f
         set embedding = v_row.embedding::public.vector
       where f.id = v_row.id and f.fund_id = _fund_id
         and (not coalesce(v_row."onlyIfNull", false) or f.embedding is null);
    elsif v_row."table" = 'entity' then
      update public.brain_entities e
         set embedding = v_row.embedding::public.vector
       where e.id = v_row.id and e.fund_id = _fund_id
         and (not coalesce(v_row."onlyIfNull", false) or e.embedding is null)
         and (not coalesce(v_row."notCase", false) or e.type <> 'case');
    else
      raise exception 'brain_store_vectors: unknown table %', v_row."table";
    end if;
    get diagnostics v_n = row_count;
    v_stored := v_stored + v_n;
  end loop;
  return jsonb_build_object('stored', v_stored);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rettigheder: kun serveren
-- ---------------------------------------------------------------------------
revoke all on function private.gdpr_name_like(text) from public, anon, authenticated;
revoke all on function private.gdpr_person_files(uuid, text[]) from public, anon, authenticated;
revoke all on function private.brain_forget_unchanged(uuid, bigint) from public, anon, authenticated;
revoke all on function public.gdpr_person_terms(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.gdpr_person_preview(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.gdpr_forget_person(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.brain_capture_case_checked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_project_db_entities_checked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_apply_extraction_checked(uuid, uuid, uuid, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.brain_apply_extraction_source_checked(uuid, uuid, uuid, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.brain_store_vectors(uuid, bigint, jsonb) from public, anon, authenticated;

grant execute on function public.gdpr_person_terms(uuid, uuid, uuid) to service_role;
grant execute on function public.gdpr_person_preview(uuid, uuid, uuid) to service_role;
grant execute on function public.gdpr_forget_person(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.brain_capture_case_checked(uuid, uuid) to service_role;
grant execute on function public.brain_project_db_entities_checked(uuid, uuid) to service_role;
grant execute on function public.brain_apply_extraction_checked(uuid, uuid, uuid, jsonb, bigint)
  to service_role;
grant execute on function public.brain_apply_extraction_source_checked(uuid, uuid, uuid, jsonb, bigint)
  to service_role;
grant execute on function public.brain_store_vectors(uuid, bigint, jsonb) to service_role;

commit;
