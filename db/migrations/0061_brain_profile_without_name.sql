-- 0061 · Case-profilen uden selskabsnavn (eksamen pakke D2).
--
-- Brain finder "lignende cases" på en vektor af case-profilen (brain_case_profile_text, 0044).
-- Profilen startede med "Case: <navn>", og analyseteksterne nævner selskabet ved navn, så en
-- navne-tvilling (samme navn, andet selskab) blev nærmeste nabo: eksamen målte 0 % og navne-
-- forveksling på alle tre "lignende"-spørgsmål. Nu bygges profilen af sektor, stadie, geografi,
-- selskabets beskrivelse (problem, kunde, forretningsmodel), tese-fit, syntese, styrker og risici,
-- og selskabets navn (og juridiske navn) erstattes med "selskabet" overalt i teksten.
-- Profilens hash ændrer sig, så L0 beregner vektoren igen ved næste kørsel for hver case.

begin;

create or replace function public.brain_strip_names(_text text, _names text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := _text;
  v_name text;
begin
  if v_text is null then
    return null;
  end if;
  -- Longest first, so "Solsort Pay ApS" goes before "Solsort Pay". Whole words only and
  -- whatever the case, so "Pay" does not eat "Payment" and "SOLSORT PAY" does not survive.
  for v_name in
    select n from unnest(coalesce(_names, array[]::text[])) as n order by char_length(n) desc
  loop
    v_text := regexp_replace(
      v_text,
      '(?<![[:alnum:]])' || regexp_replace(v_name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '(?![[:alnum:]])',
      'selskabet',
      'gi');
  end loop;
  return v_text;
end;
$$;

revoke all on function public.brain_strip_names(text, text[]) from public, anon, authenticated;
grant execute on function public.brain_strip_names(text, text[]) to service_role;

create or replace function public.brain_case_profile_text(_fund_id uuid, _case_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company record;
  v_screening text;
  v_deep text;
  v_run uuid;
  v_strengths text;
  v_risks text;
  v_names text[];
begin
  select co.name, coalesce(t.label_da, co.sector) as sector, co.stage::text as stage,
    coalesce(co.hq_country, co.geography) as geography, co.description, co.legal_name
    into v_company
  from public.cases c
  join public.companies co on co.id = c.company_id and co.fund_id = c.fund_id
  left join public.sector_taxonomy t on t.key = co.sector_key
  where c.id = _case_id and c.fund_id = _fund_id;
  if not found then
    return null;
  end if;

  select nullif(btrim(x.rationale), '') into v_screening
  from public.analysis_runs r
  join public.recommendations x on x.run_id = r.id and x.fund_id = r.fund_id
  where r.fund_id = _fund_id and r.case_id = _case_id and r.kind = 'screening'
    and r.status in ('complete', 'awaiting_approval')
  order by coalesce(r.completed_at, r.created_at) desc, x.created_at desc
  limit 1;

  select nullif(btrim(x.rationale), '') into v_deep
  from public.analysis_runs r
  join public.recommendations x on x.run_id = r.id and x.fund_id = r.fund_id
  where r.fund_id = _fund_id and r.case_id = _case_id and r.kind = 'deep'
    and r.status = 'complete'
  order by coalesce(r.completed_at, r.created_at) desc, x.created_at desc
  limit 1;

  if v_screening is null and v_deep is null then
    return null;
  end if;

  -- Strengths and risks from the newest finished run (deep before screening).
  select r.id into v_run
  from public.analysis_runs r
  where r.fund_id = _fund_id and r.case_id = _case_id
    and r.status in ('complete', 'awaiting_approval')
  order by (r.kind = 'deep') desc, coalesce(r.completed_at, r.created_at) desc
  limit 1;

  select string_agg(s.statement, '; ') into v_strengths
  from (
    select btrim(f.statement) as statement
    from public.analysis_findings f
    where f.run_id = v_run and f.fund_id = _fund_id and f.finding_type = 'strength'
    order by f.confidence desc nulls last, f.created_at, f.id
    limit 3
  ) s;

  select string_agg(k.statement, '; ') into v_risks
  from (
    select btrim(k.statement) as statement
    from public.risks k
    where k.run_id = v_run and k.fund_id = _fund_id
    order by array_position(array['critical', 'high', 'medium', 'low'], k.level::text), k.created_at, k.id
    limit 3
  ) k;

  -- The name stays out of the profile: companies with the same name are not alike, and a profile
  -- that carries the name makes a name twin the nearest neighbour (T-115, exam package D2).
  v_names := array(
    select distinct n
    from unnest(array[
      v_company.name,
      regexp_replace(v_company.name, '\s*\(.*\)\s*$', ''),
      v_company.legal_name,
      regexp_replace(coalesce(v_company.legal_name, ''), '\s+(ApS|A/S|AB|AS|Oy)$', '')
    ]) as n
    where n is not null and char_length(btrim(n)) >= 3
  );
  v_screening := public.brain_strip_names(v_screening, v_names);
  -- Cut after the names are gone, so the cut cannot leave a prefix of one.
  v_deep := left(public.brain_strip_names(v_deep, v_names), 1500);
  v_strengths := public.brain_strip_names(v_strengths, v_names);
  v_risks := public.brain_strip_names(v_risks, v_names);

  return concat_ws(E'\n',
    'Sektor: ' || coalesce(v_company.sector, 'ukendt')
      || ' · Stadie: ' || coalesce(v_company.stage, 'ukendt')
      || ' · Geografi: ' || coalesce(v_company.geography, 'ukendt'),
    'Beskrivelse: ' || public.brain_strip_names(
      nullif(btrim(regexp_replace(coalesce(v_company.description, ''),
        'Syntetisk demo-selskab\. Findes ikke\.', '', 'g')), ''), v_names),
    'Tese-fit: ' || v_screening,
    'Syntese: ' || v_deep,
    'Styrker: ' || v_strengths,
    'Risici: ' || v_risks);
end;
$$;

commit;
