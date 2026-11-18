-- 0101 · En delt tæller til hastighedsgrænser (midtvejs-/harden).
--
-- Grænserne lå i hukommelsen pr. Vercel-instans (`rateLimit` i access.server.ts), så hver ny
-- instans startede forfra, og de dyre AI-veje (screening, dyb analyse, dokumentimport, tese-chat,
-- kriterie-hjælp og forslag) havde kun en vagt mod parallelle kørsler: ét medlem kunne tømme
-- installationens fælles saldo. Nu tæller databasen: `rate_limit_hit(nøgle, grænse, vindue)`
-- tæller forsøg på nøglen i vinduet og giver lov, så længe grænsen ikke er nået. En advisory-lås
-- pr. nøgle gør optællingen og indsættelsen atomisk, så parallelle kald ikke alle slipper igennem.
-- Et afvist forsøg tæller ikke med.
--
-- Nøglerne er fx `ai:deep_analysis:user:<uuid>`, `ai:screening:fund:<uuid>`, `invite:<fond>`,
-- `invitation:accept:<hash af token>`: id'er og hashes, aldrig navne, e-mails eller tekst.
-- Rækkerne lever højst ét døgn (vinduet er højst et døgn, og gamle rækker ryddes løbende).
-- Kun service_role (serveren) kalder funktionen; ingen bruger kan se eller ændre tabellen.

begin;
set local lock_timeout = '5s';

create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  key text not null check (char_length(key) between 1 and 200),
  at timestamptz not null default now()
);

comment on table public.rate_limit_hits is
  'Forsøg pr. nøgle til hastighedsgrænser (T-866). Kun service_role via rate_limit_hit; rækker lever højst et døgn.';

create index if not exists rate_limit_hits_key_at on public.rate_limit_hits (key, at);
create index if not exists rate_limit_hits_at on public.rate_limit_hits (at);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated;
grant select, insert, delete on public.rate_limit_hits to service_role;

-- Samme begrænsende policy som alle tabeller med RLS (0094).
drop policy if exists mfa_required on public.rate_limit_hits;
create policy mfa_required on public.rate_limit_hits as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

create or replace function public.rate_limit_hit(_key text, _limit integer, _window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if _key is null or char_length(_key) not between 1 and 200
     or _limit is null or _limit < 1
     or _window_seconds is null or _window_seconds not between 1 and 86400 then
    raise exception 'Ugyldig hastighedsgrænse.';
  end if;
  -- Én ad gangen pr. nøgle: tælling og indsættelse kan ikke flettes af parallelle kald.
  perform pg_advisory_xact_lock(hashtextextended('rate_limit_hit:' || _key, 0));
  delete from public.rate_limit_hits
   where key = _key and at < now() - make_interval(secs => _window_seconds);
  -- Nøgler, der ikke bruges mere, ryddes af og til (intet vindue er længere end et døgn).
  if random() < 0.01 then
    delete from public.rate_limit_hits where at < now() - interval '1 day';
  end if;
  select count(*) into v_count from public.rate_limit_hits where key = _key;
  if v_count >= _limit then
    return false;
  end if;
  insert into public.rate_limit_hits (key) values (_key);
  return true;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Flere grænser på én gang (pr. bruger og pr. team): alle giver lov, eller intet tælles, og
-- svaret er nummeret (fra 1) på den første grænse, der er nået, eller 0. Låsene tages i fast
-- rækkefølge, så to kald med de samme nøgler ikke kan låse hinanden.
create or replace function public.rate_limit_hit_all(
  _keys text[],
  _limits integer[],
  _window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_index integer;
  v_count integer;
  v_key text;
begin
  if _keys is null or _limits is null or cardinality(_keys) not between 1 and 10
     or cardinality(_keys) <> cardinality(_limits)
     or _window_seconds is null or _window_seconds not between 1 and 86400
     or exists (select 1 from unnest(_keys) k where k is null or char_length(k) not between 1 and 200)
     or exists (select 1 from unnest(_limits) l where l is null or l < 1) then
    raise exception 'Ugyldig hastighedsgrænse.';
  end if;
  for v_key in select distinct k from unnest(_keys) k order by k loop
    perform pg_advisory_xact_lock(hashtextextended('rate_limit_hit:' || v_key, 0));
  end loop;
  if random() < 0.01 then
    delete from public.rate_limit_hits where at < now() - interval '1 day';
  end if;
  for v_index in 1 .. cardinality(_keys) loop
    delete from public.rate_limit_hits
     where key = _keys[v_index] and at < now() - make_interval(secs => _window_seconds);
    select count(*) into v_count from public.rate_limit_hits where key = _keys[v_index];
    if v_count >= _limits[v_index] then
      return v_index;
    end if;
  end loop;
  insert into public.rate_limit_hits (key) select k from unnest(_keys) k;
  return 0;
end;
$$;

revoke all on function public.rate_limit_hit_all(text[], integer[], integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit_all(text[], integer[], integer) to service_role;

commit;
