-- 0121 · Glem tømmer demo-øjebliksbilleder, og deck-lagerets politik fejler ikke på fremmede stier
-- (slut-/harden 21. okt).
--
-- `private.demo_snapshots` (0109) gemmer alle rækker i "Interlect Demo", også `people` og
-- Brain-tekst. "Glem person" (`gdpr_forget_person_raw`) maskerer teamets rækker, men ikke
-- billedet, så "Nulstil demo" kunne sætte en glemt person tilbage. Nu tømmer glemsel billedet:
-- teamets øjebliksbilleder får ingen rækker og er ikke klar (fillisten bliver stående, så filkopierne i lageret kan findes; de fjernes først, når næste billede tages) (næste "Nulstil demo"
-- siger, at der skal tages et nyt, og det næste billede rydder de tomme og deres filkopier væk).
-- Samme fremgangsmåde som at maskere i billedet ville kræve en JSON-gennemgang af alle tabeller;
-- et tomt billede er enklere og kan ikke glemme noget. Funktionen flyttes til `private` og
-- pakkes ind i en funktion med samme navn og rettigheder, så alle kaldere er uændrede.
--
-- Filerne i `pitch-decks/_demo-snapshot/<id>/…` (0109) har ikke et uuid som første mappe;
-- `((storage.foldername(name))[1])::uuid` i bucket'ens politikker fejlede med "invalid input
-- syntax for type uuid" ved en liste fra browseren (intet blev læst). Politikkerne tjekker nu
-- formen, før de caster (rollerne hedder siden 0032 member, lead og admin; de gamle navne i 0006
-- står i politikken som de omdøbte værdier). Samme betingelser og navne som før, så intet nyt kan læses eller skrives.

begin;
set local lock_timeout = '5s';

alter function public.gdpr_forget_person_raw(uuid, uuid, text[]) set schema private;
alter function private.gdpr_forget_person_raw(uuid, uuid, text[]) rename to gdpr_forget_person_raw_core;
revoke all on function private.gdpr_forget_person_raw_core(uuid, uuid, text[])
  from public, anon, authenticated, service_role;

create or replace function public.gdpr_forget_person_raw(
  _fund_id uuid,
  _person_id uuid,
  _terms text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.demo_snapshots
     set tables = '{}'::jsonb, row_counts = '{}'::jsonb, ready = false
   where fund_id = _fund_id;
  return private.gdpr_forget_person_raw_core(_fund_id, _person_id, _terms);
end;
$$;

revoke all on function public.gdpr_forget_person_raw(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.gdpr_forget_person_raw(uuid, uuid, text[]) to service_role;

create or replace function private.storage_fund_folder(_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when (storage.foldername(_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(_name))[1])::uuid
  end;
$$;

revoke all on function private.storage_fund_folder(text) from public;
grant execute on function private.storage_fund_folder(text) to authenticated, service_role;

drop policy if exists "pitch_decks_storage_select_member" on storage.objects;
create policy "pitch_decks_storage_select_member" on storage.objects
for select to authenticated
using (
  bucket_id = 'pitch-decks'
  and public.is_fund_member(auth.uid(), private.storage_fund_folder(name))
);

drop policy if exists "pitch_decks_storage_insert_team" on storage.objects;
create policy "pitch_decks_storage_insert_team" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pitch-decks'
  and lower(storage.extension(name)) in ('pdf', 'pptx')
  and public.is_fund_member(auth.uid(), private.storage_fund_folder(name))
  and (
    public.has_fund_role(auth.uid(), private.storage_fund_folder(name), 'member')
    or public.has_fund_role(auth.uid(), private.storage_fund_folder(name), 'lead')
    or public.has_fund_role(auth.uid(), private.storage_fund_folder(name), 'admin')
  )
);

commit;
