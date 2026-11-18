-- 0058 · Kildens episoder i dokumentets rækkefølge (rettelse til 0054).
--
-- brain_source_pending_episodes (0054) sorterede efter created_at og derefter id. Alle afsnit fra én
-- kilde gemmes i samme transaktion (brain_ingest_store_chunks, 0053), så de har samme created_at, og
-- rækkefølgen blev afgjort af tilfældige uuid'er. Når loftet for et dokument nås, blev der derfor
-- læst tilfældige afsnit for fakta i stedet for dokumentets begyndelse (fundet af CI 4. okt, hvor
-- testen "i rækkefølge" fejlede i nogle kørsler). Nu sorteres efter afsnittets ordinal fra kilden,
-- som brain_source_pending_chunks (0053) allerede gør.
--
-- Samme signatur, samme rettigheder: additiv og bagudkompatibel (preview og produktion deler
-- databasen; koden virker med både 0054 og 0058).

create or replace function public.brain_source_pending_episodes(
  _fund_id uuid,
  _source_id uuid,
  _limit int default 120
)
returns table (
  episode_id uuid, kind text, trust_tier text, occurred_at timestamptz, title text, content text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.kind, e.trust_tier, e.occurred_at, e.title, e.content
  from public.brain_episodes e
  left join lateral (
    select min(c.ordinal) as ordinal
    from public.brain_chunks c
    where c.episode_id = e.id
      and c.fund_id = e.fund_id
  ) first_chunk on true
  where e.fund_id = _fund_id
    and e.brain_source_id = _source_id
    and e.extraction_status = 'pending'
  order by first_chunk.ordinal nulls last, e.created_at, e.id
  limit least(greatest(coalesce(_limit, 120), 1), 500)
$$;

revoke all on function public.brain_source_pending_episodes(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.brain_source_pending_episodes(uuid, uuid, int) to service_role;
