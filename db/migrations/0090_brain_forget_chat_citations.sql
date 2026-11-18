-- 0090 · "Glem kilde" rører også chatten (punkt 6 "chat-citater").
--
-- Et svar i Brain-chatten gemmer sine citater (brain_messages.citations): pr. kilde en etiket
-- (fx "Dokument · LP-brev Q2" eller faktaens tekst) og et citat fra kildens tekststykke eller
-- fakta. Glem kilde (0052/0082) slettede kilden, men citaterne stod videre i gamle svar. Søge-
-- loggen (brain_retrieval_events.candidates) gemmer kun id'er, men pegede stadig på dem.
--
--   Glem kilde (brain_forget_source erstattes, ellers uændret fra 0082):
--     * et citat, hvis id er et af kildens tekststykker, en slettet fakta (kun kilden, eller teksten
--       stammede fra kilden) eller en tømt lektion, markeres slettet (`deleted`, som appen allerede
--       viser som "[kilde slettet]" på fondens sprog uden kort og link), mister citat og henvisning
--       (ref), og etiketten bliver "[kilde slettet]"; nummer, slags, id, sikkerhed, case og dato
--       består, så svarets [n] stadig passer.
--     * søgeloggens kandidater med de id'er fjernes.
--     * selve svarteksten (content) røres ikke: den er modellens ord, ikke kildens (som i 0052).
--
-- Ingen genberegning af kilder, der er glemt før 0090: der er kun testdata på staging og endnu
-- ingen kunde i produktion (piloten starter efter release).
--
-- Ingen tabel, kolonne, policy eller rettighed ændres; den nye hjælper kun for service_role.

begin;

set local lock_timeout = '5s';

-- Citations and search candidates that point at forgotten ids lose the source's words.
create or replace function public.brain_forget_chat_refs(_fund_id uuid, _ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[] := array(select x::text from unnest(coalesce(_ids, '{}')) x);
  v_messages int := 0;
  v_events int := 0;
begin
  if _fund_id is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('chatMessagesChanged', 0, 'retrievalEventsChanged', 0);
  end if;

  update public.brain_messages m
     set citations = (
       select jsonb_agg(
                case when (c ->> 'id') = any (v_ids)
                     then c || jsonb_build_object('label', '[kilde slettet]',
                                                  'quote', null,
                                                  'ref', null,
                                                  'deleted', true)
                     else c end
                order by ord)
         from jsonb_array_elements(m.citations) with ordinality as t(c, ord))
   where m.fund_id = _fund_id
     and exists (select 1 from jsonb_array_elements(m.citations) c
                 where (c ->> 'id') = any (v_ids)
                   and ((c -> 'deleted') is distinct from 'true'::jsonb
                        or c ->> 'quote' is not null
                        or c ->> 'label' is distinct from '[kilde slettet]'
                        or c ->> 'ref' is not null));
  get diagnostics v_messages = row_count;

  update public.brain_retrieval_events r
     set candidates = coalesce((
       select jsonb_agg(c order by ord)
         from jsonb_array_elements(r.candidates) with ordinality as t(c, ord)
        where not coalesce((c ->> 'id') = any (v_ids), false)), '[]'::jsonb)
   where r.fund_id = _fund_id
     and exists (select 1 from jsonb_array_elements(r.candidates) c
                 where (c ->> 'id') = any (v_ids));
  get diagnostics v_events = row_count;

  return jsonb_build_object('chatMessagesChanged', v_messages, 'retrievalEventsChanged', v_events);
end;
$$;

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

revoke all on function public.brain_forget_chat_refs(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.brain_forget_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_forget_chat_refs(uuid, uuid[]) to service_role;
grant execute on function public.brain_forget_source(uuid, uuid) to service_role;

commit;
