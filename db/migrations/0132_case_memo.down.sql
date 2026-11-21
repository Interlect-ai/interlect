-- Rollback af 0132_case_memo.sql. Køres kun manuelt; run-migrations.mjs springer
-- .down.sql over. Sletter komitémemoens tabeller med alt indhold (forslag, mangelsvar og
-- versioner, også godkendte) og funktionerne. Audit-linjerne bliver.

begin;

drop function if exists public.approve_case_memo_version(uuid);
drop function if exists public.create_case_memo_draft(uuid, uuid, jsonb);
drop function if exists public.answer_case_memo_gap(uuid, text, text, text);
drop function if exists public.save_case_memo_input(uuid, text, jsonb);

drop table if exists public.case_memo_versions;
drop table if exists public.case_memo_gap_answers;
drop table if exists public.case_memo_inputs;

drop function if exists public.case_memo_versions_guard();
drop function if exists private.case_memo_fund(uuid, boolean);
drop function if exists private.can_write_case_memo(uuid);

-- Så run-migrations.mjs kører 0132 igen næste gang (tabellen findes kun, hvor scriptet har kørt).
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where filename = '0132_case_memo.sql';
  end if;
end
$$;

commit;
