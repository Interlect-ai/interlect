-- 0100 · Filstier kan ikke forlade fondens og casens mapper (midtvejs-/harden).
--
-- `register_pitch_deck` tjekkede kun stiens to første led med `split_part` og filtypen, så
-- `A/<case>/../../B/<case>/<id>-x.pdf` slap igennem; lageret normaliserer stien, og serveren
-- henter eller signerer filen med service-nøglen, dvs. et andet teams fil. Nu afvises enhver sti
-- med et tomt led, et `.`- eller `..`-led, eller tegnene `%`, `\`, `?`, `#` og kontroltegn (samme
-- regel som `isSafeStoragePath` i `src/lib/security/storage-path.ts`), både i funktionen og som
-- check-constraint på `documents.storage_path`, der også kræver fondens egen mappe først.
--
-- Constraintet lægges `not valid` (gælder for alle nye og ændrede rækker) og valideres med det
-- samme, når de eksisterende rækker overholder det; ellers står en advarsel i migrationsloggen,
-- og rækkerne skal ses igennem (en sådan række ville være et forsøg på netop dette snyd).

begin;
set local lock_timeout = '5s';

create or replace function public.is_safe_storage_path(_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select _path is not null
     and char_length(_path) between 1 and 1000
     and _path !~ '[\\%?#[:cntrl:]]'
     and _path !~ '(^|/)\.{0,2}(/|$)';
$$;

comment on function public.is_safe_storage_path(text) is
  'En brugerstis led kan ikke forlade mappen: intet tomt, "." eller ".." led og ingen %, \, ?, # eller kontroltegn (T-862).';

grant execute on function public.is_safe_storage_path(text) to authenticated, service_role;

alter table public.documents drop constraint if exists documents_storage_path_safe;
alter table public.documents
  add constraint documents_storage_path_safe
  check (
    public.is_safe_storage_path(storage_path)
    and split_part(storage_path, '/', 1) = fund_id::text
  ) not valid;

do $$
begin
  if exists (
    select 1 from public.documents
     where not (public.is_safe_storage_path(storage_path)
                and split_part(storage_path, '/', 1) = fund_id::text)
  ) then
    raise warning 'documents_storage_path_safe: eksisterende rækker overholder ikke reglen; constraintet gælder kun nye og ændrede rækker, til de er set igennem (T-862).';
  else
    alter table public.documents validate constraint documents_storage_path_safe;
  end if;
end;
$$;

create or replace function public.register_pitch_deck(
  _case_id uuid,
  _file_name text,
  _storage_path text,
  _mime_type text,
  _size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fund_id uuid;
  v_document_id uuid;
  v_extension text;
begin
  select fund_id into v_fund_id from public.cases where id = _case_id;
  if v_fund_id is null or not public.is_fund_member(auth.uid(), v_fund_id) then
    raise exception 'Casen blev ikke fundet.';
  end if;
  -- Læser har ikke upload_document (rettighedsmatricen, R-3 §2).
  if not (
    public.has_fund_role(auth.uid(), v_fund_id, 'admin')
    or public.has_fund_role(auth.uid(), v_fund_id, 'lead')
    or public.has_fund_role(auth.uid(), v_fund_id, 'member')
  ) then
    raise exception 'Din rolle kan ikke uploade dokumenter.' using errcode = '42501';
  end if;

  -- Præcis tre led: fond/case/fil, og ingen led, der kan forlade mappen (T-862).
  v_extension := lower(split_part(_storage_path, '.', array_length(string_to_array(_storage_path, '.'), 1)));
  if not public.is_safe_storage_path(_storage_path)
     or array_length(string_to_array(_storage_path, '/'), 1) <> 3
     or split_part(_storage_path, '/', 1) <> v_fund_id::text
     or split_part(_storage_path, '/', 2) <> _case_id::text
     or v_extension not in ('pdf', 'pptx') then
    raise exception 'Ugyldig filsti.';
  end if;
  if _mime_type not in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) or _size_bytes <= 0 or _size_bytes > 52428800 then
    raise exception 'Kun PDF- og PPTX-filer op til 50 MB accepteres.';
  end if;

  insert into public.documents
    (fund_id, case_id, kind, file_name, storage_path, mime_type, size_bytes, uploaded_by)
  values
    (v_fund_id, _case_id, 'pitch_deck', trim(_file_name), _storage_path, _mime_type, _size_bytes, auth.uid())
  returning id into v_document_id;
  insert into public.pitch_decks (document_id, fund_id, case_id)
  values (v_document_id, v_fund_id, _case_id);
  insert into public.case_origins (fund_id, case_id, source, is_primary, source_reference, created_by)
  values (v_fund_id, _case_id, 'pitch_deck', false, v_document_id::text, auth.uid())
  on conflict do nothing;
  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (v_fund_id, 'user', auth.uid(), 'pitch_deck_uploaded', 'documents', v_document_id,
    jsonb_build_object('case_id', _case_id, 'file_name', trim(_file_name), 'mime_type', _mime_type));
  return v_document_id;
end;
$$;

revoke all on function public.register_pitch_deck(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.register_pitch_deck(uuid, text, text, text, bigint)
  to authenticated, service_role;

commit;
