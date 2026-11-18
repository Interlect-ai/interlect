-- 0052 · "Glem kilde" og slettet tekst bliver ikke stående (review af PR #10).
--
-- 1. En udløbet fakta beholdt sin gamle tekst, selv når den kilde, teksten stod i, var slettet
--    eller rettet; et fondsmedlem kunne stadig læse den. Nu tømmes teksten (statement, value_text
--    og embedding) i det øjeblik en udløbet fakta mister sin kilde, også i triggeren fra 0045.
--    Eksisterende udløbne fakta uden nogen kilde tømmes i samme migration.
-- 2. brain_forget_source ("Glem denne kilde", punkt 3-5 og 7 for de tabeller, der findes nu):
--    fakta, der kun har denne kilde, slettes helt (også tekst og embedding); entiteter, der var
--    berørt, bliver beskidte; indsigter, der citerer kilden, får teksten erstattet; log-rækker
--    for de slettede objekter maskeres (gdpr_mask_log). Selve sletningen af Storage-filen og
--    revisionsposten sker i serveren (src/lib/brain/forget.server.ts), før denne funktion kaldes.
--    Punkter for tabeller, der kommer i senere faser (sider, lektioner, chat, temaer), tilføjes
--    til den fases forget-ticket.
--
-- Additiv og bagudkompatibel (preview og produktion deler databasen): en erstattet triggerfunktion
-- med samme signatur og en ny funktion kun for service_role.

-- ---------------------------------------------------------------------------
-- 1. Tøm teksten, når en udløbet fakta mister sin kilde
-- ---------------------------------------------------------------------------
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
     and (
       not exists (
         select 1
         from public.brain_fact_episodes fe
         join public.brain_episodes e on e.id = fe.episode_id and e.fund_id = fe.fund_id
         where fe.fact_id = old.fact_id
           and (f.status <> 'active' or e.trust_tier not in ('public_web', 'user_note')))
       or not exists (
         select 1 from public.brain_fact_episodes fe
         where fe.fact_id = old.fact_id and fe.created_at <= old.created_at)
     );
  if found then
    update public.brain_episodes e
       set extraction_status = 'pending'
     where e.fund_id = old.fund_id
       and e.extraction_status = 'done'
       and e.id in (select fe.episode_id from public.brain_fact_episodes fe
                    where fe.fact_id = old.fact_id);
  else
    -- Still alive: its trust is the best of the sources that are left (03 §5), so a source
    -- that is corrected or deleted no longer lifts it.
    update public.brain_facts f
       set trust_tier = best.tier
      from (
        select e.trust_tier as tier
        from public.brain_fact_episodes fe
        join public.brain_episodes e on e.id = fe.episode_id and e.fund_id = fe.fund_id
        where fe.fact_id = old.fact_id
          and e.trust_tier not in ('public_web', 'user_note')
        order by public.brain_trust_rank(e.trust_tier) desc
        limit 1
      ) best
     where f.id = old.fact_id
       and f.fund_id = old.fund_id
       and f.expired_at is null
       and f.origin <> 'db'
       and f.status = 'active'
       and f.trust_tier is distinct from best.tier;
  end if;

  -- GDPR (10 §4): an expired fact that has lost its last source, or the source its wording came
  -- from, must not keep the wording or its embedding where members can read it. The episodes
  -- still linked to it are read again by L1, so a fact that is still true comes back in their words.
  update public.brain_facts f
     set statement = '[kilde slettet]', value_text = null, embedding = null
   where f.id = old.fact_id
     and f.fund_id = old.fund_id
     and f.origin <> 'db'
     and f.expired_at is not null
     and f.statement <> '[kilde slettet]'
     and (
       not exists (select 1 from public.brain_fact_episodes fe where fe.fact_id = old.fact_id)
       or not exists (
         select 1 from public.brain_fact_episodes fe
         where fe.fact_id = old.fact_id and fe.created_at <= old.created_at)
     );
  return null;
end;
$$;
revoke all on function public.brain_fact_episodes_expire_orphans() from public, anon, authenticated;

-- Expired facts that already have no source at all.
update public.brain_facts f
   set statement = '[kilde slettet]', value_text = null, embedding = null
 where f.origin <> 'db'
   and f.expired_at is not null
   and f.statement <> '[kilde slettet]'
   and not exists (select 1 from public.brain_fact_episodes fe where fe.fact_id = f.id);

-- ---------------------------------------------------------------------------
-- 2. Glem kilde
-- ---------------------------------------------------------------------------
create or replace function public.brain_forget_source(_fund_id uuid, _source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_episode_ids uuid[];
  v_chunk_ids uuid[];
  v_sole_facts uuid[];
  v_shared_facts uuid[];
  v_entity_ids uuid[];
  v_object_ids uuid[];
  v_deleted_facts int := 0;
  v_dirty int := 0;
  v_masked int := 0;
  v_insights int := 0;
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

  -- The log of every fact the source touched is masked: the ones deleted and the ones that only
  -- lose their wording (a before/after may hold text from the source).
  v_object_ids := v_episode_ids || v_chunk_ids || v_sole_facts || v_shared_facts || array[_source_id];

  delete from public.brain_facts f
   where f.fund_id = _fund_id and f.id = any (v_sole_facts);
  get diagnostics v_deleted_facts = row_count;

  update public.brain_entities en
     set dirty_at = now()
   where en.fund_id = _fund_id and en.id = any (v_entity_ids);
  get diagnostics v_dirty = row_count;

  -- Insights that quote the source lose their text.
  update public.brain_insights i
     set title = '[kilde slettet]', body_md = '[kilde slettet]', refs = '[]'::jsonb
   where i.fund_id = _fund_id
     and exists (
       select 1 from unnest(v_object_ids) as x(id)
       where i.refs::text like '%' || x.id::text || '%');
  get diagnostics v_insights = row_count;

  v_masked := public.gdpr_mask_log(_fund_id, v_object_ids);

  -- The source goes; episodes, chunks and the remaining fact links follow by cascade, and the
  -- trigger above empties the wording of any fact whose wording came from this source.
  delete from public.brain_sources s where s.id = _source_id and s.fund_id = _fund_id;

  return jsonb_build_object(
    'episodes', cardinality(v_episode_ids),
    'chunks', cardinality(v_chunk_ids),
    'factsDeleted', v_deleted_facts,
    'factsUnlinked', cardinality(v_shared_facts),
    'entitiesMarked', v_dirty,
    'insightsEmptied', v_insights,
    'logRowsMasked', v_masked
  );
end;
$$;

revoke all on function public.brain_forget_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_forget_source(uuid, uuid) to service_role;
