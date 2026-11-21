-- 0130 · Ingen modelnavne eller rå udbydertekst i kørslens data (fund L3-1 til L3-3 fra /harden på
-- spor B, harden/20261104-2117-0aae055/verified.md).
--
-- 1. analysis_runs.raw_response for dybe analyser havde under publicResearch hele research-trinets
--    output: researchPlan.model, researchFollowUp.model, researchLog[].error (udbyderens egen
--    tekst), questionNeutralizer m.fl. Kolonnen er givet til browserens rolle (0115), og RLS lader
--    alle i teamet, også Læser, læse den over REST. Serveren gemmer nu kun selve svaret
--    (PUBLIC_RESEARCH_ANSWER_KEYS i src/lib/analysis/public-research.ts); her renses de gamle
--    rækker til de samme nøgler. Intet andet i raw_response røres.
-- 2. error_message på analysis_runs og analysis_run_steps kan rumme udbyderens eller databasens
--    egen tekst (fra kørsler og fra fejl, serveren ikke selv har formuleret). Browseren
--    læser aldrig kolonnen selv; sagssiden får den gennem serveren, som kun sender Interlects egne
--    sætninger (src/lib/errors/run-error.ts). Kolonnen tages derfor fra browserens rolle, som
--    modelnavne og priser i 0115. Ingen security invoker-funktion læser kolonnen.
-- Kun-tilføj i øvrigt: ingen rækker slettes, ingen andre kolonner ændres.

begin;

update public.analysis_runs
set raw_response = jsonb_set(
  raw_response,
  '{publicResearch}',
  (
    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    from jsonb_each(raw_response -> 'publicResearch') as entry(key, value)
    where entry.key in (
      'schemaVersion', 'companyName', 'findings', 'gaps', 'identityAmbiguity', 'companyProfile'
    )
  )
)
where kind = 'deep'
  and jsonb_typeof(raw_response -> 'publicResearch') = 'object'
  and exists (
    select 1
    from jsonb_object_keys(raw_response -> 'publicResearch') as k(key)
    where k.key not in (
      'schemaVersion', 'companyName', 'findings', 'gaps', 'identityAmbiguity', 'companyProfile'
    )
  );

revoke select (error_message) on public.analysis_runs from authenticated;
revoke select (error_message) on public.analysis_run_steps from authenticated;

comment on column public.analysis_runs.error_message is
  'T-1070: kun serveren; sagssiden får Interlects egen sætning via getCaseDetail (run-error.ts).';
comment on column public.analysis_run_steps.error_message is
  'T-1070: kun serveren; sagssiden får Interlects egen sætning via getCaseDetail (run-error.ts).';

commit;
