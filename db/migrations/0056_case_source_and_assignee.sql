-- 0056 · Kilde og ansvarlig på casen ("Kilde, ansvarlig og note", "Tilgang").
--
-- cases.source_kind  hvor casen kom fra: inbound · network · event · outbound · co_investor
--                    (tom = ikke angivet; ældre cases har ingen). primary_origin (manual/pitch_deck/
--                    scanner) er noget andet og røres ikke.
-- cases.assigned_to  findes fra 0004 og bruges som "Ansvarlig". Ny regel: når feltet sættes eller
--                    ændres, skal værdien være aktivt medlem af casens fond (trigger, samme regel og
--                    fejlkode IL001 som opgavernes ansvarlige, 0034/0039). Eksisterende rækker røres
--                    ikke.
--
-- Brugere skriver ikke direkte i cases: ændringer sker kun gennem serveren, her
-- set_case_origin (kun service_role); serveren tjekker rettigheden. Rettigheder og RLS er uændrede.
-- Additiv og bagudkompatibel.

alter table public.cases
  add column source_kind text
    check (source_kind is null or source_kind in ('inbound', 'network', 'event', 'outbound', 'co_investor'));

create or replace function public.cases_check_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not public.is_fund_member(new.assigned_to, new.fund_id) then
    raise exception 'Den ansvarlige er ikke medlem af investeringstesen.' using errcode = 'IL001';
  end if;
  return new;
end;
$$;

revoke all on function public.cases_check_assignee() from public, anon, authenticated;

create trigger cases_check_assignee
  before insert or update of assigned_to on public.cases
  for each row execute function public.cases_check_assignee();

-- Sets both fields (null clears one). A caller who changes only one passes the other's current value.
create or replace function public.set_case_origin(
  _case_id uuid,
  _source_kind text,
  _assigned_to uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cases
     set source_kind = _source_kind,
         assigned_to = _assigned_to,
         last_action_at = greatest(last_action_at, now())
   where id = _case_id;
  if not found then
    raise exception 'Casen findes ikke.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_case_origin(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_case_origin(uuid, text, uuid) to service_role;
