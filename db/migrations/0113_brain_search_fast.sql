-- Brain-søgningen svarer hurtigt, også ved 40.000 tekststykker (fundet).
--
-- Målt med `npm run capacity` og `EXPLAIN (ANALYZE)` inde fra
-- funktionerne, som medlem og som service-rolle (appen):
--   a. Som medlem kørte rækkeniveau-sikkerheden (`is_fund_member` pr. række) på hvert stykke og
--      hver episode, og tekstindekset kunne slet ikke bruges, fordi `@@` ikke er leakproof og
--      derfor ikke må køre før RLS-tjekket: ca. 1 s, også når intet blev fundet.
--   b. Som service-rolle rangerede tekstsøgningen alle stykker, der indeholder blot ét af
--      spørgsmålets ord. Appen sætter ordene sammen med "or" (ftsQuery), så et almindeligt ord
--      ("marked") rammer næsten hele fondens tekst: 39.987 af 40.000 rækker og 745 ms.
--   c. Fakta-søgningen rangerede også alle match, og udtryksindekset fra 0042 hjalp ikke på
--      rangeringen: `to_tsvector` blev regnet igen for hvert match.
--   d. Søgning på én case gik gennem hele fondens vektorindeks og filtrerede bagefter.
--   e. Vektorsøgningen i fakta læste alle 30.000 fakta (224–276 ms) i stedet for HNSW-indekset:
--      planlæggeren regner ikke med prisen for at hente vektorerne (TOAST) og afstanden.
--
-- Rettelser:
--   1. De tre søgefunktioner er `security definer`. Første linje afviser stadig alle andre end
--      fondens aktive medlemmer og service-rollen, og hver forespørgsel er låst til `_fund_id`,
--      så RLS's tjek pr. række gav intet ekstra, kun ventetid.
--   2. `private.brain_fts_focus`: et ord, som mange tusinde rækker indeholder, siger intet om,
--      hvilken række der er relevant, men koster at rangere. De almindeligste ord tages ud af
--      tekstsøgningen, så længe de sjældne ord tilsammen anslås at ramme højst 2.000 rækker
--      (planlæggerens statistik, `pg_stats.most_common_elems`). Vektorsøgningen dækker stadig
--      spørgsmålets mening. Er selv det sjældneste ord almindeligt, giver tekstlisten intet
--      (før blev de første 2.000 match i tabellens rækkefølge rangeret, dvs. de ældste).
--   3. Sikkerhedsnet: højst 2.000 kandidater rangeres pr. tekstliste. De tages i tilfældig
--      rækkefølge, så nettet bør kun nås ved et spørgsmål, der ikke er et rent "eller" (appen
--      sender altid "eller"), eller når statistikken tager fejl.
--   4. `brain_facts.fts` (gemt, genereret) med GIN-indeks erstatter udtryksindekset fra 0042
--      (samme navn, `brain_facts_fts_idx`), som `brain_chunks.fts`.
--   5. Søgning på én case læser casens egne stykker og rangerer dem præcist (få rækker).
--   6. Faktas vektoropslag i en stor fond (over 2.000 fakta med vektor) ligger i
--      `private.brain_facts_nearest` med `enable_sort = off`: så er HNSW-indekset den eneste plan
--      uden en sortering af alle fakta. Indstillingen gælder kun i den funktion; uden indeks kører
--      opslaget stadig, bare som før. En lille fond og søgning på ét subjekt (L1) rangeres præcist.
-- Funktionernes signatur og svar er uændrede; tekstlisten er tom for et spørgsmål af kun
-- almindelige ord.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Fakta får et søgbart tekstfelt (samme sprog som før: dansk).
-- ---------------------------------------------------------------------------
-- Det gamle udtryksindeks (0042) fjernes først, så omskrivningen af tabellen ikke bygger det
-- igen; det nye har samme navn og ligger på kolonnen.
drop index if exists public.brain_facts_fts_idx;
alter table public.brain_facts
  add column if not exists fts tsvector
  generated always as (to_tsvector('danish'::regconfig, statement)) stored;
create index brain_facts_fts_idx on public.brain_facts using gin (fts);
-- Statistik for den nye kolonne med det samme (punkt 2 læser den).
analyze public.brain_facts (fts);

-- ---------------------------------------------------------------------------
-- 2. De sjældne ord i et tekstspørgsmål.
--    Kun et rent "eller" af ord (det, ftsQuery sender) fokuseres; alt andet (og, ikke, fraser),
--    en tabel uden statistik eller under _budget rækker kommer uændret tilbage. Er selv det
--    sjældneste ord over budgettet, kommer null tilbage: ingen tekstliste. Statistikken er hele
--    installationens (normalt én kunde); funktionen giver kun ord fra spørgsmålet selv tilbage.
-- ---------------------------------------------------------------------------
create or replace function private.brain_fts_focus(
  _tsq tsquery,
  _table text,
  _budget int default 2000
)
returns tsquery
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text := _tsq::text;
  v_elems text[];
  v_freqs real[];
  v_rows real;
  v_kept text[] := '{}';
  v_sum real := 0;
  v_term record;
begin
  if _tsq is null
     or _table not in ('brain_chunks', 'brain_facts')
     or v_text !~ '^''(?:[^'']|'''')*''(?: \| ''(?:[^'']|'''')*'')*$' then
    return _tsq;
  end if;

  select s.most_common_elems::text::text[], s.most_common_elem_freqs, greatest(c.reltuples, 0)
    into v_elems, v_freqs, v_rows
  from pg_catalog.pg_stats s
  join pg_catalog.pg_class c
    on c.relname = s.tablename and c.relnamespace = 'public'::regnamespace
  where s.schemaname = 'public' and s.tablename = _table and s.attname = 'fts';

  if v_elems is null or v_rows <= _budget then
    return _tsq;
  end if;

  -- Rarest first. A word that is not among the most common has a frequency below the last
  -- one listed, so it counts as rare.
  for v_term in
    select t.token, coalesce(v_freqs[array_position(v_elems, t.lexeme)], 0) as freq
    from (
      select distinct m[1] as token,
             replace(replace(substr(m[1], 2, length(m[1]) - 2), '''''', ''''), '\\', '\') as lexeme
      from regexp_matches(v_text, '''(?:[^'']|'''')*''', 'g') as m
    ) t
    order by freq, t.token
  loop
    exit when v_sum + v_term.freq * v_rows > _budget;
    v_kept := v_kept || v_term.token;
    v_sum := v_sum + v_term.freq * v_rows;
  end loop;

  if cardinality(v_kept) = 0 then
    return null;  -- only common words: no full-text list (the vector list carries the meaning)
  end if;
  return array_to_string(v_kept, ' | ')::tsquery;
end;
$$;

revoke all on function private.brain_fts_focus(tsquery, text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tekststykker.
-- ---------------------------------------------------------------------------
create or replace function public.brain_search_chunks(
  _fund_id uuid,
  _query text default null,
  _query_embedding vector(1536) default null,
  _case_id uuid default null,
  _kinds text[] default null,
  _limit int default 40
)
returns table (chunk_id uuid, episode_id uuid, list text, rank int, score double precision)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(_limit, 40), 1), 100);
  v_tsq tsquery;
  v_focus tsquery;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if _query is not null and btrim(_query) <> '' then
    v_tsq := websearch_to_tsquery('danish'::regconfig, left(_query, 1000))
          || websearch_to_tsquery('english'::regconfig, left(_query, 1000));
  end if;

  -- One case: its own pieces are few, so both lists are ranked exactly on them.
  if _case_id is not null then
    return query
      with mine as materialized (
        select c.id, c.episode_id, c.fts, c.embedding
        from public.brain_episodes e
        join public.brain_chunks c on c.episode_id = e.id and c.fund_id = e.fund_id
        where e.fund_id = _fund_id
          and e.case_id = _case_id
          and e.superseded_at is null
          and (_kinds is null or e.kind = any(_kinds))
      ),
      by_text as (
        select m.id, m.episode_id, ts_rank_cd(m.fts, v_tsq) as r
        from mine m
        where v_tsq is not null and m.fts @@ v_tsq
        order by r desc, m.id
        limit v_limit
      ),
      by_vector as (
        select m.id, m.episode_id, m.embedding operator(public.<=>) _query_embedding as d
        from mine m
        where _query_embedding is not null and m.embedding is not null
        order by d, m.id
        limit v_limit
      )
      select t.id, t.episode_id, 'fts'::text,
             (row_number() over (order by t.r desc, t.id))::int, t.r::double precision
      from by_text t
      union all
      select v.id, v.episode_id, 'vector'::text,
             (row_number() over (order by v.d, v.id))::int, (1 - v.d)::double precision
      from by_vector v;
    return;
  end if;

  v_focus := private.brain_fts_focus(v_tsq, 'brain_chunks');
  if v_focus is not null then
    return query
      select s.id, s.episode_id, 'fts'::text,
             (row_number() over (order by s.r desc, s.id))::int,
             s.r::double precision
      from (
        select k.id, k.episode_id, ts_rank_cd(k.fts, v_focus) as r
        from (
          -- Safety net, see 3 in the header.
          select c.id, c.episode_id, c.fts
          from public.brain_chunks c
          join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
          where c.fund_id = _fund_id
            and c.fts @@ v_focus
            and e.superseded_at is null
            and (_kinds is null or e.kind = any(_kinds))
          limit 2000
        ) k
        order by r desc, k.id
        limit v_limit
      ) s;
  end if;

  if _query_embedding is not null then
    perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
    perform set_config('hnsw.ef_search', '100', true);
    return query
      select s.id, s.episode_id, 'vector'::text,
             (row_number() over (order by s.d, s.id))::int,
             (1 - s.d)::double precision
      from (
        select c.id, c.episode_id, c.embedding operator(public.<=>) _query_embedding as d
        from public.brain_chunks c
        join public.brain_episodes e on e.id = c.episode_id and e.fund_id = c.fund_id
        where c.fund_id = _fund_id
          and c.embedding is not null
          and e.superseded_at is null
          and (_kinds is null or e.kind = any(_kinds))
        order by c.embedding operator(public.<=>) _query_embedding
        limit v_limit
      ) s;
  end if;
end;
$$;

revoke all on function public.brain_search_chunks(uuid, text, vector, uuid, text[], int)
  from public, anon;
grant execute on function public.brain_search_chunks(uuid, text, vector, uuid, text[], int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Fakta.
--    Faktas nærmeste efter vektor i hele fonden. `enable_sort = off` gælder kun her: HNSW-indekset
--    giver rækkerne i afstandsorden, så det er den eneste plan uden en sortering af alle fakta
--    (planlæggeren valgte ellers at læse og sortere alle fakta, se e i toppen). Kun databasen
--    selv kalder den (fra brain_search_facts, efter adgangstjekket).
-- ---------------------------------------------------------------------------
create or replace function private.brain_facts_nearest(
  _fund_id uuid,
  _query_embedding vector(1536),
  _at date,
  _valid_at date,
  _limit int
)
returns table (fact_id uuid, d double precision)
language sql
stable
set search_path = ''
set enable_sort = off
as $$
  select f.id, f.embedding operator(public.<=>) _query_embedding
  from public.brain_facts f
  where f.fund_id = _fund_id
    and f.embedding is not null
    and f.status = 'active'
    and f.expired_at is null
    and (f.valid_to is null or f.valid_to >= _at)
    and (_valid_at is null or f.valid_from is null or f.valid_from <= _valid_at)
  order by f.embedding operator(public.<=>) _query_embedding
  limit _limit
$$;

revoke all on function private.brain_facts_nearest(uuid, vector, date, date, int)
  from public, anon, authenticated;

create or replace function public.brain_search_facts(
  _fund_id uuid,
  _query text default null,
  _query_embedding vector(1536) default null,
  _valid_at date default null,
  _subject_ids uuid[] default null,
  _limit int default 40
)
returns table (fact_id uuid, list text, rank int, score double precision)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(_limit, 40), 1), 100);
  v_at date := coalesce(_valid_at, current_date);
  v_tsq tsquery;
  v_small boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if _query is not null and btrim(_query) <> '' then
    v_tsq := private.brain_fts_focus(
      websearch_to_tsquery('danish'::regconfig, left(_query, 1000)), 'brain_facts');
  end if;

  if v_tsq is not null then
    return query
      select s.id, 'fts'::text, (row_number() over (order by s.r desc, s.id))::int,
             s.r::double precision
      from (
        select k.id, ts_rank_cd(k.fts, v_tsq) as r
        from (
          -- Safety net, see 3 in the header.
          select f.id, f.fts
          from public.brain_facts f
          where f.fund_id = _fund_id
            and f.status = 'active'
            and f.expired_at is null
            and (f.valid_to is null or f.valid_to >= v_at)
            and (_valid_at is null or f.valid_from is null or f.valid_from <= _valid_at)
            and (_subject_ids is null or f.subject_id = any(_subject_ids))
            and f.fts @@ v_tsq
          limit 2000
        ) k
        order by r desc, k.id
        limit v_limit
      ) s;
  end if;

  if _query_embedding is null then
    return;
  end if;

  -- A few subjects (L1 checks one subject's facts) or a small fund: the facts are few, so they
  -- are ranked exactly. The index is for large funds; for a small fund in a shared table it
  -- would first have to step over the other funds' facts.
  v_small := _subject_ids is not null or (
    select count(*) <= 2000
    from (
      select 1 from public.brain_facts f
      where f.fund_id = _fund_id and f.embedding is not null and f.expired_at is null
      limit 2001
    ) c
  );
  if v_small then
    return query
      select s.id, 'vector'::text, (row_number() over (order by s.d, s.id))::int,
             (1 - s.d)::double precision
      from (
        select m.id, m.embedding operator(public.<=>) _query_embedding as d
        from (
          select f.id, f.embedding
          from public.brain_facts f
          where f.fund_id = _fund_id
            and (_subject_ids is null or f.subject_id = any(_subject_ids))
            and f.embedding is not null
            and f.status = 'active'
            and f.expired_at is null
            and (f.valid_to is null or f.valid_to >= v_at)
            and (_valid_at is null or f.valid_from is null or f.valid_from <= _valid_at)
          offset 0  -- keeps the planner from walking the whole index instead
        ) m
        order by d, m.id
        limit v_limit
      ) s;
    return;
  end if;

  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);
  return query
    select n.fact_id, 'vector'::text, (row_number() over (order by n.d, n.fact_id))::int,
           (1 - n.d)::double precision
    from private.brain_facts_nearest(_fund_id, _query_embedding, v_at, _valid_at, v_limit) n;
end;
$$;

revoke all on function public.brain_search_facts(uuid, text, vector, date, uuid[], int)
  from public, anon;
grant execute on function public.brain_search_facts(uuid, text, vector, date, uuid[], int)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Entiteter: samme indhold, kun uden RLS's tjek pr. række.
-- ---------------------------------------------------------------------------
alter function public.brain_search_entities(uuid, text, vector, text[], int) security definer;

commit;
