-- PAP Intelligence - modern PowerPoint intake alongside PDF pitch decks.
-- Run after 0005_m8_scanner.sql.

begin;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'pitch-decks';

drop policy if exists "pitch_decks_storage_insert_team" on storage.objects;
create policy "pitch_decks_storage_insert_team" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pitch-decks'
  and lower(storage.extension(name)) in ('pdf', 'pptx')
  and public.is_fund_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  and (
    public.has_fund_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'analyst')
    or public.has_fund_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'partner')
    or public.has_fund_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'administrator')
  )
);

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

  v_extension := lower(split_part(_storage_path, '.', array_length(string_to_array(_storage_path, '.'), 1)));
  if split_part(_storage_path, '/', 1) <> v_fund_id::text
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
grant execute on function public.register_pitch_deck(uuid, text, text, text, bigint) to authenticated, service_role;

commit;
