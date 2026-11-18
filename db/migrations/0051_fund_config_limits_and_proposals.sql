-- 0051 · Fondsopsætning: faste grænser i databasen og AI-forslag som diff.
--
-- 1. En fondsprofilversion kan kun blive aktiv, når hvert kriterie vægter mellem 5 og 40 %.
--    Summen på 100 % tjekkes allerede af activate_fund_config. Reglen sidder som en trigger på
--    selve skiftet til aktiv (ikke i funktionen, der er omskrevet af 0021 og 0032), så den
--    gælder uanset hvem der kalder, også service-rollen. Allerede aktive versioner røres ikke.
-- 2. fund_config_proposals: et forslag ("Ret med AI", tese-hjælperen) er en liste af redigeringer
--    mod en bestemt kladde, med diff og status. Et forslag ændrer aldrig kladden eller
--    analyser; kun et menneske kan lægge det i kladden, og først udgivelsen påvirker analyser.
--
-- Additiv og bagudkompatibel (preview og produktion deler databasen): ny trigger og ny tabel,
-- ingen ændrede funktionssignaturer. Skrives kun af serveren (service-rollen).

-- ---------------------------------------------------------------------------
-- 1. Vægtgrænser ved udgivelse
-- ---------------------------------------------------------------------------

create or replace function private.assert_config_weight_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list text;
begin
  if new.status = 'active'::public.fund_config_status
     and old.status is distinct from 'active'::public.fund_config_status then
    select string_agg(format('%s %s %%', c.label, c.weight), ', ' order by c.sort_order)
    into v_list
    from public.assessment_criteria c
    where c.config_version_id = new.id and (c.weight < 5 or c.weight > 40);
    if v_list is not null then
      raise exception 'Hvert område skal vægte mellem 5 og 40 %%: %.', v_list
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.assert_config_weight_limits() from public, anon, authenticated;

create trigger fund_config_versions_weight_limits
before update of status on public.fund_config_versions
for each row execute function private.assert_config_weight_limits();

-- ---------------------------------------------------------------------------
-- 2. Forslag til kladden
-- ---------------------------------------------------------------------------

create table public.fund_config_proposals (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  -- Kladden forslaget er lavet mod. Følger kladden, når den publiceres eller slettes.
  config_version_id uuid not null references public.fund_config_versions (id) on delete cascade,
  source text not null check (source in ('ai_fix', 'ai_thesis')),
  -- Brugerens egne ord (hvad AI'en blev bedt om) og ét resumé af, hvad forslaget ændrer.
  instruction text not null check (char_length(instruction) between 3 and 4000),
  summary text not null check (char_length(summary) between 1 and 1000),
  -- Listen af redigeringer (src/lib/funds/config-ops.ts) og diffen i ord, begge regnet i kode.
  changes jsonb not null check (jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 12),
  diff jsonb not null default '[]'::jsonb check (jsonb_typeof(diff) = 'array'),
  -- Fingeraftrykket af kladden, forslaget blev lavet mod; afviger kladden, er forslaget forældet.
  base_fingerprint text not null check (char_length(base_fingerprint) between 16 and 64),
  status text not null default 'open' check (status in ('open', 'applied', 'rejected', 'stale')),
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (decided_at is null) or status = 'stale')
);

create index fund_config_proposals_fund_idx
  on public.fund_config_proposals (fund_id, status, created_at desc);
create index fund_config_proposals_config_idx on public.fund_config_proposals (config_version_id);
create index fund_config_proposals_created_by_idx on public.fund_config_proposals (created_by);
create index fund_config_proposals_decided_by_idx on public.fund_config_proposals (decided_by);

comment on table public.fund_config_proposals is
  'AI-forslag til en fondsprofilkladde som redigeringer med diff. Ændrer intet, før et menneske lægger det i kladden (R-9).';

revoke all on public.fund_config_proposals from public, anon, authenticated;
grant select on public.fund_config_proposals to authenticated;
grant all on public.fund_config_proposals to service_role;
alter table public.fund_config_proposals enable row level security;

create policy "fund_config_proposals_select_member" on public.fund_config_proposals
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));
