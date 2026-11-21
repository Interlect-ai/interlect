-- Rollback af 0133_setup_per_stage.sql. Køres kun manuelt; run-migrations.mjs springer
-- .down.sql over. Afvises, så snart noget er gemt pr. stadie eller i fund_mandates.setup: så ville
-- en rollback slette teamets opsætning, og de gamle unikke nøgler kan ikke komme tilbage.

begin;

set local lock_timeout = '5s';

-- Låst før tjekket, så intet kan gemmes pr. stadie mellem tjekket og sletningen af kolonnerne.
lock table public.fund_mandates, public.mandate_gates, public.assessment_criteria,
  public.prompt_module_overrides, public.fund_specialists in access exclusive mode;

do $$
declare
  t record;
  v_has_stage_rows boolean;
begin
  for t in
    select * from (values
      ('assessment_criteria', 'criterion_key'),
      ('mandate_gates', 'gate_key'),
      ('fund_specialists', 'specialist_key'),
      ('prompt_module_overrides', 'module_id')
    ) as v (tbl, key_col)
  loop
    if exists (select 1 from pg_attribute
               where attrelid = format('public.%I', t.tbl)::regclass and attname = 'stage'
                 and not attisdropped) then
      -- EXECUTE sætter ikke FOUND; svaret hentes med INTO.
      execute format('select exists (select 1 from public.%I where stage is not null)', t.tbl)
        into v_has_stage_rows;
      if v_has_stage_rows then
        raise exception 'Rollback afvist: % har rækker pr. stadie.', t.tbl;
      end if;
    end if;
  end loop;
  if exists (select 1 from pg_attribute
             where attrelid = 'public.fund_mandates'::regclass and attname = 'setup'
               and not attisdropped)
     and exists (select 1 from public.fund_mandates where setup <> '{}'::jsonb) then
    raise exception 'Rollback afvist: fund_mandates.setup er udfyldt.';
  end if;

  for t in
    select * from (values
      ('assessment_criteria', 'criterion_key'),
      ('mandate_gates', 'gate_key'),
      ('fund_specialists', 'specialist_key'),
      ('prompt_module_overrides', 'module_id')
    ) as v (tbl, key_col)
  loop
    execute format('alter table public.%I drop constraint if exists %I', t.tbl, t.tbl || '_version_stage_key');
    execute format('alter table public.%I drop constraint if exists %I', t.tbl, t.tbl || '_stage_known');
    execute format('alter table public.%I drop column if exists stage', t.tbl);
    execute format('alter table public.%I drop constraint if exists %I', t.tbl,
      t.tbl || '_config_version_id_' || t.key_col || '_key');
    execute format('alter table public.%I add constraint %I unique (config_version_id, %I)',
      t.tbl, t.tbl || '_config_version_id_' || t.key_col || '_key', t.key_col);
  end loop;
end
$$;

alter table public.fund_mandates drop constraint if exists fund_mandates_setup_ok;
alter table public.fund_mandates drop column if exists setup;
drop function if exists public.fund_setup_ok(jsonb);

-- Kopien som i 0127.
create or replace function private.copy_fund_config_content(_from uuid, _to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fund_mandates
    (config_version_id, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
     ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
     strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards)
  select _to, thesis, stages, geographies, sectors, fund_size_eur, ticket_min_eur,
    ticket_max_eur, ticket_note, analysis_threshold, approval_mode, risk_posture,
    strategy_type, stage_expectations, dealbreakers, screening_instruction, screening_cards
  from public.fund_mandates where config_version_id = _from;

  insert into public.mandate_gates
    (config_version_id, gate_key, label, description, treatment, sort_order)
  select _to, gate_key, label, description, treatment, sort_order
  from public.mandate_gates where config_version_id = _from;

  insert into public.assessment_criteria
    (config_version_id, criterion_key, label, description, score_category, weight, sort_order,
     code_anchor)
  select _to, criterion_key, label, description, score_category, weight, sort_order,
    code_anchor
  from public.assessment_criteria where config_version_id = _from;

  insert into public.fund_profile_sources
    (config_version_id, label, url, supports, source_type, collected_at)
  select _to, label, url, supports, source_type, collected_at
  from public.fund_profile_sources where config_version_id = _from;

  insert into public.prompt_module_overrides
    (config_version_id, module_id, mandate, evidence_tests, risk_areas, updated_by)
  select _to, module_id, mandate, evidence_tests, risk_areas, auth.uid()
  from public.prompt_module_overrides where config_version_id = _from;

  insert into public.research_module_overrides
    (config_version_id, mode, module_id, questions, updated_by)
  select _to, mode, module_id, questions, auth.uid()
  from public.research_module_overrides where config_version_id = _from;

  insert into public.fund_specialists
    (config_version_id, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
     evidence_tests, risk_areas, research_questions, output_focus, categories, updated_by)
  select _to, specialist_key, kind, enabled, sort_order, name, purpose, mandate,
    evidence_tests, risk_areas, research_questions, output_focus, categories, auth.uid()
  from public.fund_specialists where config_version_id = _from;
end;
$$;

revoke all on function private.copy_fund_config_content(uuid, uuid) from public, anon, authenticated;

-- Så run-migrations.mjs kører 0133 igen næste gang (tabellen findes kun, hvor scriptet har kørt).
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where filename = '0133_setup_per_stage.sql';
  end if;
end
$$;

commit;
