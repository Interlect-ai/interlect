-- 0099 · Søgeemnerne gemmes pr. fond og brief.
--
-- Mens ZDR er slået til, skriver et ZDR-trin neutrale søgeemner ud fra fondens tese og kriterier
-- ved hver research, og hver kørsel betaler for det igen. Emnerne afhænger kun af fondens
-- opsætning, så de gemmes her under en nøgle (SHA-256 af emnetrinnets version, model, prompt og
-- fondens brief): samme opsætning genbruger emnerne gratis, en ændret opsætning giver en ny nøgle
-- og nye emner. /intern/prompts viser de gemte emner for den aktive opsætning.
--
-- Emnerne er de neutrale ord, der allerede sendes til websøgningen, aldrig fondens egen tekst.
-- Kun service_role læser og skriver (serveren tjekker rollen først); RLS er slået til uden
-- tilladende policies, så brugere ikke kan se tabellen direkte. Additiv; ingen backfill.

begin;
set local lock_timeout = '5s';

create table if not exists public.fund_search_topics (
  fund_id uuid not null references public.funds(id) on delete cascade,
  brief_key text not null check (brief_key ~ '^[0-9a-f]{64}$'),
  topics text[] not null check (public.text_list_ok(topics, 1, 10, 80)),
  dropped_count integer not null default 0 check (dropped_count >= 0),
  model text not null check (char_length(model) between 1 and 100),
  cost_usd numeric check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now(),
  primary key (fund_id, brief_key)
);

comment on table public.fund_search_topics is
  'Neutrale søgeemner skrevet af et ZDR-trin ud fra fondens opsætning (T-202), gemt pr. brief, så næste research genbruger dem gratis (T-704). Kun service_role.';

revoke all on public.fund_search_topics from public, anon, authenticated;
grant all on public.fund_search_topics to service_role;

alter table public.fund_search_topics enable row level security;

-- Samme begrænsende policy som alle tabeller med RLS (0094).
drop policy if exists mfa_required on public.fund_search_topics;
create policy mfa_required on public.fund_search_topics as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

commit;
