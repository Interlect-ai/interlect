-- ét opdigtet navn tilhører ét selskab eller én person. Flere rigtige navne for det
-- samme (mærke- og juridisk navn, en anden stavemåde) deler stadig alias, men to forskellige navne
-- kan ikke længere få det samme, heller ikke når to visninger opfinder navne samtidig.
--
-- 1. display_aliases.owns_alias: rækken, aliaset blev opfundet til. Rækker, der låner et andet
--    navns alias, står med false (standard, så en ældre server stadig kan gemme).
-- 2. Hvert alias har højst én ejer pr. team. Den, der kommer sidst, får en fejl, og serveren
--    opfinder et nyt navn (src/lib/display/display-names.server.ts).
-- 3. Eksisterende rækker: den første i hver gruppe med samme alias bliver ejer. På staging deler
--    hver gruppe et navn for det samme selskab eller den samme person (tjekket 18. okt), så intet
--    alias skifter.

begin;

set local search_path = public, extensions;

alter table public.display_aliases
  add column if not exists owns_alias boolean not null default false;

update public.display_aliases d
set owns_alias = true
from (
  select distinct on (fund_id, lower(btrim(alias))) id
  from public.display_aliases
  order by fund_id, lower(btrim(alias)), created_at, id
) first_of_alias
where d.id = first_of_alias.id;

create unique index if not exists display_aliases_one_owner
  on public.display_aliases (fund_id, lower(btrim(alias)))
  where owns_alias;

commit;
