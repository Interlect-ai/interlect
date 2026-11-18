-- 0091 · "Glem kilde" når også gemte svar og svar, der skrives imens.
--
-- 0090 tømte gamle svars citater, men et svar gemt med "Gem i Brain" er en episode (`answer`,
-- ref brain_messages) med ét tekststykke: spørgsmålet, svaret og en linje "Kilder: …" med
-- citaternes etiketter (for fakta faktaens tekst, for tekststykker kildens titel). Den linje stod
-- videre efter glemslen, kunne findes af search_brain og citeres igen. Desuden kunne et svar, der
-- blev streamet eller gemt i samme øjeblik, skrive kildens ord efter glemslen.
--
--   * brain_forget_chat_refs (erstattes, ellers som i 0090): for hvert svar, hvis citater tømmes,
--     bygges "Kilder:"-linjen i dets gemte episode og tekststykke om ud fra de tømte citater (en
--     glemt kilde står som "[kilde slettet]" / "[source deleted]" på linjens eget sprog, højst ca.
--     600 tegn med hele etiketter). Hash følger teksten, vektoren slettes, og casen sættes i
--     brain_capture_queue, så næste opsamling (senest natten) laver den igen. Svarets egen tekst
--     (modellens ord) røres ikke, hverken i chatten eller i det gemte svar (som 0090), så et svar
--     gemt før og efter glemslen ender ens.
--   * et andet svar, der citerede det gemte svars tekststykke (search_brain, case_brief), får
--     citatet hentet igen fra den nye tekst (som appen klipper det: højst 2000 tegn).
--   * en lås pr. fond: glemslen tager den eksklusivt i brain_forget_chat_refs, et nyt svar med
--     citater (trigger) og "Gem i Brain" (brain_save_answer_episode) delt. Så skriver ingen af dem
--     kildens ord efter glemslen: enten venter de på, at glemslen er gemt, eller glemslen venter på
--     dem og ser deres række.
--   * brain_forgotten_refs: de id'er, glemslen tømte eller skrev om, i en time. Et svar, der gemmes
--     efter glemslen, men læste kilden før, får de citater markeret slettet (eller citatet af et
--     omskrevet gemt svar hentet igen) af triggeren. Kun id'er, aldrig tekst; ældre rækker slettes
--     ved næste glemsel og læses ikke.
--   * brain_save_answer_episode: "Gem i Brain" skriver episode og tekststykke i ét kald under
--     låsen og kun, hvis svarets citater er de samme, som serveren byggede teksten ud fra (ellers
--     40001, og serveren bygger teksten igen). To klik på samme svar giver én episode.
--
-- Ingen genberegning af svar gemt før 0091: der er kun testdata på staging (som 0090).
-- Én ny tabel (kun serveren, RLS uden policies), ingen ændring af eksisterende tabeller eller
-- policies; de nye funktioner kun for service_role.

begin;

set local lock_timeout = '5s';

create table public.brain_forgotten_refs (
  fund_id uuid not null references public.funds(id) on delete cascade,
  ref_id uuid not null,
  forgotten_at timestamptz not null default now(),
  -- false: the id was forgotten (its citations are emptied); true: a saved answer's chunk whose
  -- text was rewritten (its citations get the new text as quote).
  rewritten boolean not null default false,
  primary key (fund_id, ref_id)
);
revoke all on public.brain_forgotten_refs from public, anon, authenticated;
grant all on public.brain_forgotten_refs to service_role;
alter table public.brain_forgotten_refs enable row level security;

-- A citation of a forgotten id keeps its number, kind, id, trust, case and date (so [n] still
-- fits) and loses the source's words (as in 0090).
create or replace function private.brain_forget_citations(_citations jsonb, _ids text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           case when (c ->> 'id') = any (_ids)
                then c || jsonb_build_object('label', '[kilde slettet]',
                                             'quote', null,
                                             'ref', null,
                                             'deleted', true)
                else c end
           order by ord), '[]'::jsonb)
    from jsonb_array_elements(_citations) with ordinality as t(c, ord)
$$;

-- The "Kilder:" / "Sources:" line of a saved answer (answer-note.ts), from its citations: labels
-- in citation order, a deleted one as the marker, each once, whole labels up to about 600
-- characters, then " …". Null when there is no label at all.
create or replace function private.brain_answer_sources_line(_citations jsonb, _english boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  with labels as (
    select case when (c -> 'deleted') = 'true'::jsonb
                then case when _english then '[source deleted]' else '[kilde slettet]' end
                else btrim(coalesce(c ->> 'label', '')) end as label,
           row_number() over (
             order by case when (c ->> 'n') ~ '^[0-9]{1,9}$' then (c ->> 'n')::int else 0 end,
                      ord) as rn
      from jsonb_array_elements(_citations) with ordinality as t(c, ord)
  ), firsts as (
    select distinct on (label) label, rn from labels where label <> '' order by label, rn
  ), sized as (
    select label, rn,
           sum(char_length(label) + 2) over (order by rn) as running,
           min(rn) over () as first_rn
      from firsts
  ), kept as (
    select label, rn from sized where rn = first_rn or running <= 588
  )
  select case when _english then 'Sources: ' else 'Kilder: ' end
         || string_agg(k.label, '; ' order by k.rn)
         || case when count(*) < (select count(*) from firsts) then ' …' else '' end
    from kept k
  having count(*) > 0
$$;

-- A saved answer's text with its last "Kilder:" / "Sources:" line rebuilt from the emptied
-- citations (the line always comes last, answer-note.ts). The rest is the question and the
-- model's own words and stays. No such line (no labels): unchanged.
create or replace function private.brain_answer_forget(_content text, _citations jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_da int := strpos(reverse(_content), reverse(e'\n\nKilder: '));
  v_en int := strpos(reverse(_content), reverse(e'\n\nSources: '));
  v_at int;
  v_line text;
begin
  -- Positions from the start; the later of the two is the line.
  v_da := case when v_da > 0 then char_length(_content) - v_da - char_length(e'\n\nKilder: ') + 2
               else 0 end;
  v_en := case when v_en > 0 then char_length(_content) - v_en - char_length(e'\n\nSources: ') + 2
               else 0 end;
  v_at := greatest(v_da, v_en);
  if v_at = 0 then
    return _content;
  end if;
  v_line := private.brain_answer_sources_line(_citations, v_en > v_da);
  return left(case when v_line is null then left(_content, v_at - 1)
                   else left(_content, v_at - 1) || e'\n\n' || v_line end, 8000);
end;
$$;

-- Citations of a rewritten saved answer's chunk get its current text as quote, clipped as the app
-- clips it (sources.ts: trimmed, at most 2000 characters with "…").
create or replace function private.brain_requote_citations(
  _fund_id uuid, _citations jsonb, _ids text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           case when c ->> 'kind' = 'chunk' and (c ->> 'id') = any (_ids)
                     and (c -> 'deleted') is distinct from 'true'::jsonb
                then c || jsonb_build_object('quote', (
                       select case when char_length(x.t) <= 2000 then x.t
                                   else regexp_replace(left(x.t, 1999), '\s+$', '') || '…' end
                         from public.brain_chunks k,
                              lateral (select regexp_replace(k.content, '^\s+|\s+$', '', 'g') as t) x
                        where k.fund_id = _fund_id and k.id = (c ->> 'id')::uuid))
                else c end
           order by ord), '[]'::jsonb)
    from jsonb_array_elements(_citations) with ordinality as t(c, ord)
$$;

create or replace function public.brain_forget_chat_refs(_fund_id uuid, _ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[] := array(select x::text from unnest(coalesce(_ids, '{}')) x);
  v_message record;
  v_episode record;
  v_citations jsonb;
  v_content text;
  v_chunks uuid[];
  v_rewritten text[] := '{}';
  v_messages int := 0;
  v_answers int := 0;
  v_quotes int := 0;
  v_events int := 0;
begin
  if _fund_id is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('chatMessagesChanged', 0, 'retrievalEventsChanged', 0,
                              'savedAnswersChanged', 0, 'answerQuotesChanged', 0);
  end if;

  -- Writers that cite (a new answer, "Gem i Brain") take this lock shared: they wait for this
  -- forgetting to commit, or it waits for them and sees their rows below.
  perform pg_advisory_xact_lock(hashtextextended('brain_forget:' || _fund_id::text, 0));

  -- An answer that read the source before this commits, but is saved after, is marked by the
  -- trigger on brain_messages from these ids.
  delete from public.brain_forgotten_refs r
   where r.fund_id = _fund_id and r.forgotten_at < now() - interval '1 hour';
  insert into public.brain_forgotten_refs (fund_id, ref_id)
  select _fund_id, x from unnest(_ids) x
  on conflict (fund_id, ref_id) do update set forgotten_at = excluded.forgotten_at, rewritten = false;

  for v_message in
    select m.id, m.citations
      from public.brain_messages m
     where m.fund_id = _fund_id
       and exists (select 1 from jsonb_array_elements(m.citations) c
                   where (c ->> 'id') = any (v_ids)
                     and ((c -> 'deleted') is distinct from 'true'::jsonb
                          or c ->> 'quote' is not null
                          or c ->> 'label' is distinct from '[kilde slettet]'
                          or c ->> 'ref' is not null))
     for update
  loop
    v_citations := private.brain_forget_citations(v_message.citations, v_ids);
    update public.brain_messages m set citations = v_citations where m.id = v_message.id;
    v_messages := v_messages + 1;

    -- "Gem i Brain" (T-734): the saved answer's episode and its text chunk follow.
    for v_episode in
      select e.id, e.content, e.case_id
        from public.brain_episodes e
       where e.fund_id = _fund_id and e.kind = 'answer'
         and e.ref_table = 'brain_messages' and e.ref_id = v_message.id
       for update
    loop
      v_content := private.brain_answer_forget(v_episode.content, v_citations);
      with changed as (
        update public.brain_chunks c
           set content = x.content, embedding = null
          from (select c2.id, private.brain_answer_forget(c2.content, v_citations) as content
                  from public.brain_chunks c2
                 where c2.fund_id = _fund_id and c2.episode_id = v_episode.id) x
         where c.id = x.id and c.content is distinct from x.content
        returning c.id)
      select coalesce(array_agg(id), '{}') into v_chunks from changed;
      v_rewritten := v_rewritten || array(select x::text from unnest(v_chunks) x);
      if v_content is distinct from v_episode.content then
        update public.brain_episodes e
           set content = v_content,
               content_hash = encode(sha256(convert_to(v_content, 'UTF8')), 'hex')
         where e.id = v_episode.id;
      end if;
      if v_content is distinct from v_episode.content or cardinality(v_chunks) > 0 then
        v_answers := v_answers + 1;
        -- The vector is made again by the case's next capture (the nightly run requeues it).
        if v_episode.case_id is not null then
          insert into public.brain_capture_queue (fund_id, case_id, changed_at)
          values (_fund_id, v_episode.case_id, now())
          on conflict (fund_id, case_id) do update set changed_at = excluded.changed_at;
        end if;
      end if;
    end loop;
  end loop;

  -- Other answers that cited a rewritten saved answer (search_brain, case_brief) quote its new
  -- text; one that is stored after this commits gets it from the trigger.
  if cardinality(v_rewritten) > 0 then
    insert into public.brain_forgotten_refs (fund_id, ref_id, rewritten)
    select _fund_id, x::uuid, true from unnest(v_rewritten) x
    on conflict (fund_id, ref_id) do update set forgotten_at = excluded.forgotten_at,
                                                rewritten = true;
    update public.brain_messages m
       set citations = private.brain_requote_citations(_fund_id, m.citations, v_rewritten)
     where m.fund_id = _fund_id
       and exists (select 1 from jsonb_array_elements(m.citations) c
                   where c ->> 'kind' = 'chunk' and (c ->> 'id') = any (v_rewritten)
                     and (c -> 'deleted') is distinct from 'true'::jsonb);
    get diagnostics v_quotes = row_count;
  end if;

  update public.brain_retrieval_events r
     set candidates = coalesce((
       select jsonb_agg(c order by ord)
         from jsonb_array_elements(r.candidates) with ordinality as t(c, ord)
        where not coalesce((c ->> 'id') = any (v_ids), false)), '[]'::jsonb)
   where r.fund_id = _fund_id
     and exists (select 1 from jsonb_array_elements(r.candidates) c
                 where (c ->> 'id') = any (v_ids));
  get diagnostics v_events = row_count;

  return jsonb_build_object('chatMessagesChanged', v_messages, 'retrievalEventsChanged', v_events,
                            'savedAnswersChanged', v_answers, 'answerQuotesChanged', v_quotes);
end;
$$;

-- A new answer (or any message with citations) waits for a forgetting in progress; a citation of
-- an id forgotten in the last hour is marked deleted, one of a saved answer rewritten in the last
-- hour quotes its new text, before it is stored.
create or replace function private.brain_messages_forgotten_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[];
  v_rewritten text[];
begin
  if jsonb_array_length(new.citations) = 0 then
    return new;
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('brain_forget:' || new.fund_id::text, 0));
  select array_agg(r.ref_id::text) filter (where not r.rewritten),
         array_agg(r.ref_id::text) filter (where r.rewritten)
    into v_ids, v_rewritten
    from public.brain_forgotten_refs r
   where r.fund_id = new.fund_id
     and r.forgotten_at > now() - interval '1 hour'
     and r.ref_id::text in (select c ->> 'id' from jsonb_array_elements(new.citations) c);
  if v_ids is not null then
    new.citations := private.brain_forget_citations(new.citations, v_ids);
  end if;
  if v_rewritten is not null then
    new.citations := private.brain_requote_citations(new.fund_id, new.citations, v_rewritten);
  end if;
  return new;
end;
$$;

create trigger brain_messages_forgotten_refs
  before insert on public.brain_messages
  for each row execute function private.brain_messages_forgotten_refs();

-- "Gem i Brain": the episode and its one chunk in one call, under the forget lock, only from the
-- citations the server built the text from. False when the answer is already saved.
create or replace function public.brain_save_answer_episode(
  _fund_id uuid,
  _message_id uuid,
  _citations jsonb,
  _case_id uuid,
  _company_id uuid,
  _title text,
  _content text,
  _content_hash text,
  _token_count int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_citations jsonb;
  v_episode uuid;
begin
  if _fund_id is null or _message_id is null then
    raise exception 'brain_save_answer_episode: fund and answer are required';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('brain_forget:' || _fund_id::text, 0));
  -- Two clicks on the same answer wait for each other here; the second finds the first's episode.
  select m.citations into v_citations
    from public.brain_messages m
   where m.id = _message_id and m.fund_id = _fund_id and m.role = 'assistant'
   for no key update;
  if not found then
    raise exception 'brain_save_answer_episode: unknown answer' using errcode = 'P0002';
  end if;
  if v_citations is distinct from coalesce(_citations, '[]'::jsonb) then
    raise exception 'brain_save_answer_episode: the answer''s sources changed'
      using errcode = '40001';
  end if;
  if exists (select 1 from public.brain_episodes e
             where e.fund_id = _fund_id and e.kind = 'answer'
               and e.ref_table = 'brain_messages' and e.ref_id = _message_id) then
    return false;
  end if;

  insert into public.brain_episodes (fund_id, kind, ref_table, ref_id, case_id, company_id,
    trust_tier, occurred_at, title, content, content_hash, extraction_status)
  values (_fund_id, 'answer', 'brain_messages', _message_id, _case_id, _company_id,
    'user_note', now(), _title, _content, _content_hash, 'skipped')
  returning id into v_episode;
  insert into public.brain_chunks (fund_id, episode_id, ordinal, content, token_count)
  values (_fund_id, v_episode, 0, _content, _token_count);
  return true;
end;
$$;

revoke all on function private.brain_forget_citations(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.brain_answer_sources_line(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.brain_answer_forget(text, jsonb) from public, anon, authenticated;
revoke all on function private.brain_requote_citations(uuid, jsonb, text[]) from public, anon, authenticated;
revoke all on function private.brain_messages_forgotten_refs() from public, anon, authenticated;
revoke all on function public.brain_forget_chat_refs(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.brain_save_answer_episode(uuid, uuid, jsonb, uuid, uuid, text, text, text, int)
  from public, anon, authenticated;
grant execute on function private.brain_forget_citations(jsonb, text[]) to service_role;
grant execute on function private.brain_answer_sources_line(jsonb, boolean) to service_role;
grant execute on function private.brain_answer_forget(text, jsonb) to service_role;
grant execute on function private.brain_requote_citations(uuid, jsonb, text[]) to service_role;
grant execute on function public.brain_forget_chat_refs(uuid, uuid[]) to service_role;
grant execute on function public.brain_save_answer_episode(uuid, uuid, jsonb, uuid, uuid, text, text, text, int)
  to service_role;

commit;
