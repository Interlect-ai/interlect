-- 0078 · Brain-feedback kan kun læses af den, der gav den, platform.
--
--   * brain_feedback_select (0047) lod alle, der kan se en besked, læse alle brugeres vurderinger
--     af den. Siden har rækkerne fri tekst (comment) og de kilder, brugeren mener er forkerte
--     (wrong_citation_ns), så kolleger i en delt team-tråd kunne læse hinandens kommentarer direkte
--     med deres egen session. Nu ser en bruger kun sine egne rækker, og kun på en besked, brugeren
--     stadig kan se (trådens regel gælder som før: fondens medlemmer, egne og team-tråde).
--   * Appen læser kun egne vurderinger (chat.functions.ts feedbackByMessage filtrerer på
--     user_id), og alt andet (natlig nytte i 0063, Glem person i 0072, eval) kører som
--     service_role eller security definer og er uden for RLS. Ingen kode skal ændres.
--
-- Ingen tabel eller kolonne ændres; kun læsepolicyen. Skrivning sker stadig kun med service_role.

begin;

set local lock_timeout = '5s';

drop policy if exists brain_feedback_select on public.brain_feedback;

create policy brain_feedback_select on public.brain_feedback
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.brain_messages m
       where m.id = brain_feedback.message_id and m.fund_id = brain_feedback.fund_id)
  );

commit;
