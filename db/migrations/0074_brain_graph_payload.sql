-- 0074 · Hjernekortets data v1.
--
-- brain_graph_payload(fond) bygger hele fondens hjerne som ét JSON-objekt med kolonnevise arrays,
-- i ét kald (PostgREST' rækkeloft gælder ikke):
--   nodes: ids, types, labels, first_seen (epoch-sekunder til "Afspil væksten"),
--          decision ('invest' | 'reject' | 'decline_ic' | null) og ref (casens id, hvor der er en)
--   edges: src og dst som indeks i nodes, pred som indeks i preds, proposed (true = ikke
--          bekræftet), recorded (epoch-sekunder)
-- Punkter: fondens aktive entiteter (selskaber, personer, cases, sektorer, årsager, temaer osv.,
-- ikke nøgletal), noter på cases og beslutninger (stående `decided`-fakta og historiske
-- beslutninger). Koblinger: aktive og foreslåede fakta mellem to punkter (ikke afviste, udløbne
-- eller nøgletal), note → case, beslutning → case eller selskab og beslutning → årsag.
-- Ingen kildetekst eller citater: en note og en beslutning har kun en kort etiket; detaljer hentes
-- pr. punkt ved klik.
--
-- security invoker: rækkesikkerheden afgør, hvad den kaldende ser, og kaldet afvises for andre end
-- fondens medlemmer (og serverens service-rolle). Svaret skal under Vercels grænse på ca. 4,5 MB:
-- højst 15.000 punkter (entiteter først, de senest sete, så beslutninger og noter) og 60.000
-- koblinger (bekræftede først, de nyeste); `truncated` siger, om noget blev udeladt. Større fonde
-- får Storage-filen i 1.1. Datoer læses i UTC. Ingen tabeller ændres.

create or replace function public.brain_graph_payload(
  _fund_id uuid,
  _max_nodes int default 15000,
  _max_edges int default 60000
)
returns json
language plpgsql
stable
security invoker
set search_path = ''
set timezone = 'UTC'
-- The whole graph is read at once, so hash joins are always right; without this, a table without
-- fresh statistics (just after a large import) made the planner loop over CTEs (seconds, not ms).
set enable_nestloop = off
as $$
declare
  -- The limits can be lowered (tests), never raised.
  v_max_nodes constant int := greatest(1, least(coalesce(_max_nodes, 15000), 15000));
  v_max_edges constant int := greatest(0, least(coalesce(_max_edges, 60000), 60000));
  v_result json;
begin
  if _fund_id is null then
    raise exception 'brain_graph_payload: fund is required' using errcode = '22004';
  end if;
  if current_user <> 'service_role'
     and not public.is_fund_member((select auth.uid()), _fund_id) then
    raise exception 'brain_graph_payload: not a member of the fund' using errcode = '42501';
  end if;

  with entities as (
    select e.id, e.type, e.name as label, e.first_seen_at as first_seen, e.last_seen_at,
      e.normalized_key, case when e.ref_table = 'cases' then e.ref_id end as ref
    from public.brain_entities e
    where e.fund_id = _fund_id and e.status = 'active' and e.type <> 'metric'
  ),
  reasons as (
    select id, normalized_key from entities where type = 'reason'
  ),
  -- A standing decision on a case (not reopened): one point per case, kind and date, whatever the
  -- number of reasons. Its id is derived from those three, so it stays the same when the reasons
  -- are projected again.
  -- Joins below go to the tables and their indexes, not to the CTEs above: a CTE has no
  -- statistics, and a nested loop over two of them grows with notes × points.
  decided_facts as (
    select f.subject_id as target, f.value_text as kind, f.valid_from, f.recorded_at, f.object_id
    from public.brain_facts f
    where f.fund_id = _fund_id and f.predicate = 'decided' and f.status = 'active'
      and f.expired_at is null and f.valid_to is null
      and f.value_text in ('invest', 'reject', 'decline_ic')
  ),
  case_decisions as (
    select md5('decision:' || target::text || ':' || kind || ':' || coalesce(valid_from::text, ''))::uuid
        as id,
      target, kind, valid_from,
      coalesce(valid_from::timestamp, min(recorded_at)::timestamp) as first_seen
    from decided_facts
    group by target, kind, valid_from
  ),
  -- Earlier decisions from a decision file (0046). A company merged into another after the import
  -- still has its decision: it is shown on the company it became.
  historical as (
    select h.id, coalesce(m.merged_into, h.company_entity_id) as target, h.movement_kind as kind,
      coalesce(h.decided_on::timestamp, h.created_at at time zone 'UTC') as first_seen,
      h.reason_codes
    from public.brain_historical_decisions h
    join public.brain_entities m on m.id = h.company_entity_id and m.fund_id = h.fund_id
    where h.fund_id = _fund_id and h.movement_kind in ('invest', 'reject', 'decline_ic')
  ),
  decisions as (
    select d.id, d.target, d.kind, d.first_seen,
      case when t.ref_table = 'cases' then t.ref_id end as ref
    from (
      select id, target, kind, first_seen from case_decisions
      union all
      select id, target, kind, first_seen from historical
    ) d
    join public.brain_entities t on t.id = d.target
    where t.fund_id = _fund_id and t.status = 'active' and t.type <> 'metric'
  ),
  decision_reasons as (
    select distinct d.id, f.object_id as reason
    from decided_facts f
    join case_decisions d on d.target = f.target and d.kind = f.kind
      and d.valid_from is not distinct from f.valid_from
    where f.object_id is not null
    union
    select h.id, r.id
    from historical h
    cross join unnest(h.reason_codes) as code
    join reasons r on r.normalized_key = 'reason:' || code
  ),
  notes as (
    select n.id, t.id as target, n.created_at at time zone 'UTC' as first_seen, n.case_id as ref
    from public.case_notes n
    join public.brain_entities t on t.fund_id = _fund_id and t.ref_table = 'cases'
      and t.ref_id = n.case_id and t.type = 'case' and t.status = 'active'
    where n.fund_id = _fund_id
  ),
  -- The newest decision of each case or company colours its point (invested or not).
  latest_decision as (
    select distinct on (target) target, kind
    from decisions
    order by target, first_seen desc, id
  ),
  nodes_raw as (
    select e.id, e.type, e.label, e.first_seen at time zone 'UTC' as first_seen, d.kind as decision,
      e.ref, 0 as tier, e.last_seen_at as recency
    from entities e left join latest_decision d on d.target = e.id
    union all
    select d.id, 'decision', case d.kind
        when 'invest' then 'Investeret'
        when 'reject' then 'Kasseret'
        else 'Afvist i komitéen' end || ' ' || to_char(d.first_seen, 'DD.MM.YYYY'),
      d.first_seen, d.kind, d.ref, 1, d.first_seen at time zone 'UTC'
    from decisions d
    union all
    select n.id, 'note', 'Note ' || to_char(n.first_seen, 'DD.MM.YYYY'), n.first_seen, null, n.ref,
      2, n.first_seen at time zone 'UTC'
    from notes n
  ),
  kept as (
    select r.*
    from nodes_raw r
    order by r.tier, r.recency desc, r.id
    limit v_max_nodes
  ),
  nodes as (
    select k.*, (row_number() over (order by k.first_seen, k.id) - 1)::int as ord
    from kept k
  ),
  edges_raw as (
    -- Facts between two points: one edge per pair and predicate, confirmed if any fact is.
    select f.subject_id as src, f.object_id as dst, f.predicate as pred,
      bool_and(f.status = 'proposed') as proposed, min(f.recorded_at) at time zone 'UTC' as recorded
    from public.brain_facts f
    where f.fund_id = _fund_id and f.object_id is not null and f.expired_at is null
      and f.status in ('active', 'proposed') and f.predicate not in ('metric', 'decided')
    group by f.subject_id, f.object_id, f.predicate
    union all
    select d.id, d.target, 'decided', false, d.first_seen from decisions d
    union all
    select dr.id, dr.reason, 'because_of', false, d.first_seen
    from decision_reasons dr join decisions d on d.id = dr.id
    union all
    select n.id, n.target, 'note_on', false, n.first_seen from notes n
  ),
  edges_ranked as (
    select s.ord as src, t.ord as dst, er.pred, er.proposed, er.recorded,
      row_number() over (order by er.proposed, er.recorded desc, s.ord, t.ord, er.pred) as rank
    from edges_raw er
    join nodes s on s.id = er.src
    join nodes t on t.id = er.dst
    where s.ord <> t.ord
  ),
  edges as (
    select k.*,
      (dense_rank() over (order by k.pred) - 1)::int as pred_idx,
      row_number() over (order by k.src, k.dst, k.pred) as eord
    from edges_ranked k
    where k.rank <= v_max_edges
  )
  select json_build_object(
    'nodes', (
      select json_build_object(
        'ids', coalesce(json_agg(n.id order by n.ord), '[]'::json),
        'types', coalesce(json_agg(n.type order by n.ord), '[]'::json),
        'labels', coalesce(json_agg(n.label order by n.ord), '[]'::json),
        'first_seen', coalesce(
          json_agg(extract(epoch from n.first_seen at time zone 'UTC')::bigint order by n.ord),
          '[]'::json),
        'decision', coalesce(json_agg(n.decision order by n.ord), '[]'::json),
        'ref', coalesce(json_agg(n.ref order by n.ord), '[]'::json))
      from nodes n),
    'preds', (
      select coalesce(json_agg(p.pred order by p.pred_idx), '[]'::json)
      from (select distinct pred, pred_idx from edges) p),
    'edges', (
      select json_build_object(
        'src', coalesce(json_agg(e.src order by e.eord), '[]'::json),
        'dst', coalesce(json_agg(e.dst order by e.eord), '[]'::json),
        'pred', coalesce(json_agg(e.pred_idx order by e.eord), '[]'::json),
        'proposed', coalesce(json_agg(e.proposed order by e.eord), '[]'::json),
        'recorded', coalesce(
          json_agg(extract(epoch from e.recorded at time zone 'UTC')::bigint order by e.eord),
          '[]'::json))
      from edges e),
    'truncated', (select count(*) from nodes_raw) > v_max_nodes
      or exists (select 1 from edges_ranked where rank > v_max_edges)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.brain_graph_payload(uuid, int, int) is
  'Hjernekortets data (T-318): hele fondens hjerne som kolonnevise arrays. Kun fondens medlemmer; RLS gælder.';

revoke all on function public.brain_graph_payload(uuid, int, int) from public, anon;
grant execute on function public.brain_graph_payload(uuid, int, int) to authenticated, service_role;
