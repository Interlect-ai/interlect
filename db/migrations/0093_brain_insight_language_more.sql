-- 0093 · Brains øvrige database-indsigter på teamets sprog.
--
-- 0091 oversatte kun modstrids-indsigterne. Natkørslen (0063) og refleksionen (0075) skriver selv
-- fire andre slags med dansk titel og forklaring: stale_fact ("Forældede nøgletal: …"),
-- merge_candidate (to enheder eller to lektioner, der måske er det samme), bullet_retire
-- ("Pensionér lektion …?") og lesson_candidate ("Ny lektion …"). Brains arbejder skriver sine egne
-- indsigter på teamets sprog, så et engelsk team fik stadig blandede indsigter.
--
-- Samme greb som 0091: i stedet for at kopiere de store funktioner sætter triggeren de faste ord på
-- engelsk, når teamet er engelsk (funds.language, 0085). Navne, korte id'er, tal, datoer og
-- lektionens egen tekst (modellens ord) står, som de er. Dansk er uændret: et dansk team får
-- nøjagtig samme tekst som før. En tekst, der ikke passer på mønsteret (fx klippet ved 300 tegn),
-- står hellere på dansk end halvt oversat. Eksisterende indsigter for engelske teams rettes én gang
-- nederst. Ingen ændring af tabeller eller policies.

begin;

set local lock_timeout = '5s';

-- The English title and explanation of an insight the database wrote in Danish; anything it does
-- not recognise comes back unchanged. The contradiction texts are 0091's.
create or replace function private.brain_insight_english(
  _kind text,
  _title text,
  _body text,
  _refs jsonb,
  _fund_id uuid,
  out title text,
  out body_md text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_first text;
  v_second text;
begin
  title := _title;
  body_md := _body;

  if _kind = 'contradiction' then
    if _title like 'Modstridende oplysninger: %' then
      title := left(
        'Conflicting information: ' || substr(_title, char_length('Modstridende oplysninger: ') + 1),
        300);
    elsif _title like 'Modstridende kilder: %' then
      title := left(
        'Conflicting sources: ' || substr(_title, char_length('Modstridende kilder: ') + 1),
        300);
    end if;
    if _body = 'Brain har to forskellige oplysninger om det samme for samme periode. Søgningen foretrækker den med højest tillid, indtil en af dem er rettet eller afvist.' then
      body_md := 'Brain has two different pieces of information about the same thing for the same period. Search prefers the one with the highest trust until one of them is corrected or rejected.';
    elsif _body = 'Analysen har markeret beviset som modstridende: kilderne siger forskellige ting. Afklar det, før tallet bruges.' then
      body_md := 'The analysis marked the evidence as contradictory: the sources say different things. Clarify it before the figure is used.';
    end if;

  elsif _kind = 'stale_fact' then
    -- 0063: 'Forældede nøgletal: ' || name, and the newest figure's date (DD-MM-YYYY).
    if _title like 'Forældede nøgletal: %' then
      title := left(
        'Outdated key figures: ' || substr(_title, char_length('Forældede nøgletal: ') + 1), 300);
    end if;
    body_md := regexp_replace(_body,
      '^Det nyeste nøgletal, Brain har om (.*), gælder ([0-9]{2}-[0-9]{2}-[0-9]{4}), mere end 18 måneder siden\. Hent nye tal, før casen vurderes igen\.$',
      'The newest key figure Brain has about \1 is from \2, more than 18 months ago. Get new figures before the case is assessed again.');

  elsif _kind = 'merge_candidate' then
    if _title ~ '^Er lektion \S+ og \S+ den samme\?$' then
      -- 0063: two lessons that say almost the same.
      title := regexp_replace(_title, '^Er lektion (\S+) og (\S+) den samme\?$',
        'Are lessons \1 and \2 the same?');
    elsif _title like 'Er "%' then
      -- 0063: two entities with the same CVR number or domain, named in the refs' order. Only a
      -- title that is exactly the Danish one from those names is rewritten (a name may hold quotes).
      select e.name into v_first
        from public.brain_entities e
       where e.fund_id = _fund_id and e.id::text = (_refs -> 0 ->> 'id');
      select e.name into v_second
        from public.brain_entities e
       where e.fund_id = _fund_id and e.id::text = (_refs -> 1 ->> 'id');
      if v_first is not null and v_second is not null
         and _title = left('Er "' || v_first || '" og "' || v_second || '" det samme?', 300) then
        title := left('Are "' || v_first || '" and "' || v_second || '" the same?', 300);
      end if;
    end if;
    -- The explanation follows its title: an old row whose entity has since been renamed or
    -- forgotten keeps both in Danish rather than half of it in English.
    if title is distinct from _title then
      if _body = 'De har samme CVR-nummer, men Brain kunne ikke lægge dem sammen automatisk. Læg dem sammen, hvis de er det samme.' then
        body_md := 'They have the same CVR number, but Brain could not merge them automatically. Merge them if they are the same.';
      elsif _body = 'De har samme domæne, men Brain kunne ikke lægge dem sammen automatisk. Læg dem sammen, hvis de er det samme.' then
        body_md := 'They have the same domain, but Brain could not merge them automatically. Merge them if they are the same.';
      elsif _body = 'De to lektioner siger næsten det samme. Læg dem sammen, eller afvis den ene.' then
        body_md := 'The two lessons say almost the same thing. Merge them, or reject one of them.';
      end if;
    end if;

  elsif _kind = 'bullet_retire' then
    -- 0063: the lesson's short id, its text (up to 300 characters) and its counts.
    title := regexp_replace(_title, '^Pensionér lektion (\S+)\?$', 'Retire lesson \1?');
    body_md := regexp_replace(_body,
      '^Lektionen "(.*)" har talt imod ([0-9]+) gange og for ([0-9]+) gange\. Brain foreslår at pensionere den\.$',
      'The lesson "\1" stands at \2 against and \3 for. Brain suggests retiring it.');

  elsif _kind = 'lesson_candidate' then
    -- 0075: 'Ny lektion ' || short id || ': ' || the lesson's text.
    if _title like 'Ny lektion %' then
      title := left('New lesson ' || substr(_title, char_length('Ny lektion ') + 1), 300);
    end if;
    body_md := regexp_replace(_body,
      '^Brain foreslår lektionen "(.*)" ud fra beslutningen\. Den bliver aktiv, når en anden bruger bekræfter den i en anden case, eller når den godkendes under Brain · Lært\.$',
      'Brain suggests the lesson "\1" from the decision. It becomes active when another user confirms it in another case, or when it is approved under Brain · Learned.');
  end if;

  -- The English text is a little longer in places; stay inside the table's limits.
  title := left(title, 300);
  body_md := left(body_md, 20000);
end;
$$;

revoke all on function private.brain_insight_english(text, text, text, jsonb, uuid)
  from public, anon, authenticated;

-- 0091's trigger function, now for every kind the database writes itself.
create or replace function public.brain_insight_fund_language()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_language text;
  v_title text;
  v_body text;
begin
  select f.language into v_language from public.funds f where f.id = new.fund_id;
  if v_language is distinct from 'en' then
    return new;
  end if;
  select x.title, x.body_md into v_title, v_body
    from private.brain_insight_english(new.kind, new.title, new.body_md, new.refs, new.fund_id) x;
  new.title := v_title;
  new.body_md := v_body;
  return new;
end;
$$;

revoke all on function public.brain_insight_fund_language() from public, anon, authenticated;

drop trigger if exists brain_insights_fund_language on public.brain_insights;
create trigger brain_insights_fund_language
  before insert on public.brain_insights
  for each row
  when (new.kind in ('contradiction', 'stale_fact', 'merge_candidate', 'bullet_retire',
                     'lesson_candidate'))
  execute function public.brain_insight_fund_language();

-- Én gang: de indsigter, engelske teams allerede har fået på dansk (modstrid er rettet i 0091).
with english as (
  select i.id, x.title, x.body_md
    from public.brain_insights i
    join public.funds f on f.id = i.fund_id and f.language = 'en'
    cross join lateral private.brain_insight_english(
      i.kind, i.title, i.body_md, i.refs, i.fund_id) x
   where i.kind in ('stale_fact', 'merge_candidate', 'bullet_retire', 'lesson_candidate')
)
update public.brain_insights i
   set title = english.title,
       body_md = english.body_md
  from english
 where english.id = i.id
   and (english.title is distinct from i.title or english.body_md is distinct from i.body_md);

commit;
