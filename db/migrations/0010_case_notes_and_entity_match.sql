-- Team-visible notes on a case, and a calibrated "suggested match, not
-- confirmed" marker for sources whose identity match to the case's company
-- is below a lenient confidence threshold. Neither feature blocks screening.

begin;

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index case_notes_case_idx on public.case_notes(case_id, created_at desc);

grant select, insert on public.case_notes to authenticated;
grant all on public.case_notes to service_role;

alter table public.case_notes enable row level security;

create policy "case_notes_select_member" on public.case_notes
for select to authenticated
using (public.is_fund_member(auth.uid(), fund_id));

-- Notes are append-only: any analyst, partner or administrator can add one,
-- but never edit or remove another member's note.
create policy "case_notes_insert_team" on public.case_notes
for insert to authenticated
with check (
  author_id = auth.uid()
  and public.is_fund_member(auth.uid(), fund_id)
  and (
    public.has_fund_role(auth.uid(), fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), fund_id, 'partner')
    or public.has_fund_role(auth.uid(), fund_id, 'administrator')
  )
);

-- Entity-match confidence: separate from evidence_items.confidence, which is
-- about whether a CLAIM is true. This is about whether a discovered SOURCE
-- is actually about the right company. Lenient by design — it flags, it
-- never blocks. Default 'confirmed' keeps every existing row unaffected.
alter table public.sources
  add column entity_match_confidence numeric
    check (entity_match_confidence is null or entity_match_confidence between 0 and 1),
  add column entity_match_status text not null default 'confirmed'
    check (entity_match_status in ('confirmed', 'suggested', 'unconfirmed'));

commit;
