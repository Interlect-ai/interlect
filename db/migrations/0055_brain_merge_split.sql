-- 0055 · Sammenlæg og "Adskil" ("Log og tilbagerulning").
--
-- To entiteter af samme type kan slås sammen: vinderen får taberens fakta (som subjekt og som
-- objekt), taberens navn og aliaser som aliaser og de kilder, der var koblet til taberen. Taberen
-- bliver stående som en række med status 'merged' og merged_into, så et senere udtræk, der finder
-- det gamle navn, havner hos vinderen (0045).
--
-- Alt, der flyttes, står i brain_log (action 'merge', object_kind 'entity', object_id = taberen),
-- så "Adskil" kan føre præcis det samme tilbage: kun de fakta, der stadig hører til vinderen, flyttes
-- tilbage, og fakta, der er kommet til siden, bliver hos vinderen. En adskillelse er selv en
-- logpost (action 'split'). Begge funktioner er kun for service_role; serveren tjekker rettigheden.
--
-- Afvises med en tydelig fejl: forskellig fond eller type, en af dem ikke aktiv, en taber der er
-- projiceret fra en case/virksomhed/person (ref_table), et faktum mellem de to (ville blive en
-- løkke), og en adskillelse, hvor vinderen selv er slået sammen videre eller loggen er maskeret.
--
-- Additiv og bagudkompatibel.

create or replace function public.brain_merge_entities(
  _fund_id uuid,
  _winner uuid,
  _loser uuid,
  _actor text,
  _reason text default null,
  _job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_w public.brain_entities%rowtype;
  v_l public.brain_entities%rowtype;
  v_subject_facts uuid[];
  v_object_facts uuid[];
  v_sources uuid[];
  v_added text[];
begin
  if _fund_id is null or _winner is null or _loser is null or _actor is null then
    raise exception 'brain_merge_entities: fund, winner, loser and actor are required';
  end if;
  if _winner = _loser then
    raise exception 'brain_merge_entities: an entity cannot be merged into itself';
  end if;

  -- Lock both in id order (no deadlock between two merges of the same pair).
  perform 1 from public.brain_entities e
   where e.fund_id = _fund_id and e.id in (_winner, _loser)
   order by e.id for update;
  select * into v_w from public.brain_entities where id = _winner and fund_id = _fund_id;
  select * into v_l from public.brain_entities where id = _loser and fund_id = _fund_id;
  if v_w.id is null or v_l.id is null then
    raise exception 'brain_merge_entities: unknown entity' using errcode = 'P0002';
  end if;
  if v_w.type <> v_l.type then
    raise exception 'brain_merge_entities: the entities have different types';
  end if;
  if v_w.status <> 'active' or v_l.status <> 'active' then
    raise exception 'brain_merge_entities: both entities must be active';
  end if;
  if v_l.ref_table is not null then
    raise exception 'brain_merge_entities: an entity projected from the database cannot be merged away';
  end if;
  if exists (
    select 1 from public.brain_facts f
     where f.fund_id = _fund_id
       and ((f.subject_id = _loser and f.object_id = _winner)
         or (f.subject_id = _winner and f.object_id = _loser))
  ) then
    raise exception 'brain_merge_entities: a fact links the two entities, so they cannot be merged';
  end if;

  select coalesce(array_agg(f.id order by f.id), '{}') into v_subject_facts
    from public.brain_facts f where f.fund_id = _fund_id and f.subject_id = _loser;
  select coalesce(array_agg(f.id order by f.id), '{}') into v_object_facts
    from public.brain_facts f where f.fund_id = _fund_id and f.object_id = _loser;
  select coalesce(array_agg(s.id order by s.id), '{}') into v_sources
    from public.brain_sources s where s.fund_id = _fund_id and s.company_entity_id = _loser;

  update public.brain_facts set subject_id = _winner
   where fund_id = _fund_id and id = any(v_subject_facts);
  update public.brain_facts set object_id = _winner
   where fund_id = _fund_id and id = any(v_object_facts);
  update public.brain_sources set company_entity_id = _winner
   where fund_id = _fund_id and id = any(v_sources);

  -- The loser's name and aliases become aliases of the winner (never the winner's own name twice).
  select coalesce(array_agg(a order by a), '{}') into v_added
    from (
      select distinct a from unnest(array[v_l.name] || v_l.aliases) as a
       where a is not null and btrim(a) <> ''
         and lower(a) <> lower(v_w.name)
         and not exists (select 1 from unnest(v_w.aliases) x where lower(x) = lower(a))
    ) names;

  update public.brain_entities
     set aliases = aliases || v_added,
         dirty_at = now(),
         last_seen_at = greatest(last_seen_at, v_l.last_seen_at)
   where id = _winner and fund_id = _fund_id;
  update public.brain_entities
     set status = 'merged', merged_into = _winner, dirty_at = null
   where id = _loser and fund_id = _fund_id;

  insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
                                reason, job_id)
  values (_fund_id, _actor, 'merge', 'entity', _loser,
          jsonb_build_object('winner', _winner, 'loserName', v_l.name, 'loserAliases', to_jsonb(v_l.aliases),
                             'winnerName', v_w.name, 'winnerAliases', to_jsonb(v_w.aliases)),
          jsonb_build_object('winner', _winner, 'subjectFactIds', to_jsonb(v_subject_facts),
                             'objectFactIds', to_jsonb(v_object_facts), 'sourceIds', to_jsonb(v_sources),
                             'addedAliases', to_jsonb(v_added)),
          left(_reason, 2000), _job_id);

  return jsonb_build_object(
    'movedFacts', cardinality(v_subject_facts) + cardinality(v_object_facts),
    'movedSources', cardinality(v_sources),
    'addedAliases', cardinality(v_added));
end;
$$;

create or replace function public.brain_split_entities(
  _fund_id uuid,
  _loser uuid,
  _actor text,
  _reason text default null,
  _job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.brain_entities%rowtype;
  v_w public.brain_entities%rowtype;
  v_log public.brain_log%rowtype;
  v_winner uuid;
  v_back_subject int;
  v_back_object int;
  v_back_sources int;
  v_added text[];
begin
  if _fund_id is null or _loser is null or _actor is null then
    raise exception 'brain_split_entities: fund, entity and actor are required';
  end if;
  select * into v_l from public.brain_entities where id = _loser and fund_id = _fund_id;
  if v_l.id is null then
    raise exception 'brain_split_entities: unknown entity' using errcode = 'P0002';
  end if;
  -- Lock the pair in id order, like brain_merge_entities (no deadlock between the two).
  perform 1 from public.brain_entities e
   where e.fund_id = _fund_id and e.id in (_loser, v_l.merged_into)
   order by e.id for update;
  select * into v_l from public.brain_entities where id = _loser and fund_id = _fund_id;
  if v_l.status <> 'merged' or v_l.merged_into is null then
    raise exception 'brain_split_entities: the entity is not merged';
  end if;

  select * into v_log from public.brain_log
   where fund_id = _fund_id and object_kind = 'entity' and object_id = _loser
     and action in ('merge', 'split')
   order by id desc limit 1;
  if v_log.id is null or v_log.action <> 'merge' then
    raise exception 'brain_split_entities: there is no merge in the log to undo';
  end if;
  if v_log.after is null or v_log.after -> 'winner' is null then
    raise exception 'brain_split_entities: the log of the merge has been masked and cannot be undone';
  end if;
  v_winner := (v_log.after ->> 'winner')::uuid;
  if v_winner is distinct from v_l.merged_into then
    raise exception 'brain_split_entities: the entity is merged into another one than the log says';
  end if;

  select * into v_w from public.brain_entities where id = v_winner and fund_id = _fund_id for update;
  if v_w.id is null or v_w.status <> 'active' then
    raise exception 'brain_split_entities: the winner is itself merged or gone; undo that first';
  end if;

  -- Only what still belongs to the winner moves back; facts that arrived later stay with it.
  update public.brain_facts f set subject_id = _loser
   where f.fund_id = _fund_id and f.subject_id = v_winner
     and f.id in (select x::uuid from jsonb_array_elements_text(v_log.after -> 'subjectFactIds') x);
  get diagnostics v_back_subject = row_count;
  update public.brain_facts f set object_id = _loser
   where f.fund_id = _fund_id and f.object_id = v_winner
     and f.id in (select x::uuid from jsonb_array_elements_text(v_log.after -> 'objectFactIds') x);
  get diagnostics v_back_object = row_count;
  update public.brain_sources s set company_entity_id = _loser
   where s.fund_id = _fund_id and s.company_entity_id = v_winner
     and s.id in (select x::uuid from jsonb_array_elements_text(v_log.after -> 'sourceIds') x);
  get diagnostics v_back_sources = row_count;

  select coalesce(array_agg(x), '{}') into v_added
    from jsonb_array_elements_text(v_log.after -> 'addedAliases') x;
  update public.brain_entities
     set aliases = coalesce((select array_agg(a) from unnest(aliases) a where a <> all (v_added)), '{}'),
         dirty_at = now()
   where id = v_winner and fund_id = _fund_id;
  update public.brain_entities
     set status = 'active', merged_into = null, dirty_at = now()
   where id = _loser and fund_id = _fund_id;

  insert into public.brain_log (fund_id, actor, action, object_kind, object_id, before, after,
                                reason, job_id)
  values (_fund_id, _actor, 'split', 'entity', _loser,
          jsonb_build_object('winner', v_winner, 'mergeLogId', v_log.id),
          jsonb_build_object('movedBackFacts', v_back_subject + v_back_object,
                             'movedBackSources', v_back_sources),
          left(_reason, 2000), _job_id);

  return jsonb_build_object(
    'winner', v_winner,
    'movedBackFacts', v_back_subject + v_back_object,
    'movedBackSources', v_back_sources);
end;
$$;

revoke all on function public.brain_merge_entities(uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.brain_split_entities(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.brain_merge_entities(uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.brain_split_entities(uuid, uuid, text, text, uuid) to service_role;
