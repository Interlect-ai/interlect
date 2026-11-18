-- 0088 · Historiske beslutninger får årsags-entiteter.
--
-- brain_import_historical_decisions (0046) gemte årsagskoderne, men kun case-projektionen (0060)
-- lavede årsags-entiteten reason:<kode>. En fond, der importerer sin historik, før den har
-- besluttet cases med de samme koder i Interlect, fik derfor ingen årsager på de historiske
-- beslutninger i hjernekortet (0074 slår dem op på normalized_key) eller i Brains fakta. Nu
-- opretter importen entiteten på samme måde (navn fra brain_reason_codes, ellers koden), og de
-- historiske rækker, der allerede er importeret, får deres entiteter én gang nedenfor.

create or replace function public.brain_import_historical_decisions(
  _fund_id uuid,
  _source_id uuid,
  _rows jsonb,
  _imported_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_entity uuid;
  v_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_content text;
  v_kind_text text;
  v_code text;
  v_code_id uuid;
  v_label text;
begin
  if _fund_id is null or _source_id is null or _imported_by is null
     or _rows is null or jsonb_typeof(_rows) <> 'array' then
    raise exception 'brain_import_historical_decisions: fund, source, user and a row array are required';
  end if;
  if jsonb_array_length(_rows) > 500 then
    raise exception 'brain_import_historical_decisions: at most 500 rows at a time';
  end if;
  perform 1 from public.brain_sources s
   where s.id = _source_id and s.fund_id = _fund_id for key share;
  if not found then
    raise exception 'brain_import_historical_decisions: unknown source' using errcode = 'P0002';
  end if;

  for v_row in select * from jsonb_array_elements(_rows) loop
    v_entity := public.brain_upsert_ref_entity(
      _fund_id, 'company', v_row ->> 'companyName', v_row ->> 'entityKey');
    v_id := null;

    insert into public.brain_historical_decisions (
      fund_id, brain_source_id, company_name, company_domain, company_cvr, company_entity_id,
      decided_on, movement_kind, reason_codes, reason_text, amount_dkk, row_hash, imported_by)
    values (
      _fund_id, _source_id, left(v_row ->> 'companyName', 300),
      nullif(v_row ->> 'companyDomain', ''), nullif(v_row ->> 'companyCvr', ''), v_entity,
      nullif(v_row ->> 'decidedOn', '')::date, v_row ->> 'movementKind',
      coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'reasonCodes', '[]'::jsonb))), '{}'),
      left(nullif(v_row ->> 'reasonText', ''), 2000),
      nullif(v_row ->> 'amountDkk', '')::numeric, v_row ->> 'rowHash', _imported_by)
    on conflict (fund_id, brain_source_id, row_hash) do nothing
    returning id into v_id;

    if v_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_inserted := v_inserted + 1;

    -- T-813: each reason becomes the same entity the case projection makes (0060), so the brain
    -- map and Brain's facts show the reasons of history imported before any case had them.
    for v_code in
      select distinct c from unnest(
        coalesce(array(select jsonb_array_elements_text(coalesce(v_row -> 'reasonCodes', '[]'::jsonb))), '{}')
      ) as c
      where c <> ''
    loop
      v_code_id := null;
      v_label := null;
      select rc.id, rc.label into v_code_id, v_label
      from public.brain_reason_codes rc
      where rc.fund_id = _fund_id and rc.code = v_code;
      perform public.brain_upsert_ref_entity(
        _fund_id, 'reason', coalesce(v_label, v_code), 'reason:' || v_code,
        case when v_code_id is null then null else 'brain_reason_codes' end, v_code_id);
    end loop;

    v_kind_text := case v_row ->> 'movementKind'
      when 'invest' then 'investerede i'
      when 'reject' then 'kasserede'
      when 'decline_ic' then 'afviste i komitéen'
      else 'satte på hold' end;
    v_content := left(
      'Fonden ' || v_kind_text || ' ' || (v_row ->> 'companyName')
      || coalesce(' (' || nullif(v_row ->> 'decidedOn', '') || ')', '')
      || coalesce('. Årsag: ' || nullif(v_row ->> 'reasonText', ''), '') || '.', 8000);
    insert into public.brain_episodes (
      fund_id, kind, ref_table, ref_id, brain_source_id, trust_tier, occurred_at, title,
      content, content_hash, extraction_status)
    values (
      _fund_id, 'historical_decision', 'brain_historical_decisions', v_id, _source_id,
      'customer_doc', nullif(v_row ->> 'decidedOn', '')::timestamptz,
      left(v_row ->> 'companyName', 300), v_content, md5(v_content), 'skipped');

    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after)
    values (_fund_id, 'INGEST', 'insert', 'historical_decision', v_id,
            jsonb_build_object('source_id', _source_id, 'movementKind', v_row ->> 'movementKind'));
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

revoke all on function public.brain_import_historical_decisions(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.brain_import_historical_decisions(uuid, uuid, jsonb, uuid)
  to service_role;

-- Rows imported before this migration: their reasons once, as the import now does.
do $$
declare
  v record;
begin
  for v in
    select distinct h.fund_id, c as code, rc.id as code_id, rc.label
    from public.brain_historical_decisions h
    cross join unnest(h.reason_codes) as c
    left join public.brain_reason_codes rc on rc.fund_id = h.fund_id and rc.code = c
    where c <> ''
  loop
    perform public.brain_upsert_ref_entity(
      v.fund_id, 'reason', coalesce(v.label, v.code), 'reason:' || v.code,
      case when v.code_id is null then null else 'brain_reason_codes' end, v.code_id);
  end loop;
end;
$$;
