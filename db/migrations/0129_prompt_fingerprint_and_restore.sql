-- 0129 · Version og sporbarhed (TS-21).
--
-- 1. analysis_runs.prompt_fingerprint og analysis_run_steps.prompt_fingerprint: sha256 (hex) af
--    præcis den prompt (system, bruger og svarskema), modellen fik, før maskering. I dag gemmes kun
--    opsætningsversionen og skabelonens version; fingeraftrykket viser bagefter, om to kørsler fik
--    samme prompt. Prompten selv gemmes ikke. Trinet har fingeraftrykket for sit kald; kørslen har
--    screeningens kald eller, ved dyb analyse, et samlet fingeraftryk af specialisterne og
--    syntesen. Ældre kørsler har null (intet gættes bagud).
--    Kolonnerne gives IKKE til browserens rolle (0115: kun kolonner i en grant kan læses), så de
--    står kun for serveren, som modelnavne og promptversioner.
-- 2. restore_fund_config_version: "Gendan" af en ældre version opretter en NY kladde med næste
--    versionsnummer og den gamle versions indhold. Intet eksisterende ændres eller slettes;
--    historikken er kun-tilføj. Findes der allerede en kladde for tesen, afvises gendannelsen (den
--    overskriver aldrig en kladde). Samme rettigheder som create_fund_config_draft (Admin og Lead).

begin;

alter table public.analysis_runs add column prompt_fingerprint text;
alter table public.analysis_run_steps add column prompt_fingerprint text;

alter table public.analysis_runs
  add constraint analysis_runs_prompt_fingerprint_format
  check (prompt_fingerprint is null or prompt_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.analysis_run_steps
  add constraint analysis_run_steps_prompt_fingerprint_format
  check (prompt_fingerprint is null or prompt_fingerprint ~ '^[0-9a-f]{64}$');

comment on column public.analysis_runs.prompt_fingerprint is
  'T-1039: sha256 af prompten (screening) eller af trinenes fingeraftryk (dyb analyse). Kun serveren.';
comment on column public.analysis_run_steps.prompt_fingerprint is
  'T-1039: sha256 af system, bruger og svarskema for trinets modelkald, før maskering. Kun serveren.';

create or replace function public.restore_fund_config_version(_source_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.fund_config_versions%rowtype;
  v_new_id uuid;
  v_next_version integer;
  v_thesis_status text;
begin
  select * into v_source
  from public.fund_config_versions
  where id = _source_config_id
    and status in ('active'::public.fund_config_status, 'superseded'::public.fund_config_status);

  if v_source.id is null then raise exception 'Versionen blev ikke fundet.'; end if;
  if not public.can_configure_fund(auth.uid(), v_source.fund_id) then
    raise exception 'Kun en Admin eller Lead kan redigere fondsopsætningen.';
  end if;
  -- Tesen låses før tjekkene, så en samtidig arkivering eller gendannelse venter (no key update
  -- blokerer ikke nye cases og versioner, der kun peger på tesen).
  select t.status into v_thesis_status
  from public.fund_theses t where t.id = v_source.thesis_id
  for no key update;
  if v_thesis_status = 'archived' then
    raise exception 'Tesen er arkiveret. Genaktivér den for at redigere.';
  end if;
  -- Én kladde pr. tese: en gendannelse overskriver aldrig en kladde.
  if exists (
    select 1 from public.fund_config_versions
    where thesis_id = v_source.thesis_id and status = 'draft'::public.fund_config_status
  ) then
    raise exception 'Der er allerede en kladde. Udgiv eller slet den, før en ældre version gendannes.';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.fund_config_versions where thesis_id = v_source.thesis_id;

  insert into public.fund_config_versions
    (fund_id, thesis_id, version, profile_key, status, source_basis, researched_at, created_by)
  values
    (v_source.fund_id, v_source.thesis_id, v_next_version, v_source.profile_key, 'draft',
     'administrator_configuration', current_date, auth.uid())
  returning id into v_new_id;

  perform private.copy_fund_config_content(v_source.id, v_new_id);

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_source.fund_id, 'user', auth.uid(), 'fund_config_restored_as_draft',
    'fund_config_versions', v_new_id,
    jsonb_build_object('source_config_id', v_source.id, 'source_version', v_source.version,
      'version', v_next_version, 'thesis_id', v_source.thesis_id));
  return v_new_id;
end;
$$;

revoke all on function public.restore_fund_config_version(uuid) from public, anon;
grant execute on function public.restore_fund_config_version(uuid) to authenticated, service_role;

commit;
