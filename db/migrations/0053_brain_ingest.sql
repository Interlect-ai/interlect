-- 0053 · Brain · Kilder: upload og INGEST (-2 og §5).
--
-- 1. Storage-bucketen brain-sources: privat, 25 MB, ingen politikker. Kun serveren (service-rollen)
--    kan skrive og læse; filer overføres med korte, signerede URL'er. Stien er altid
--    {fond-id}/{kilde-id}/{filnavn} (brain_sources har allerede et tjek på fond-id'et).
-- 2. Nye felter på brain_sources til upload, pris-overslag, godkendelse og fremdrift. Alle er
--    nullable eller har en standardværdi (preview og produktion deler databasen).
-- 3. brain_ingest_store_chunks: gemmer en kildes chunks som episoder (kind source_chunk),
--    idempotent (en gentaget kørsel giver 0 nye rækker) og logget i brain_log. Embeddings sættes
--    bagefter af serveren (som L0 gør), så SQL'en ikke afhænger af, hvilket skema vector ligger i.

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('brain-sources', 'brain-sources', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- 2. brain_sources
-- ---------------------------------------------------------------------------
alter table public.brain_sources
  add column file_name text check (file_name is null or char_length(file_name) between 1 and 200),
  add column size_bytes bigint check (size_bytes is null or (size_bytes >= 0 and size_bytes <= 26214400)),
  add column page_count int check (page_count is null or page_count >= 0),
  add column chunk_count int check (chunk_count is null or chunk_count >= 0),
  add column estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  add column max_cost_usd numeric check (max_cost_usd is null or max_cost_usd >= 0),
  -- "Læs kun de første N sider", når overslaget er over loftet.
  add column page_limit int check (page_limit is null or page_limit between 1 and 300),
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column upload_completed_at timestamptz,
  add column summary_md text check (summary_md is null or char_length(summary_md) <= 4000),
  add column language text check (language is null or char_length(language) between 2 and 8),
  -- Brugerrettede noter, fx "3 sider er billeder og er kun delvist læst".
  add column warnings text[] not null default '{}',
  -- Det trin, kørslen er nået til, og det trin der fejlede (genoptag fra det fejlede trin).
  add column step text check (step is null or step in ('extract','classify','chunk','embed','facts','link')),
  add column failed_step text check (failed_step is null or failed_step in ('extract','classify','chunk','embed','facts','link')),
  -- Fingeraftrykket af de chunks, der er gemt. Ændrer udtrækket sig mellem to kørsler (en anden
  -- sidegrænse, en ny version af parseren), erstattes kildens chunks i stedet for at blive stående
  -- sammen med de nye; er det uændret, beholdes de (og deres embeddings).
  add column chunk_signature text check (chunk_signature is null or char_length(chunk_signature) between 16 and 128);

comment on column public.brain_sources.approved_at is
  'Når et menneske har godkendt prisoverslaget; INGEST startes først da (05 §2).';
comment on column public.brain_sources.upload_completed_at is
  'Når filen er læst, typetjekket (magic bytes) og sha256 regnet; null = upload i gang eller afbrudt.';

-- ---------------------------------------------------------------------------
-- 3. Gem chunks som episoder
-- ---------------------------------------------------------------------------
create or replace function public.brain_ingest_store_chunks(
  _fund_id uuid,
  _source_id uuid,
  _chunks jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.brain_sources%rowtype;
  v_chunk jsonb;
  v_episode uuid;
  v_inserted int := 0;
begin
  if _fund_id is null or _source_id is null or _chunks is null
     or jsonb_typeof(_chunks) is distinct from 'array' then
    raise exception 'brain_ingest_store_chunks: fund, source and a chunk array are required';
  end if;
  if jsonb_array_length(_chunks) > 400 then
    raise exception 'brain_ingest_store_chunks: at most 400 chunks per call';
  end if;
  select * into v_source from public.brain_sources s
   where s.id = _source_id and s.fund_id = _fund_id
   for update;
  if not found then
    raise exception 'brain_ingest_store_chunks: unknown source' using errcode = 'P0002';
  end if;

  for v_chunk in select * from jsonb_array_elements(_chunks) loop
    -- One episode per chunk; the hash holds the ordinal, so repeated text in one source is kept.
    insert into public.brain_episodes (fund_id, kind, brain_source_id, trust_tier, occurred_at,
                                       title, content, content_hash)
    values (_fund_id, 'source_chunk', _source_id, v_source.trust_tier,
            v_source.period_end::timestamptz,
            coalesce(nullif(v_chunk ->> 'heading', ''), v_source.title),
            v_chunk ->> 'content',
            md5((v_chunk ->> 'ordinal') || ':' || (v_chunk ->> 'content')))
    on conflict (fund_id, ref_table, ref_id, brain_source_id, content_hash) do nothing
    returning id into v_episode;
    if v_episode is null then continue; end if;

    insert into public.brain_chunks (fund_id, episode_id, ordinal, heading, page_from, page_to,
                                     content, token_count)
    values (_fund_id, v_episode, (v_chunk ->> 'ordinal')::int,
            nullif(v_chunk ->> 'heading', ''),
            nullif(v_chunk ->> 'pageFrom', '')::int,
            nullif(v_chunk ->> 'pageTo', '')::int,
            v_chunk ->> 'content',
            (v_chunk ->> 'tokenCount')::int);

    insert into public.brain_log (fund_id, actor, action, object_kind, object_id, after)
    values (_fund_id, 'INGEST', 'insert', 'episode', v_episode,
            jsonb_build_object('source_id', _source_id, 'ordinal', (v_chunk ->> 'ordinal')::int));
    v_inserted := v_inserted + 1;
  end loop;
  return v_inserted;
end;
$$;

revoke all on function public.brain_ingest_store_chunks(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.brain_ingest_store_chunks(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. De af kildens chunks, der endnu mangler embedding (INGEST "embed", kan genoptages)
-- ---------------------------------------------------------------------------
create or replace function public.brain_source_pending_chunks(
  _fund_id uuid,
  _source_id uuid,
  _limit int default 100
)
returns table (chunk_id uuid, content text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.content
  from public.brain_chunks c
  join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
  where c.fund_id = _fund_id
    and e.brain_source_id = _source_id
    and c.embedding is null
  order by c.ordinal, c.id
  limit least(greatest(coalesce(_limit, 100), 1), 200)
$$;

revoke all on function public.brain_source_pending_chunks(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.brain_source_pending_chunks(uuid, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Ryd en kildes chunks og episoder (når udtrækket har ændret sig, se chunk_signature)
-- ---------------------------------------------------------------------------
create or replace function public.brain_ingest_clear_chunks(_fund_id uuid, _source_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  if _fund_id is null or _source_id is null then
    raise exception 'brain_ingest_clear_chunks: fund and source are required';
  end if;
  perform 1 from public.brain_sources s
   where s.id = _source_id and s.fund_id = _fund_id
   for update;
  if not found then
    raise exception 'brain_ingest_clear_chunks: unknown source' using errcode = 'P0002';
  end if;
  -- Chunks and fact links follow by cascade; a fact that loses its last source expires and loses
  -- its wording (0052).
  delete from public.brain_episodes e
   where e.fund_id = _fund_id and e.brain_source_id = _source_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.brain_ingest_clear_chunks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.brain_ingest_clear_chunks(uuid, uuid) to service_role;
