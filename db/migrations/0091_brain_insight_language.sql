-- 0091: Brains modstrids-indsigter på fondens sprog.
--
-- Databasefunktionerne brain_apply_extraction (0045), brain_apply_extraction_source (0054) og
-- natkørslen (0063) skriver selv indsigten "Modstridende oplysninger: …" / "Modstridende kilder: …"
-- med en fast dansk forklaring. Brains arbejder skriver sine egne indsigter på fondens sprog
-- Så en engelsk fond fik blandede indsigter.
--
-- I stedet for at kopiere de tre store funktioner sætter en trigger titlens præfiks og den faste
-- forklaring på engelsk, når fonden er engelsk (funds.language, 0085). Dansk er uændret: en dansk
-- fond får nøjagtig samme tekst som før. Udsagnet efter præfikset er faktaens egen tekst og
-- røres ikke. Eksisterende indsigter for engelske fonde rettes én gang nederst.

create or replace function public.brain_insight_fund_language()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_language text;
begin
  select f.language into v_language from public.funds f where f.id = new.fund_id;
  if v_language is distinct from 'en' then
    return new;
  end if;
  if new.title like 'Modstridende oplysninger: %' then
    new.title := left(
      'Conflicting information: ' || substr(new.title, char_length('Modstridende oplysninger: ') + 1),
      300);
  elsif new.title like 'Modstridende kilder: %' then
    new.title := left(
      'Conflicting sources: ' || substr(new.title, char_length('Modstridende kilder: ') + 1),
      300);
  end if;
  if new.body_md = 'Brain har to forskellige oplysninger om det samme for samme periode. Søgningen foretrækker den med højest tillid, indtil en af dem er rettet eller afvist.' then
    new.body_md := 'Brain has two different pieces of information about the same thing for the same period. Search prefers the one with the highest trust until one of them is corrected or rejected.';
  elsif new.body_md = 'Analysen har markeret beviset som modstridende: kilderne siger forskellige ting. Afklar det, før tallet bruges.' then
    new.body_md := 'The analysis marked the evidence as contradictory: the sources say different things. Clarify it before the figure is used.';
  end if;
  return new;
end;
$$;

revoke all on function public.brain_insight_fund_language() from public, anon, authenticated;

drop trigger if exists brain_insights_fund_language on public.brain_insights;
create trigger brain_insights_fund_language
  before insert on public.brain_insights
  for each row
  when (new.kind = 'contradiction')
  execute function public.brain_insight_fund_language();

-- Én gang: de modstrids-indsigter, engelske fonde allerede har fået på dansk.
update public.brain_insights i
set
  title = case
    when i.title like 'Modstridende oplysninger: %' then left(
      'Conflicting information: ' || substr(i.title, char_length('Modstridende oplysninger: ') + 1),
      300)
    when i.title like 'Modstridende kilder: %' then left(
      'Conflicting sources: ' || substr(i.title, char_length('Modstridende kilder: ') + 1),
      300)
    else i.title
  end,
  body_md = case
    when i.body_md = 'Brain har to forskellige oplysninger om det samme for samme periode. Søgningen foretrækker den med højest tillid, indtil en af dem er rettet eller afvist.'
      then 'Brain has two different pieces of information about the same thing for the same period. Search prefers the one with the highest trust until one of them is corrected or rejected.'
    when i.body_md = 'Analysen har markeret beviset som modstridende: kilderne siger forskellige ting. Afklar det, før tallet bruges.'
      then 'The analysis marked the evidence as contradictory: the sources say different things. Clarify it before the figure is used.'
    else i.body_md
  end
from public.funds f
where f.id = i.fund_id
  and f.language = 'en'
  and i.kind = 'contradiction'
  and (i.title like 'Modstridende oplysninger: %' or i.title like 'Modstridende kilder: %');
