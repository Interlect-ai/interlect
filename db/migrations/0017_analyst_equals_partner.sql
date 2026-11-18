-- Analytikere får samme rettigheder som partnere (undtagen brugeradministration,
-- som kun administratorer har). Eneste databaseregel, der skelnede mellem de to
-- roller, var at sende en case til dyb analyse.

begin;

create or replace function public.move_case_workspace(
  _case_id uuid,
  _fund_id uuid,
  _target public.case_workspace_status,
  _reason text default null
)
returns public.case_workspace_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.case_workspace_status;
begin
  select workspace_status into v_previous
  from public.cases
  where id = _case_id and fund_id = _fund_id
  for update;

  if v_previous is null or not public.is_fund_member(auth.uid(), _fund_id) then
    raise exception 'Casen blev ikke fundet i den valgte fond.';
  end if;

  if _target = 'deep_analysis' then
    -- Phillip 24/9-2026: en analytiker kan det samme som en partner, undtagen
    -- brugeradministration. Administratoren havde allerede rettigheden i koden
    -- (approve_deep_analysis), så databasen følger nu samme regel.
    if not (
      public.has_fund_role(auth.uid(), _fund_id, 'partner')
      or public.has_fund_role(auth.uid(), _fund_id, 'analyst')
      or public.has_fund_role(auth.uid(), _fund_id, 'administrator')
    ) then
      raise exception 'Din rolle kan ikke sende en case til dyb analyse.';
    end if;
    if not exists (
      select 1
      from public.analysis_runs ar
      where ar.case_id = _case_id
        and ar.fund_id = _fund_id
        and ar.kind = 'screening'
        and ar.status = 'awaiting_approval'
    ) then
      raise exception 'Casen skal have en afsluttet screening, før den kan sendes til dyb analyse.';
    end if;
  elsif not (
    public.has_fund_role(auth.uid(), _fund_id, 'analyst')
    or public.has_fund_role(auth.uid(), _fund_id, 'partner')
    or public.has_fund_role(auth.uid(), _fund_id, 'administrator')
  ) then
    raise exception 'Din rolle kan ikke flytte casen.';
  end if;

  if v_previous = _target then
    return v_previous;
  end if;

  update public.cases
  set workspace_status = _target,
      workspace_reason = nullif(trim(coalesce(_reason, '')), ''),
      workspace_changed_at = now(),
      deep_analysis_requested_at = case
        when _target = 'deep_analysis' then now()
        else deep_analysis_requested_at
      end,
      archived_at = case when _target = 'archived' then now() else null end,
      updated_at = now()
  where id = _case_id and fund_id = _fund_id;

  insert into public.case_transition_events
    (fund_id, case_id, field, actor_type, actor_id, previous_value, new_value, reason)
  values
    (_fund_id, _case_id, 'workspace_status', 'user', auth.uid(),
     v_previous::text, _target::text, nullif(trim(coalesce(_reason, '')), ''));

  return _target;
end;
$$;

commit;
