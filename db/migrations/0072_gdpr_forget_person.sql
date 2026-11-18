-- Platform · migration 0072 · "Glem person" (registreredes ret)
--
-- gdpr_forget_person(fund, person_id, entity_id) fjerner en person fra alle lagre, der findes nu:
--   * rå data: people (company_people ved cascade) slettes; navn, e-mail og LinkedIn
--     maskeres i al fritekst, som Brains capture læser fra (evidens, fund, risici, anbefalinger,
--     noter, opgaver, dokumenttekst, overgangslog, analysekørsler og analysetrin
--     (analysis_run_steps.output_json)). Maskeres rå data ikke, ville næste capture genskabe navnet.
--   * Brain: personens entitet(er) og alle fakta med personen som subject eller object slettes
--     (inkl. citater), øvrige fakta, entiteter, episoder, tekststykker, indsigter, chat (beskeder,
--     tråde, søgelog, feedback), eval-spørgsmål, historik og fondens gamle hukommelse maskeres, og
--     brain_log maskeres. Tekststykker, hvis tekst er ændret, mister deres vektor og embeddes igen af
--     L0 (casen lægges i capture-køen); fondens gamle hukommelse embeddes igen af serveren.
--   * Maskeringen rammer hele navnet (mellemrum matcher også linjeskift), e-mail og LinkedIn-adressen, med
--     ordgrænser (et andet efternavn, der starter ens, røres ikke), og erstatningen er aldrig længere
--     end det, den erstatter. Ikke dækket (notCovered og): filer i Storage (decks, uploads),
--     enkeltfornavne uden efternavn og case_score_recalculations (uforanderlig log uden fritekst).
--
-- Funktionerne er security definer med search_path = '' og kun kaldbare af service_role. Revisionen
-- (audit_events med hash af navnet, aldrig navnet) skrives af serveren før kaldet.
-- Additiv: ingen eksisterende tabel, kolonne, policy eller grant ændres.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Hjælpefunktioner til maskering
-- ---------------------------------------------------------------------------
-- Regex for ét navn: mellemrum matcher al whitespace (også linjeskift fra PDF-tekst), og navnet må
-- ikke sidde midt i et andet ord eller et sammensat efternavn ("Anna Hansen" rammer ikke
-- "Anna Hansen-Berg" eller "Anna Hansens").
create or replace function public.gdpr_term_regex(_term text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '(?<![[:alnum:]])'
         || regexp_replace(regexp_replace(btrim(_term), '([.^$*+?(){}|\[\]\\])', '\\\1', 'g'), '\s+', '\\s+', 'g')
         || '(?![[:alnum:]]|-[[:alnum:]])';
$$;

-- Regex-alternation af de givne termer (længste først). null uden brugbare termer.
create or replace function public.gdpr_term_pattern(_terms text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(public.gdpr_term_regex(t), '|' order by char_length(t) desc, t)
  from (select distinct btrim(x) as t from unnest(_terms) as u(x)
        where x is not null and char_length(btrim(x)) >= 3) s;
$$;

-- Termerne plus deres JSON-form (anførselstegn og skråstreger escapet), så de også rammes i jsonb.
create or replace function public.gdpr_json_terms(_terms text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v), '{}')
  from (
    select btrim(x) as v from unnest(_terms) as u(x)
    union
    select substr(to_json(btrim(x))::text, 2, char_length(to_json(btrim(x))::text) - 2)
    from unnest(_terms) as u(x)
  ) s
  where v is not null and char_length(v) >= 3;
$$;

-- Erstatningen er aldrig længere end det, den erstatter, så en maskeret tekst ikke kan sprænge en
-- CHECK-grænse (8000 tegn i episoder, 4000 i noter ...): "[slettet person]" fra 15 tegn, "[slettet]"
-- fra 9, ellers "[x]". _replacement kan overstyre.
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
  v_term text;
  v_text text := _text;
begin
  if _text is null then
    return _text;
  end if;
  for v_term in
    select t from (select distinct btrim(x) as t from unnest(_terms) as u(x)
                   where x is not null and char_length(btrim(x)) >= 3) s
    order by char_length(t) desc, t
  loop
    v_text := regexp_replace(
      v_text,
      public.gdpr_term_regex(v_term),
      coalesce(_replacement, case
        when char_length(v_term) >= 15 then '[slettet person]'
        when char_length(v_term) >= 9 then '[slettet]'
        else '[x]' end),
      'gi');
  end loop;
  return v_text;
end;
$$;

create or replace function public.gdpr_replace_terms_jsonb(
  _json jsonb,
  _terms text[],
  _replacement text default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if _json is null then
    return _json;
  end if;
  return public.gdpr_replace_terms(_json::text, public.gdpr_json_terms(_terms), _replacement)::jsonb;
exception when others then
  -- Kan teksten ikke længere læses som JSON efter maskeringen, fjernes indholdet hellere end at blive.
  return jsonb_build_object('masked', true);
end;
$$;

-- Hvem er personen? Finder navne og entiteter ud fra den rå person og/eller Brain-entiteten.
create or replace function public.gdpr_person_terms(_fund_id uuid, _person_id uuid, _entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person_id uuid := _person_id;
  v_terms text[] := '{}';
  v_names text[] := '{}';
  v_entities uuid[] := '{}';
  v_person record;
  v_entity record;
  v_matches uuid[];
  v_primary text;
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
    v_names := array[v_entity.name] || v_entity.aliases;
    if v_person_id is null and v_entity.ref_table = 'people' then
      v_person_id := v_entity.ref_id;
    end if;
  end if;

  if v_person_id is not null then
    select p.* into v_person from public.people p where p.id = v_person_id and p.fund_id = _fund_id;
    if found then
      v_primary := v_person.full_name;
      v_terms := array[v_person.full_name, v_person.email, v_person.linkedin_url];
      v_names := v_names || array[v_person.full_name];
    elsif _entity_id is null then
      raise exception 'gdpr_person_terms: unknown person' using errcode = 'P0002';
    else
      v_person_id := null;
    end if;
  elsif _entity_id is not null then
    -- En person, som kun Brain har udtrukket: findes der netop én rå person med samme navn, er det
    -- den (så række, e-mail og LinkedIn-adresse også fjernes). Er det tvetydigt, bindes ingen.
    select array_agg(p.id) into v_matches
      from public.people p
     where p.fund_id = _fund_id and lower(btrim(p.full_name)) = any (select lower(btrim(n)) from unnest(v_names) n);
    if cardinality(v_matches) = 1 then
      v_person_id := v_matches[1];
      select p.* into v_person from public.people p where p.id = v_person_id;
      v_terms := array[v_person.full_name, v_person.email, v_person.linkedin_url];
    end if;
  end if;

  -- Alle person-entiteter for samme menneske: den rå persons, den angivne, de sammenflettede og de
  -- udtrukne dubletter (L1 opretter én pr. firma uden henvisning til people) med samme navn.
  select coalesce(array_agg(distinct e.id), '{}') into v_entities
    from public.brain_entities e
   where e.fund_id = _fund_id and e.type = 'person'
     and (e.id = _entity_id
          or (v_person_id is not null and e.ref_table = 'people' and e.ref_id = v_person_id)
          or e.merged_into = _entity_id
          or lower(btrim(e.name)) = any (select lower(btrim(n)) from unnest(v_names) n where char_length(btrim(n)) >= 3));

  select v_terms || coalesce(array_agg(x), '{}') into v_terms
    from (
      select e.name as x from public.brain_entities e where e.id = any (v_entities)
      union
      select unnest(e.aliases) from public.brain_entities e where e.id = any (v_entities)
    ) names;

  select coalesce(array_agg(distinct btrim(t)), '{}') into v_terms
    from unnest(v_terms) as u(t)
   where t is not null and char_length(btrim(t)) >= 3;
  if cardinality(v_terms) = 0 then
    raise exception 'gdpr_person_terms: no usable name' using errcode = 'GD001';
  end if;

  return jsonb_build_object(
    'person_id', v_person_id,
    'entity_ids', to_jsonb(v_entities),
    'terms', to_jsonb(v_terms),
    'primary_name', v_primary
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rå data: maskér fritekst, slet personen
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
      ('risks', 'mitigation', 'text')
    ) as t(tbl, col, kind)
  loop
    if v_target.kind = 'jsonb' then
      execute format(
        'update public.%1$I t set %2$I = public.gdpr_replace_terms_jsonb(t.%2$I, $1) '
        'where t.fund_id = $2 and t.%2$I::text ~* $3',
        v_target.tbl, v_target.col)
        using _terms, _fund_id, v_json_pattern;
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
-- 3. Brain
-- ---------------------------------------------------------------------------
create or replace function public.brain_forget_person(
  _fund_id uuid,
  _person_id uuid,
  _entity_ids uuid[],
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
  v_fact_ids uuid[];
  v_object_ids uuid[];
  v_episode record;
  v_masked_hash text;
  v_facts_deleted int := 0;
  v_facts_masked int := 0;
  v_quotes int := 0;
  v_entities_deleted int := 0;
  v_entities_masked int := 0;
  v_episodes_deleted int := 0;
  v_episodes_masked int := 0;
  v_chunks_masked int := 0;
  v_insights int := 0;
  v_messages int := 0;
  v_threads int := 0;
  v_events int := 0;
  v_feedback int := 0;
  v_eval int := 0;
  v_history int := 0;
  v_sources int := 0;
  v_log int := 0;
  v_memory jsonb := '[]'::jsonb;
  v_rows int;
  v_target record;
begin
  if _fund_id is null or v_pattern is null then
    raise exception 'brain_forget_person: fund and terms are required';
  end if;

  -- Fakta med personen som subject eller object slettes helt (citater følger med).
  select coalesce(array_agg(f.id), '{}') into v_fact_ids
    from public.brain_facts f
   where f.fund_id = _fund_id
     and (f.subject_id = any (_entity_ids) or f.object_id = any (_entity_ids));

  -- Personens egen identitets-episode (rå person) er hele personens, og slettes.
  delete from public.brain_episodes e
   where e.fund_id = _fund_id and e.ref_table = 'people' and e.ref_id = _person_id;
  get diagnostics v_episodes_deleted = row_count;

  v_object_ids := v_fact_ids || _entity_ids;

  delete from public.brain_facts f where f.fund_id = _fund_id and f.id = any (v_fact_ids);
  get diagnostics v_facts_deleted = row_count;

  delete from public.brain_entities e where e.fund_id = _fund_id and e.id = any (_entity_ids);
  get diagnostics v_entities_deleted = row_count;

  -- Øvrige fakta: tekst og vektor. Vektoren genskabes ikke for en maskeret tekst.
  update public.brain_facts f
     set statement = public.gdpr_replace_terms(f.statement, _terms),
         value_text = public.gdpr_replace_terms(f.value_text, _terms),
         embedding = null
   where f.fund_id = _fund_id
     and (f.statement ~* v_pattern or f.value_text ~* v_pattern);
  get diagnostics v_facts_masked = row_count;

  update public.brain_fact_episodes fe
     set quote = public.gdpr_replace_terms(fe.quote, _terms)
   where fe.fund_id = _fund_id and fe.quote ~* v_pattern;
  get diagnostics v_quotes = row_count;

  -- Entiteter, der nævner personen: beskrivelse (og vektor) og kælenavne. Skrives om i nat.
  update public.brain_entities en
     set summary = public.gdpr_replace_terms(en.summary, _terms),
         embedding = case when en.summary ~* v_pattern then null else en.embedding end,
         aliases = coalesce((
           select array_agg(a) from unnest(en.aliases) as x(a) where a !~* v_pattern), '{}'),
         dirty_at = now()
   where en.fund_id = _fund_id
     and (en.summary ~* v_pattern
          or exists (select 1 from unnest(en.aliases) as x(a) where a ~* v_pattern));
  get diagnostics v_entities_masked = row_count;

  -- Episoder: tekst og titel maskeres, hashen følger med (så en ny capture af den maskerede rå
  -- tekst finder samme episode), og casen lægges i capture-køen. Tekststykkerne maskeres og mister
  -- deres vektor; L0 embedder dem igen.
  for v_episode in
    select e.id, e.case_id, e.content, e.title
      from public.brain_episodes e
     where e.fund_id = _fund_id and (e.content ~* v_pattern or e.title ~* v_pattern)
  loop
    v_masked_hash := encode(sha256(convert_to(public.gdpr_replace_terms(v_episode.content, _terms), 'UTF8')), 'hex');
    begin
      update public.brain_episodes e
         set content = public.gdpr_replace_terms(e.content, _terms),
             title = public.gdpr_replace_terms(e.title, _terms),
             content_hash = v_masked_hash,
             extraction_status = case when e.extraction_status = 'done' then 'pending' else e.extraction_status end
       where e.id = v_episode.id and e.fund_id = _fund_id;
      v_episodes_masked := v_episodes_masked + 1;
    exception when unique_violation then
      -- Den maskerede tekst findes allerede som en anden episode: den her er overflødig.
      delete from public.brain_episodes e where e.id = v_episode.id and e.fund_id = _fund_id;
      v_episodes_deleted := v_episodes_deleted + 1;
    end;
    if v_episode.case_id is not null then
      insert into public.brain_capture_queue (fund_id, case_id)
      values (_fund_id, v_episode.case_id)
      on conflict (fund_id, case_id) do update set changed_at = now();
    end if;
  end loop;

  update public.brain_chunks c
     set content = public.gdpr_replace_terms(c.content, _terms),
         heading = public.gdpr_replace_terms(c.heading, _terms),
         embedding = null
   where c.fund_id = _fund_id and (c.content ~* v_pattern or c.heading ~* v_pattern);
  get diagnostics v_chunks_masked = row_count;

  update public.brain_sources s
     set title = public.gdpr_replace_terms(s.title, _terms)
   where s.fund_id = _fund_id and s.title ~* v_pattern;
  get diagnostics v_sources = row_count;

  update public.brain_insights i
     set title = public.gdpr_replace_terms(i.title, _terms),
         body_md = public.gdpr_replace_terms(i.body_md, _terms)
   where i.fund_id = _fund_id and (i.title ~* v_pattern or i.body_md ~* v_pattern);
  get diagnostics v_insights = row_count;

  -- Chat.
  update public.brain_messages m
     set content = public.gdpr_replace_terms(m.content, _terms),
         citations = public.gdpr_replace_terms_jsonb(m.citations, _terms),
         tool_calls = public.gdpr_replace_terms_jsonb(m.tool_calls, _terms)
   where m.fund_id = _fund_id
     and (m.content ~* v_pattern or m.citations::text ~* v_json_pattern
          or m.tool_calls::text ~* v_json_pattern);
  get diagnostics v_messages = row_count;

  update public.brain_threads t
     set title = public.gdpr_replace_terms(t.title, _terms)
   where t.fund_id = _fund_id and t.title ~* v_pattern;
  get diagnostics v_threads = row_count;

  update public.brain_retrieval_events r
     set query = public.gdpr_replace_terms(r.query, _terms),
         candidates = public.gdpr_replace_terms_jsonb(r.candidates, _terms)
   where r.fund_id = _fund_id and (r.query ~* v_pattern or r.candidates::text ~* v_json_pattern);
  get diagnostics v_events = row_count;

  update public.brain_feedback f
     set comment = public.gdpr_replace_terms(f.comment, _terms)
   where f.fund_id = _fund_id and f.comment ~* v_pattern;
  get diagnostics v_feedback = row_count;

  -- Eksamens- og historikrækker.
  update public.brain_eval_items i
     set question = public.gdpr_replace_terms(i.question, _terms),
         facit = public.gdpr_replace_terms_jsonb(i.facit, _terms),
         expected_facts = coalesce((
           select array_agg(public.gdpr_replace_terms(x, _terms)) from unnest(i.expected_facts) as u(x)), '{}')
   where i.fund_id = _fund_id
     and (i.question ~* v_pattern or i.facit::text ~* v_json_pattern
          or exists (select 1 from unnest(i.expected_facts) as u(x) where x ~* v_pattern));
  get diagnostics v_eval = row_count;

  update public.brain_historical_decisions h
     set reason_text = public.gdpr_replace_terms(h.reason_text, _terms)
   where h.fund_id = _fund_id and h.reason_text ~* v_pattern;
  get diagnostics v_history = row_count;

  -- Resten af Brains lagre med fritekst eller jsonb (kilder, indsigternes henvisninger, eksamens-
  -- svar og -spor, jobtrin).
  for v_target in
    select * from (values
      ('brain_sources', 'file_name', 'text'),
      ('brain_sources', 'summary_md', 'text'),
      ('brain_sources', 'origin_url', 'text'),
      ('brain_sources', 'error_message', 'text'),
      ('brain_sources', 'classification', 'jsonb'),
      ('brain_insights', 'refs', 'jsonb'),
      ('brain_eval_attempts', 'answer', 'text'),
      ('brain_eval_attempts', 'error', 'text'),
      ('brain_eval_attempts', 'citations', 'jsonb'),
      ('brain_eval_attempts', 'grade', 'jsonb'),
      ('brain_eval_attempts', 'judge', 'jsonb'),
      ('brain_eval_attempts', 'trace', 'jsonb'),
      ('brain_eval_runs', 'results', 'jsonb'),
      ('brain_eval_human_grades', 'note', 'text'),
      ('brain_job_steps', 'output', 'jsonb')
    ) as t(tbl, col, kind)
  loop
    if v_target.kind = 'jsonb' then
      execute format(
        'update public.%1$I t set %2$I = public.gdpr_replace_terms_jsonb(t.%2$I, $1) '
        'where t.fund_id = $2 and t.%2$I::text ~* $3',
        v_target.tbl, v_target.col)
        using _terms, _fund_id, v_json_pattern;
    else
      execute format(
        'update public.%1$I t set %2$I = public.gdpr_replace_terms(t.%2$I, $1) '
        'where t.fund_id = $2 and t.%2$I ~* $3',
        v_target.tbl, v_target.col)
        using _terms, _fund_id, v_pattern;
    end if;
  end loop;

  -- Fondens gamle hukommelse: teksten maskeres her, vektoren embeddes igen af serveren.
  with changed as (
    update public.fund_memory_entries m
       set summary_text = public.gdpr_replace_terms(m.summary_text, _terms),
           updated_at = now()
     where m.fund_id = _fund_id and m.summary_text ~* v_pattern
    returning m.id, m.summary_text
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'text', c.summary_text)), '[]'::jsonb)
    into v_memory
    from changed c;

  -- brain_log: de slettede objekter og alle rækker, hvor navnet står i før/efter/årsag.
  v_log := public.gdpr_mask_log(_fund_id, v_object_ids);
  perform set_config('brain.gdpr', 'on', true);
  update public.brain_log l
     set before = case when l.before is null then null else '{"masked":true}'::jsonb end,
         after = case when l.after is null then null else '{"masked":true}'::jsonb end,
         reason = case when l.reason is null then null else '[slettet]' end
   where l.fund_id = _fund_id
     and (l.before::text ~* v_json_pattern or l.after::text ~* v_json_pattern or l.reason ~* v_pattern);
  get diagnostics v_rows = row_count;
  v_log := v_log + v_rows;
  perform set_config('brain.gdpr', 'off', true);

  return jsonb_build_object(
    'factsDeleted', v_facts_deleted,
    'factsMasked', v_facts_masked,
    'quotesMasked', v_quotes,
    'entitiesDeleted', v_entities_deleted,
    'entitiesMasked', v_entities_masked,
    'episodesDeleted', v_episodes_deleted,
    'episodesMasked', v_episodes_masked,
    'chunksMasked', v_chunks_masked,
    'sourcesRenamed', v_sources,
    'insightsMasked', v_insights,
    'messagesMasked', v_messages,
    'threadsMasked', v_threads,
    'retrievalEventsMasked', v_events,
    'feedbackMasked', v_feedback,
    'evalItemsMasked', v_eval,
    'historyMasked', v_history,
    'logRowsMasked', v_log,
    'memoryEntries', v_memory
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Indgangen: Brain først (kender entiteten), så rå data (sletter personen)
-- ---------------------------------------------------------------------------
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
begin
  -- Rå data først: den maskerede tekst er det, en senere capture læser. Selve rækken i people
  -- slettes sidst i samme transaktion, efter at Brain har brugt entiteten.
  v_raw := public.gdpr_forget_person_raw(_fund_id, null, v_terms);
  v_brain := public.brain_forget_person(_fund_id, v_person, v_entities, v_terms);
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

revoke all on function public.gdpr_term_regex(text) from public, anon, authenticated;
revoke all on function public.gdpr_term_pattern(text[]) from public, anon, authenticated;
revoke all on function public.gdpr_json_terms(text[]) from public, anon, authenticated;
revoke all on function public.gdpr_replace_terms(text, text[], text) from public, anon, authenticated;
revoke all on function public.gdpr_replace_terms_jsonb(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.gdpr_person_terms(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.gdpr_forget_person_raw(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.brain_forget_person(uuid, uuid, uuid[], text[]) from public, anon, authenticated;
revoke all on function public.gdpr_forget_person(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.gdpr_term_regex(text) to service_role;
grant execute on function public.gdpr_term_pattern(text[]) to service_role;
grant execute on function public.gdpr_json_terms(text[]) to service_role;
grant execute on function public.gdpr_replace_terms(text, text[], text) to service_role;
grant execute on function public.gdpr_replace_terms_jsonb(jsonb, text[], text) to service_role;
grant execute on function public.gdpr_person_terms(uuid, uuid, uuid) to service_role;
grant execute on function public.gdpr_forget_person_raw(uuid, uuid, text[]) to service_role;
grant execute on function public.brain_forget_person(uuid, uuid, uuid[], text[]) to service_role;
grant execute on function public.gdpr_forget_person(uuid, uuid, uuid) to service_role;

commit;
