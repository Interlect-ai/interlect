-- 0046 · Historiske beslutninger.
--
-- Fondens tidligere beslutninger (fra en CSV/Excel-fil) gemmes i brain_historical_decisions og
-- aldrig i cases, så caselister, gates og analysejobs ikke forurenes. Hver række får en episode
-- (kind historical_decision, tillid customer_doc, udtræk 'skipped': beslutningen tælles ikke to
-- gange som tekst) og et selskab i grafen (deterministisk nøgle fra CVR, domæne eller navn).
-- brain_case_decisions (0033/0038) får de historiske rækker med (is_historical = true,
-- case_id og company_id tomme), så de tæller i beslutningsstatistikken.
--
-- brain_import_historical_decisions er kun for service_role (serveren tjekker brain_ingest) og
-- tager højst 500 rækker ad gangen; en gentaget import af samme række giver ingen dublet (row_hash).

create table public.brain_historical_decisions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  brain_source_id uuid not null,
  company_name text not null check (char_length(company_name) between 1 and 300),
  company_domain text check (company_domain is null or char_length(company_domain) <= 253),
  company_cvr text check (company_cvr is null or company_cvr ~ '^[0-9]{8}$'),
  company_entity_id uuid,
  decided_on date,
  movement_kind text not null check (movement_kind in ('reject', 'decline_ic', 'invest', 'hold')),
  reason_codes text[] not null default '{}',
  reason_text text check (reason_text is null or char_length(reason_text) <= 2000),
  amount_dkk numeric check (amount_dkk is null or amount_dkk >= 0),
  row_hash text not null check (char_length(row_hash) between 8 and 64),
  imported_by uuid not null,
  created_at timestamptz not null default now(),
  unique (id, fund_id),
  unique (fund_id, brain_source_id, row_hash),
  foreign key (brain_source_id, fund_id)
    references public.brain_sources(id, fund_id) on delete cascade,
  foreign key (company_entity_id, fund_id)
    references public.brain_entities(id, fund_id) on delete set null (company_entity_id)
);
create index brain_historical_decisions_fund_idx
  on public.brain_historical_decisions (fund_id, decided_on desc);
create index brain_historical_decisions_entity_idx
  on public.brain_historical_decisions (company_entity_id) where company_entity_id is not null;

alter table public.brain_historical_decisions enable row level security;
revoke all on public.brain_historical_decisions from public, anon, authenticated;
grant select on public.brain_historical_decisions to authenticated;
grant all on public.brain_historical_decisions to service_role;
create policy brain_historical_decisions_select_member on public.brain_historical_decisions
  for select to authenticated
  using (public.is_fund_member((select auth.uid()), fund_id));

-- The view counts historical decisions too (same columns; no case and no company row).
create or replace view public.brain_case_decisions
with (security_invoker = true)
as
select latest.fund_id,
       latest.case_id,
       c.company_id,
       latest.movement_kind as decision_kind,
       latest.occurred_at as decided_at,
       latest.reason_codes,
       false as is_historical
from public.cases c
join lateral (
  select e.*
  from public.case_transition_events e
  where e.case_id = c.id
    and e.fund_id = c.fund_id
    and e.movement_kind in ('reject', 'decline_ic', 'invest')
    and e.undo_of is null
    and not exists (
      select 1 from public.case_transition_events u where u.undo_of = e.id
    )
  order by e.occurred_at desc, e.id desc
  limit 1
) as latest on true
where c.phase = 'decided'
union all
select h.fund_id,
       null::uuid as case_id,
       null::uuid as company_id,
       h.movement_kind as decision_kind,
       h.decided_on::timestamptz as decided_at,
       h.reason_codes,
       true as is_historical
from public.brain_historical_decisions h
where h.movement_kind in ('reject', 'decline_ic', 'invest');

-- Rows: [{ companyName, companyDomain, companyCvr, entityKey, decidedOn, movementKind,
--          reasonCodes, reasonText, amountDkk, rowHash }]
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
