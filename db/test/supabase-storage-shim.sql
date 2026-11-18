-- Kun til lokale tests (scripts/local-db.mjs). Aldrig en migration.
--
-- I en rigtig Supabase-installation opretter Storage-tjenesten selv skemaet
-- storage (buckets, objects og hjælpefunktionerne). Billedet supabase/postgres
-- indeholder kun databasen, så de dele migrationerne bruger, efterlignes her med
-- samme navne, kolonner og funktionskroppe som Supabase Storage.
-- Køres som supabase_admin (billedets ejer af skemaet storage) af scripts/local-db.mjs.

begin;

set local client_min_messages = warning;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  user_metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text)
returns text
language plpgsql
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

-- Migrationerne kører som postgres og opretter policies på storage.objects, som
-- de kan i et rigtigt Supabase-projekt; det kræver, at postgres ejer tabellerne her.
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;

grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to authenticated, service_role;
grant select on storage.buckets, storage.objects to anon;

commit;
