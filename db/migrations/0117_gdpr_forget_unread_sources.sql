-- 0117 · "Glem person" rammer også kilder, der ikke er læst ind, og "Find med Brain".
--
-- Private.gdpr_person_files (0097) fandt kun en Brain-kilde, hvis navnet stod i titel,
-- filnavn eller dens episoder/chunks. En upload, der venter på "Læs ind", eller en kilde midt i
-- extract/classify, har ingen episoder endnu: den blev ikke rørt, og når den blev godkendt (eller
-- køen prøvede igen), læste indlæsningen den originale fil og gemte navnet igen, umaskeret.
--   1. gdpr_unread_sources giver serveren de kilder, hvis fil endnu ikke er læst (fil, ingen
--      episoder). Serveren læser filerne (samme udtræk som indlæsningen, ingen AI) og spørger
--      gdpr_texts_name_person, hvilke tekster der nævner personen (de samme fulde termer).
--   2. gdpr_forget_person får de kilder, der nævner personen (_unread_source_ids), og tager dem med
--      i fillisten: med _remove_files tømmes stien, og serveren sletter filen, som for de øvrige.
--      Vælges filerne fra, sættes kilden tilbage til "skal godkendes" (approved_at tømmes, status
--      queued), så intet læser filen igen, før et menneske har trykket "Læs ind" på ny.
--
-- "Find med Brain" (0107) gemmer et citat fra casens materiale eller en webside
-- (case_field_proposals.quote, source_title, source_url), og "Sæt ind" kopierer titel, citat og
-- adresse til case_financial_inputs.source_note og source_url. De seks kolonner står nu på
-- gdpr_forget_person_raw's liste.
-- Adressen tømmes i stedet for at maskeres (den skal begynde med http, og hele adressen kan være
-- personens LinkedIn).
--
-- Ingen tabeller ændres. gdpr_forget_person får et nyt argument (den gamle udgave fjernes). Nye
-- funktioner kun for service_role. Ingen policy ændres.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Kilder, hvis fil endnu ikke er læst ind
-- ---------------------------------------------------------------------------
-- A file and no episodes: waiting for "Læs ind", in extract/classify, or failed before the chunks.
create or replace function public.gdpr_unread_sources(_fund_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.kind, 'name', coalesce(s.file_name, s.title),
           'fileName', s.file_name, 'path', s.storage_path, 'pageLimit', s.page_limit)
           order by s.created_at), '[]'::jsonb)
    from public.brain_sources s
   where s.fund_id = _fund_id
     and s.storage_path is not null
     and s.status <> 'ready'
     and not exists (select 1 from public.brain_episodes e
                      where e.fund_id = s.fund_id and e.brain_source_id = s.id);
$$;

-- Which of the texts name the person (a full term, as gdpr_person_files).
create or replace function public.gdpr_texts_name_person(_terms text[], _texts text[])
returns boolean[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(coalesce(p.v is not null and t.x ~* p.v, false) order by t.n), '{}')
    from unnest(_texts) with ordinality as t(x, n)
   cross join (select public.gdpr_term_pattern(_terms) as v) p;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rådata: "Find med Brain"-citaterne
-- ---------------------------------------------------------------------------
create or replace function public.gdpr_forget_person_raw(
  _fund_id uuid,
  _person_id uuid,
  _terms text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pattern text := public.gdpr_term_pattern(_terms);
  v_json_pattern text := public.gdpr_term_pattern(public.gdpr_json_terms(_terms));
  v_json_terms text[] := public.gdpr_json_terms(_terms);
  v_target record;
  v_rows int;
  v_masked jsonb := '{}'::jsonb;
  v_people int := 0;
begin
  if _fund_id is null or v_pattern is null then
    raise exception 'gdpr_forget_person_raw: fund and terms are required';
  end if;

  -- Maskeringen er ingen handling på casen: den flytter ikke "sidste handling" og må ændre
  -- den ellers uforanderlige overgangslog (kun fritekstfelterne).
  perform set_config('brain.retention', 'on', true);
  perform set_config('brain.gdpr', 'on', true);

  for v_target in
    select * from (values
      ('analysis_findings', 'statement', 'text'),
      ('analysis_runs', 'error_message', 'text'),
      ('analysis_runs', 'raw_response', 'jsonb'),
      ('analysis_runs', 'validation_result', 'jsonb'),
      ('analysis_run_steps', 'error_message', 'text'),
      ('analysis_run_steps', 'output_json', 'jsonb'),
      ('case_notes', 'body', 'text'),
      ('case_tasks', 'title', 'text'),
      ('case_tasks', 'description', 'text'),
      ('case_tasks', 'why', 'text'),
      ('case_tasks', 'answer_text', 'text'),
      ('case_tasks', 'answer_value', 'jsonb'),
      ('case_transition_events', 'reason', 'text'),
      ('case_transition_events', 'note', 'text'),
      ('category_scores', 'rationale', 'text'),
      ('companies', 'description', 'text'),
      ('companies', 'identity_signals', 'jsonb'),
      ('companies', 'profile_source', 'jsonb'),
      ('documents', 'extracted_text', 'text'),
      ('documents', 'file_name', 'text'),
      ('sources', 'title', 'text'),
      ('sources', 'url', 'text'),
      ('inbound_messages', 'sender_email', 'text'),
      ('inbound_messages', 'recipient_email', 'text'),
      ('inbound_messages', 'subject', 'text'),
      ('inbound_messages', 'text_body', 'text'),
      ('inbound_messages', 'error_message', 'text'),
      ('case_messages', 'body', 'text'),
      ('cases', 'source_note', 'text'),
      ('cases', 'workspace_reason', 'text'),
      ('case_origins', 'source_reference', 'text'),
      ('scanner_signals', 'entity_name', 'text'),
      ('scanner_signals', 'title', 'text'),
      ('scanner_signals', 'summary', 'text'),
      ('scanner_signals', 'url', 'text'),
      ('scanner_signals', 'raw_payload', 'jsonb'),
      ('historical_investments', 'note', 'text'),
      ('evidence_items', 'claim', 'text'),
      ('evidence_items', 'excerpt', 'text'),
      ('evidence_items', 'stated_by', 'text'),
      ('evidence_items', 'value_text', 'text'),
      ('recommendations', 'rationale', 'text'),
      ('risks', 'statement', 'text'),
      ('risks', 'mitigation', 'text'),
      -- "Find med Brain" (0107, T-787): the quote and its source, and the note "Sæt ind" copies.
      ('case_field_proposals', 'quote', 'text'),
      ('case_field_proposals', 'source_title', 'text'),
      ('case_field_proposals', 'source_url', 'url'),
      ('case_financial_inputs', 'source_note', 'text'),
      ('case_financial_inputs', 'source_url', 'url')
    ) as t(tbl, col, kind)
  loop
    if v_target.kind = 'jsonb' then
      execute format(
        'update public.%1$I t set %2$I = public.gdpr_replace_terms_jsonb(t.%2$I, $1) '
        'where t.fund_id = $2 and t.%2$I::text ~* $3',
        v_target.tbl, v_target.col)
        using _terms, _fund_id, v_json_pattern;
    elsif v_target.kind = 'url' then
      -- An address must stay an address (check ^https?://): emptied, not masked.
      execute format(
        'update public.%1$I t set %2$I = null where t.fund_id = $1 and t.%2$I ~* $2',
        v_target.tbl, v_target.col)
        using _fund_id, v_pattern;
    else
      execute format(
        'update public.%1$I t set %2$I = public.gdpr_replace_terms(t.%2$I, $1) '
        'where t.fund_id = $2 and t.%2$I ~* $3',
        v_target.tbl, v_target.col)
        using _terms, _fund_id, v_pattern;
    end if;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_masked := v_masked || jsonb_build_object(v_target.tbl || '.' || v_target.col, v_rows);
    end if;
  end loop;

  perform set_config('brain.gdpr', 'off', true);
  perform set_config('brain.retention', 'off', true);

  -- Selve personen. company_people følger med (on delete cascade), og triggeren fra 0042 fjerner
  -- den projicerede Brain-entitet.
  if _person_id is not null then
    delete from public.people p where p.id = _person_id and p.fund_id = _fund_id;
    get diagnostics v_people = row_count;
  end if;

  return jsonb_build_object('peopleDeleted', v_people, 'rawMasked', v_masked);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Indgangen (0097) med de ulæste kilder, der nævner personen
-- ---------------------------------------------------------------------------
drop function public.gdpr_forget_person(uuid, uuid, uuid, boolean);

create function public.gdpr_forget_person(
  _fund_id uuid,
  _person_id uuid default null,
  _entity_id uuid default null,
  _remove_files boolean default false,
  _unread_source_ids uuid[] default '{}'
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
  v_unread jsonb;
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
  -- And the sources not read in yet whose file the server found the name in (T-786): their text
  -- is in no table, so only the server can read it. Only sources that are still unread
  -- (gdpr_unread_sources): a source that is read in is found by its text above.
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'brain_source', 'id', s.id,
                                               'name', coalesce(s.file_name, s.title),
                                               'bucket', 'brain-sources', 'path', s.storage_path)),
                  '[]'::jsonb)
    into v_unread
    from public.brain_sources s
   where s.fund_id = _fund_id and s.storage_path is not null and s.status <> 'ready'
     and s.id = any (coalesce(_unread_source_ids, '{}'))
     and not exists (select 1 from public.brain_episodes e
                      where e.fund_id = s.fund_id and e.brain_source_id = s.id)
     and not exists (select 1 from jsonb_array_elements(v_files) f
                      where f ->> 'kind' = 'brain_source' and f ->> 'id' = s.id::text);
  v_files := v_files || v_unread;

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
    -- A kept file that is not read in yet is not read before a person presses "Læs ind" again:
    -- a waiting upload or a retry would store the name, unmasked, now the person is gone. Also
    -- one found by its title or file name above.
    update public.brain_sources s
       set approved_at = null, approved_by = null, status = 'queued', step = null,
           failed_step = null, error_message = null
     where s.fund_id = _fund_id and s.status <> 'ready'
       and s.id in (select (f ->> 'id')::uuid from jsonb_array_elements(v_files) f
                     where f ->> 'kind' = 'brain_source')
       and not exists (select 1 from public.brain_episodes e
                        where e.fund_id = s.fund_id and e.brain_source_id = s.id);
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
-- 4. Rettigheder: kun serveren
-- ---------------------------------------------------------------------------
revoke all on function public.gdpr_unread_sources(uuid) from public, anon, authenticated;
revoke all on function public.gdpr_texts_name_person(text[], text[]) from public, anon, authenticated;
revoke all on function public.gdpr_forget_person(uuid, uuid, uuid, boolean, uuid[])
  from public, anon, authenticated;

grant execute on function public.gdpr_unread_sources(uuid) to service_role;
grant execute on function public.gdpr_texts_name_person(text[], text[]) to service_role;
grant execute on function public.gdpr_forget_person(uuid, uuid, uuid, boolean, uuid[]) to service_role;

commit;
