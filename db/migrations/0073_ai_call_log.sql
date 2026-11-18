-- 0073 · AI-log (platform): én række pr. AI-kald.
--
-- Hvert kald gennem src/lib/ai/model-call.ts skriver tid, flow, model, udbyder, region, ZDR,
-- tokens, pris, antal maskerede værdier og den payload, der blev sendt (den maskerede). Kun
-- service-rollen kan læse og skrive tabellen; der er ingen skærm i appen. Udtræk sker på
-- anmodning med scripts/export-ai-log.ts.
--
-- Opbevaring: payloaden slettes efter 90 dage, metadata bliver. Oprydningen kører
-- efter hver skrivning (som ai_release_stale i 0071) og desuden fra den natlige cron, så den også
-- sker, når en fond ikke bruger AI.
-- "Glem person" fjerner payloads, der nævner personen (ai_call_log_forget). Sletning af fonden
-- tager rækkerne med (on delete cascade).
--
-- Additiv: ingen eksisterende tabel, funktion eller grant ændres.

create table public.ai_call_log (
  id bigserial primary key,
  fund_id uuid not null references public.funds(id) on delete cascade,
  created_at timestamptz not null default now(),
  flow text not null check (flow ~ '^[a-z0-9_]{2,40}$'),
  model text not null,
  provider text,
  region text,
  -- Det, Gateway melder at have slået til; uden svar (fejlet kald) det, der blev bedt om.
  zdr boolean not null,
  status text not null check (status in ('ok', 'failed')),
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric check (cost_usd is null or cost_usd >= 0),
  -- Antal forskellige maskerede værdier pr. slags (person, email …), aldrig værdierne; tæller for
  -- hele chat-turen eller L1-batchet, som kaldet hører til.
  masked jsonb not null default '{}'::jsonb,
  -- Filer gemmes aldrig, kun deres type og størrelse; en payload over 1 mio. tegn er afkortet.
  payload jsonb,
  payload_removed_at timestamptz,
  generation_id text,
  check ((payload is null) or (payload_removed_at is null))
);

create index ai_call_log_fund_idx on public.ai_call_log (fund_id, created_at);
create index ai_call_log_payload_age_idx on public.ai_call_log (created_at)
  where payload is not null;

alter table public.ai_call_log enable row level security;
-- Ingen policies: kun service-rollen (som går uden om RLS) kommer til.
revoke all on public.ai_call_log from public, anon, authenticated;
revoke all on sequence public.ai_call_log_id_seq from public, anon, authenticated;
grant all on public.ai_call_log to service_role;
grant usage, select on sequence public.ai_call_log_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 90 dage: payloaden slettes, metadata bliver.
-- ---------------------------------------------------------------------------
create or replace function public.ai_call_log_purge(_now timestamptz default now())
returns integer
language sql
security definer
set search_path = ''
as $$
  with removed as (
    update public.ai_call_log
       set payload = null, payload_removed_at = _now
     where payload is not null
       and created_at < _now - interval '90 days'
    returning 1
  )
  select count(*)::int from removed;
$$;

create or replace function public.ai_call_log_purge_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ai_call_log_purge();
  return null;
end;
$$;

create trigger ai_call_log_purge
  after insert on public.ai_call_log
  for each statement
  execute function public.ai_call_log_purge_after_insert();

-- ---------------------------------------------------------------------------
-- Glem person: payloads i fonden, der nævner et af personens navne, slettes (metadata bliver).
-- Samme ordgrænser som 0072 (gdpr_term_pattern og gdpr_json_terms): "Per" rammer ikke "super",
-- et navn med dobbelt mellemrum findes, og et navn med anførselstegn findes i JSON-formen.
-- ---------------------------------------------------------------------------
create or replace function public.ai_call_log_forget(_fund_id uuid, _terms text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _pattern text := public.gdpr_term_pattern(public.gdpr_json_terms(coalesce(_terms, '{}'::text[])));
  _removed integer;
begin
  if _pattern is null then
    return 0;
  end if;
  update public.ai_call_log l
     set payload = null, payload_removed_at = now()
   where l.fund_id = _fund_id
     and l.payload is not null
     and l.payload::text ~* _pattern;
  get diagnostics _removed = row_count;
  return _removed;
end;
$$;

revoke all on function public.ai_call_log_purge(timestamptz) from public, anon, authenticated;
revoke all on function public.ai_call_log_purge_after_insert() from public, anon, authenticated;
revoke all on function public.ai_call_log_forget(uuid, text[]) from public, anon, authenticated;
grant execute on function public.ai_call_log_purge(timestamptz) to service_role;
grant execute on function public.ai_call_log_forget(uuid, text[]) to service_role;
