-- 0079 · Brugerens ret og lås af en skrevet sektion på en Brain-side (til).
--
-- Vagten på brain_pages (0062) lader kun en ændring af en låst sektion igennem, når
-- `brain.user_edit` er sat i samme transaktion. PostgREST kører hvert kald i sin egen
-- transaktion, så serveren kan ikke sætte den selv. Funktionen her gør det: den retter eller
-- låser/låser op for én skrevet sektion som brugerens ændring (`updated_by = user:<id>`), laver
-- en ny version med ændringsnote og genopbygger søgeteksten. Kun service_role kan kalde den;
-- serverfunktionen har allerede tjekket, at brugeren har rettigheden `brain_review`.

begin;
set local lock_timeout = '5s';

create or replace function public.brain_page_user_edit(
  _fund_id uuid,
  _page_id uuid,
  _user_id uuid,
  _key text,
  _body_md text,
  _lock boolean,
  _note text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.brain_pages%rowtype;
  v_section jsonb;
  v_sections jsonb;
  v_body text;
  v_locked boolean;
  v_fts tsvector;
begin
  if _fund_id is null or _page_id is null or _user_id is null or nullif(btrim(_key), '') is null then
    raise exception 'brain_page_user_edit: fund, page, user and key are required';
  end if;
  if _body_md is null and _lock is null then
    raise exception 'brain_page_user_edit: nothing to change';
  end if;
  if _body_md is not null and char_length(_body_md) > 5000 then
    raise exception 'brain_page_user_edit: section too long';
  end if;

  select * into v_page from public.brain_pages p
   where p.id = _page_id and p.fund_id = _fund_id for update;
  if not found then
    return jsonb_build_object('skipped', 'page_gone');
  end if;

  select e into v_section from jsonb_array_elements(v_page.sections) e
   where e ->> 'key' = _key limit 1;
  if v_section is null then
    return jsonb_build_object('skipped', 'section_gone');
  end if;
  if coalesce((v_section ->> 'computed')::boolean, false) then
    return jsonb_build_object('skipped', 'computed');
  end if;

  v_body := coalesce(btrim(_body_md), v_section ->> 'body_md');
  -- A change of the text locks the section unless the caller says otherwise.
  v_locked := coalesce(_lock, _body_md is not null, false);
  if v_body is not distinct from btrim(v_section ->> 'body_md')
     and v_locked = coalesce((v_section ->> 'locked_by_user')::boolean, false) then
    return jsonb_build_object('skipped', 'unchanged');
  end if;

  select jsonb_agg(
    case when e ->> 'key' = _key then
      e || jsonb_build_object(
        'body_md', v_body,
        'fact_ids', coalesce((
          select jsonb_agg(distinct m[1])
          from regexp_matches(v_body, '\[f:([^\]\s]+)\]', 'g') as m), '[]'::jsonb),
        'locked_by_user', v_locked,
        'updated_at', now())
    else e end
    order by ord)
    into v_sections
    from jsonb_array_elements(v_page.sections) with ordinality as t(e, ord);

  select to_tsvector('danish'::regconfig, left(v_page.title || ' ' || coalesce(string_agg(
           (e ->> 'heading') || ' ' || regexp_replace(e ->> 'body_md', '\[f:[^\]\s]+\]', '', 'g'), ' '),
           ''), 200000))
    into v_fts
    from jsonb_array_elements(v_sections) e;

  perform set_config('brain.user_edit', 'on', true);
  perform set_config('brain.change_note', left(coalesce(nullif(btrim(_note), ''), 'Rettet af en bruger'), 500), true);
  update public.brain_pages p
     set sections = v_sections, search_fts = v_fts, updated_by = 'user:' || _user_id::text
   where p.id = v_page.id
  returning * into v_page;
  perform set_config('brain.user_edit', 'off', true);

  return jsonb_build_object('version', v_page.version, 'locked', v_locked);
end;
$$;

revoke all on function public.brain_page_user_edit(uuid, uuid, uuid, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.brain_page_user_edit(uuid, uuid, uuid, text, text, boolean, text)
  to service_role;

commit;
