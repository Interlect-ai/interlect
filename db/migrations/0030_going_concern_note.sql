-- Opsamling (finans): om årsrapporten har en note om væsentlig usikkerhed om fortsat drift
-- (going concern, XBRL fsa:DisclosureOfUncertaintiesRelatingToGoingConcern). Parseren læser
-- det allerede; nu gemmes det pr. regnskabsår, så finans-gaten "Ingen going concern-note"
-- kan regnes i kode. null = ukendt (ældre rækker og år, der kun kendes fra et senere
-- regnskabs sammenligningstal); en ukendt værdi er aldrig et brud.
--
-- Regnskaber må kun komme fra Erhvervsstyrelsen via serveren (service-rollen). Appen skriver
-- dem aldrig som bruger, men databasen tillod et teammedlem at indsætte og slette regnskaber
-- og linjer direkte i sin egen fond; så kunne kode-gates og kode-scoren regnes på forfalskede
-- tal. De skrive-regler fjernes; læsning følger tabellernes eksisterende RLS.

begin;

alter table public.financial_statements
  add column going_concern_note boolean;

drop policy financial_statements_insert_team on public.financial_statements;
drop policy financial_statements_delete_team on public.financial_statements;
drop policy financial_statement_line_items_insert_team on public.financial_statement_line_items;
revoke insert, update, delete on public.financial_statements from authenticated;
revoke insert, update, delete on public.financial_statement_line_items from authenticated;

commit;
