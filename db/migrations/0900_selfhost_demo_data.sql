-- 0900 · Demo data for self-hosting.
--
-- `npm run seed:demo` (scripts/selfhost/seed-demo.ts) lægger 10 opdigtede cases i en fond, så
-- hver skærm har indhold fra første login. Alt, seedet opretter, står her: selskaberne, casene,
-- personerne og den opdigtede demoanalytiker (en bruger uden adgangskode, der aldrig kan logge
-- ind). Resten af en demorække (evidens, noter, analyser, risici, beslutninger, opgaver) hører til
-- en case eller et selskab og forsvinder med den.
--
-- `delete_demo_data` sletter præcis de markerede rækker i én transaktion og skriver én
-- revisionshændelse. Brugeren i auth slettes bagefter af serveren (auth-API'et); dens markør
-- bliver stående, til det er sket, så et nyt forsøg kan finde den.
--
-- The number 0900 keeps this migration apart from the numbered series.

begin;
set local lock_timeout = '5s';

create table public.demo_data_rows (
  fund_id uuid not null references public.funds (id) on delete cascade,
  entity text not null check (entity in ('company', 'case', 'person', 'user')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (fund_id, entity, entity_id)
);

create index demo_data_rows_entity_idx on public.demo_data_rows (entity, entity_id);

revoke all on table public.demo_data_rows from public, anon, authenticated;
grant select on table public.demo_data_rows to authenticated;
grant all on table public.demo_data_rows to service_role;
alter table public.demo_data_rows enable row level security;

-- Samme begrænsende policy som alle tabeller med RLS (0094).
create policy mfa_required on public.demo_data_rows as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- Teamets medlemmer ser, om fonden har demodata (banneret); kun serveren skriver.
create policy demo_data_rows_select_member on public.demo_data_rows
for select to authenticated
using (public.is_fund_member((select auth.uid()), fund_id));

create or replace function public.delete_demo_data(_fund_id uuid, _actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cases uuid[];
  v_companies uuid[];
  v_people uuid[];
  v_users uuid[];
  v_points integer;
  v_runs integer;
  v_case_count integer;
  v_company_count integer;
  v_person_count integer;
  v_result jsonb;
begin
  if _fund_id is null then
    raise exception 'delete_demo_data: fund is required';
  end if;
  -- One deletion at a time per fund. The seed does not take this lock: a seed that runs during a
  -- deletion can leave marked rows behind, which the next deletion removes.
  perform 1 from public.funds f where f.id = _fund_id for update;
  if not found then
    raise exception 'delete_demo_data: fund not found';
  end if;

  select
    coalesce(array_agg(entity_id) filter (where entity = 'case'), '{}'),
    coalesce(array_agg(entity_id) filter (where entity = 'company'), '{}'),
    coalesce(array_agg(entity_id) filter (where entity = 'person'), '{}'),
    coalesce(array_agg(entity_id) filter (where entity = 'user'), '{}')
  into v_cases, v_companies, v_people, v_users
  from public.demo_data_rows
  where fund_id = _fund_id;

  -- financial_data_points → evidence_items is ON DELETE RESTRICT, and a cascade's order is not
  -- fixed (0037): the points go first, then the runs, then the cases with everything on them.
  delete from public.financial_data_points
   where fund_id = _fund_id and case_id = any (v_cases);
  get diagnostics v_points = row_count;
  delete from public.analysis_runs
   where fund_id = _fund_id and case_id = any (v_cases);
  get diagnostics v_runs = row_count;
  delete from public.cases
   where fund_id = _fund_id and id = any (v_cases);
  get diagnostics v_case_count = row_count;
  delete from public.companies
   where fund_id = _fund_id and id = any (v_companies);
  get diagnostics v_company_count = row_count;
  delete from public.people
   where fund_id = _fund_id and id = any (v_people);
  get diagnostics v_person_count = row_count;

  delete from public.demo_data_rows
   where fund_id = _fund_id and entity in ('case', 'company', 'person');

  v_result := jsonb_build_object(
    'cases', v_case_count,
    'companies', v_company_count,
    'people', v_person_count,
    'runs', v_runs,
    'financialPoints', v_points,
    'users', to_jsonb(v_users)
  );

  insert into public.audit_events (fund_id, actor_type, actor_id, action, entity, entity_id, payload)
  values (
    _fund_id,
    'user',
    _actor_id,
    'demo_data.deleted',
    'funds',
    _fund_id,
    v_result - 'users' || jsonb_build_object('users', coalesce(array_length(v_users, 1), 0))
  );
  return v_result;
end;
$$;

revoke all on function public.delete_demo_data(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_demo_data(uuid, uuid) to service_role;

commit;
