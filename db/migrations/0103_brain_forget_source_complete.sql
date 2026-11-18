-- (a) + (a, b), Brain · indlæsningspakken (midtvejs-/harden):
--
-- 1. Glem kilde efterlader ikke længere personer og selskaber, der kun kom fra kilden (navn,
--    aliaser, embedding) på hjernekortet, i @-menuen og i søgning. Funktionen fra 0092 flyttes til
--    private.brain_forget_source_core (uændret), og public.brain_forget_source er nu en skal om
--    den: den husker de entiteter, kildens fakta handlede om, kalder kernen (som tager fondens
--    glemsel-lås og sletter kildens fakta), og sletter bagefter de af dem, der ikke har andre
--    fakta, ikke er knyttet til en case, et selskab eller en person i databasen (ref_table), ikke
--    er mål for en sammenfletning, og ikke bruges som selskab af en anden kilde. Loggen for de
--    slettede entiteter maskeres som for kildens egne objekter.
-- 2. (a): en upload, der læses ind, mens en person glemmes, kunne gemme navnet bagefter, fordi
--    brain_ingest_store_chunks skrev tekst fra selve filen uden tælleren fra 0092. Den nye
--    brain_ingest_store_chunks_checked gemmer intet, hvis noget er glemt, siden indlæsningen læste
--    filen (samme lås og tæller som L1).
-- 3. (b): merge-indsigterne i L1 tjekkede tælleren lige før de blev skrevet, ikke under
--    låsen. brain_insert_merge_candidates tjekker og skriver i samme transaktion, mens glemslens
--    lås holdes delt.
--
-- Additive: ingen tabeller ændres. Kernen beholder sine rettigheder (kun service_role).

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Glem kilde: skal om kernen
-- ---------------------------------------------------------------------------
alter function public.brain_forget_source(uuid, uuid) set schema private;
alter function private.brain_forget_source(uuid, uuid) rename to brain_forget_source_core;

create or replace function public.brain_forget_source(_fund_id uuid, _source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_ids uuid[];
  v_orphans uuid[];
  v_result jsonb;
  v_masked int := 0;
begin
  if _fund_id is null or _source_id is null then
    raise exception 'brain_forget_source: fund and source are required';
  end if;

  -- The fund's forget lock first (exclusive, re-entrant for the core): no extraction can commit a
  -- new fact on the source's episodes between the read below and the core's delete.
  perform pg_advisory_xact_lock(hashtextextended('brain_forget:' || _fund_id::text, 0));

  -- The entities the source's facts are about, read before the core deletes the facts.
  select coalesce(array_agg(distinct x.entity_id), '{}') into v_entity_ids
    from (
      select f.subject_id as entity_id
        from public.brain_facts f
        join public.brain_fact_episodes fe on fe.fact_id = f.id and fe.fund_id = f.fund_id
        join public.brain_episodes ep on ep.id = fe.episode_id and ep.fund_id = fe.fund_id
       where f.fund_id = _fund_id and ep.brain_source_id = _source_id
      union
      select f.object_id
        from public.brain_facts f
        join public.brain_fact_episodes fe on fe.fact_id = f.id and fe.fund_id = f.fund_id
        join public.brain_episodes ep on ep.id = fe.episode_id and ep.fund_id = fe.fund_id
       where f.fund_id = _fund_id and ep.brain_source_id = _source_id and f.object_id is not null
    ) x;

  -- The core counts the forget generation up; the lock is held to the end of this transaction, so
  -- nothing can add a fact to these entities between the check and the delete.
  v_result := private.brain_forget_source_core(_fund_id, _source_id);

  select coalesce(array_agg(e.id), '{}') into v_orphans
    from public.brain_entities e
   where e.fund_id = _fund_id
     and e.id = any (v_entity_ids)
     and e.status = 'active'
     and e.ref_table is null
     and not exists (
       select 1 from public.brain_facts f
        where f.fund_id = e.fund_id and (f.subject_id = e.id or f.object_id = e.id))
     and not exists (
       select 1 from public.brain_entities m
        where m.fund_id = e.fund_id and m.merged_into = e.id)
     and not exists (
       select 1 from public.brain_sources s
        where s.fund_id = e.fund_id and s.company_entity_id = e.id)
     and not exists (
       select 1 from public.brain_historical_decisions h
        where h.fund_id = e.fund_id and h.company_entity_id = e.id);

  if cardinality(v_orphans) > 0 then
    -- Insights that name the entity (merge questions, duplicates) lose their text, like those that
    -- quote the source in the core.
    update public.brain_insights i
       set title = '[kilde slettet]', body_md = '[kilde slettet]', refs = '[]'::jsonb
     where i.fund_id = _fund_id
       and exists (
         select 1 from unnest(v_orphans) as x(id)
         where i.refs::text like '%' || x.id::text || '%');
    v_masked := public.gdpr_mask_log(_fund_id, v_orphans);
    delete from public.brain_entities e
     where e.fund_id = _fund_id and e.id = any (v_orphans);
  end if;

  return v_result
    || jsonb_build_object(
         'entitiesDeleted', cardinality(v_orphans),
         'logRowsMasked', coalesce((v_result ->> 'logRowsMasked')::int, 0) + v_masked
       );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Indlæsning: gem kun chunks, hvis intet er glemt siden filen blev læst
-- ---------------------------------------------------------------------------
create or replace function public.brain_ingest_store_chunks_checked(
  _fund_id uuid,
  _source_id uuid,
  _chunks jsonb,
  _forget_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.brain_forget_unchanged(_fund_id, _forget_generation) then
    return jsonb_build_object('skipped', 'forgotten', 'stored', 0);
  end if;
  return jsonb_build_object(
    'stored', public.brain_ingest_store_chunks(_fund_id, _source_id, _chunks));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. L1: merge-indsigter skrives under låsen
-- ---------------------------------------------------------------------------
-- Rows: {title, body_md, refs, dedupe_key}. The insights name extracted people, so nothing is
-- written when something was forgotten since the run read its data.
create or replace function public.brain_insert_merge_candidates(
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
  v_written int := 0;
begin
  if jsonb_typeof(_rows) is distinct from 'array' then
    raise exception 'brain_insert_merge_candidates: rows must be an array';
  end if;
  if not private.brain_forget_unchanged(_fund_id, _forget_generation) then
    return jsonb_build_object('skipped', 'forgotten', 'written', 0);
  end if;
  insert into public.brain_insights (fund_id, kind, title, body_md, refs, priority,
                                     created_by_loop, dedupe_key)
  select _fund_id, 'merge_candidate', left(r.title, 300), r.body_md, coalesce(r.refs, '[]'::jsonb),
         3, 'L1_extract', r.dedupe_key
    from jsonb_to_recordset(_rows) as r(title text, body_md text, refs jsonb, dedupe_key text)
  on conflict (fund_id, dedupe_key) do nothing;
  get diagnostics v_written = row_count;
  return jsonb_build_object('written', v_written);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rettigheder: kun serveren
-- ---------------------------------------------------------------------------
revoke all on function private.brain_forget_source_core(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_forget_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.brain_ingest_store_chunks_checked(uuid, uuid, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.brain_insert_merge_candidates(uuid, bigint, jsonb)
  from public, anon, authenticated;

grant execute on function private.brain_forget_source_core(uuid, uuid) to service_role;
grant execute on function public.brain_forget_source(uuid, uuid) to service_role;
grant execute on function public.brain_ingest_store_chunks_checked(uuid, uuid, jsonb, bigint)
  to service_role;
grant execute on function public.brain_insert_merge_candidates(uuid, bigint, jsonb)
  to service_role;

commit;
