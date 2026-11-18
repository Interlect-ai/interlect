-- 0109 · Gemte øjebliksbilleder af demoteamet ("Nulstil demo").
--
-- Workflowet "Demo" (.github/workflows/demo.yml, scripts) gemmer hver række i det
-- engelske demoteam "Interlect Demo" som JSON her, i samme database, så data aldrig forlader den.
-- "Nulstil demo" fortryder et kundemøde: det, mødet har tilføjet, slettes, det, det har slettet
-- eller ændret, sættes tilbage, med alle produktets triggere og vagter aktive. Logs, kreditter og
-- revisionsloggen røres aldrig.
--
-- Ingen fremmednøgle til funds: et billede skal kunne overleve, at teamet slettes.
-- Kun databasens ejer (scripts med DATABASE_URL) læser og skriver tabellen: ingen API-rolle har
-- adgang, og RLS er slået til uden policies. Tom på en kundes installation.

begin;

set local lock_timeout = '5s';

create table if not exists private.demo_snapshots (
  id bigint generated always as identity primary key,
  fund_id uuid not null,
  taken_at timestamptz not null default now(),
  -- Den seneste migration, da billedet blev taget (schema_migrations).
  schema_version text not null,
  -- Antal rækker pr. tabel, til loggen og til tjekket efter en nulstilling.
  row_counts jsonb not null,
  -- Tabelnavn → rækkerne som to_jsonb (alle kolonner, også embeddings).
  tables jsonb not null,
  -- Filerne i teamets mapper i lageret som "<bucket>/<fund_id>/…" (pitch-decks, brain-sources),
  -- kopieret til "<bucket>/_demo-snapshot/<id>/…"; først når kopierne findes, er billedet klar.
  files jsonb not null default '[]'::jsonb,
  ready boolean not null default false
);

create index if not exists demo_snapshots_fund_idx
  on private.demo_snapshots (fund_id, taken_at desc);

alter table private.demo_snapshots enable row level security;
revoke all on private.demo_snapshots from public, anon, authenticated, service_role;

commit;
