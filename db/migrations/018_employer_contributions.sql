-- Additive employer-cost ledger. Historical wage calculations and approvals stay unchanged.
create table employee_contribution_terms(
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references employees(id),
 effective_month date not null check(effective_month=date_trunc('month',effective_month)::date and effective_month>='2026-11-01'),
 sss bigint not null check(sss between 0 and 100000000),philhealth bigint not null check(philhealth between 0 and 100000000),pagibig bigint not null check(pagibig between 0 and 100000000),
 created_by uuid not null default app_current_user_id() references users(id),created_at timestamptz not null default now(),
 unique(employee_id,effective_month)
);
alter table payroll_runs add column contributions_recorded boolean not null default false;
create table payroll_contributions(
 run_id uuid not null,employee_id uuid not null,benefit_month date not null check(benefit_month=date_trunc('month',benefit_month)::date),
 sss bigint not null check(sss between 0 and 100000000),philhealth bigint not null check(philhealth between 0 and 100000000),pagibig bigint not null check(pagibig between 0 and 100000000),
 monthly_sss bigint not null,monthly_philhealth bigint not null,monthly_pagibig bigint not null,
 classification text not null check(classification in ('ordinary','joining_catchup','final_settlement')),
 term_id uuid not null references employee_contribution_terms(id),provenance jsonb not null,
 primary key(run_id,employee_id,benefit_month),foreign key(run_id,employee_id) references payroll_lines(run_id,employee_id) on delete cascade
);
alter table employee_contribution_terms enable row level security;
alter table payroll_contributions enable row level security;
create policy contribution_terms_read on employee_contribution_terms for select using(app_role() in ('owner','staff') or employee_id=app_employee_id());
create policy contributions_read on payroll_contributions for select using(app_role() in ('owner','staff') or employee_id=app_employee_id());
grant select on employee_contribution_terms,payroll_contributions to app_user;
create trigger payroll_serial before insert or update or delete on employee_contribution_terms for each statement execute function serialize_payroll_write();
create trigger payroll_serial before insert or update or delete on payroll_contributions for each statement execute function serialize_payroll_write();
create trigger contributions_locked before insert or update or delete on payroll_contributions for each row execute function guard_run_rows();
create trigger audit after insert or update or delete on employee_contribution_terms for each row execute function audit_row('id');

create function set_employee_contributions(p_employee uuid,p_sss bigint,p_philhealth bigint,p_pagibig bigint) returns date
language plpgsql security definer set search_path=public,pg_temp as $$
declare m date:=date_trunc('month',now() at time zone 'Asia/Manila')::date; h date; eligible date;
begin
 perform pg_advisory_xact_lock(76239146);
 if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN'; end if;
 if p_sss is null or p_philhealth is null or p_pagibig is null then raise exception 'CONTRIBUTION_AMOUNT_REQUIRED'; end if;
 select hire_date into h from employees where id=p_employee;
 if h is null then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
 eligible:=date_trunc('month',h)::date;
 if extract(day from h)>5 then eligible:=(eligible+interval '1 month')::date; end if;
 if exists(select 1 from employee_contribution_terms t where t.employee_id=p_employee) then m:=(m+interval '1 month')::date;
 else
  m:=greatest(m,eligible,'2026-11-01'::date);
  if exists(select 1 from payroll_runs r join payroll_lines l on l.run_id=r.id where l.employee_id=p_employee and r.status='locked' and date_trunc('month',r.payday)::date=m) then m:=(m+interval '1 month')::date; end if;
 end if;
 if exists(select 1 from payroll_contributions c join payroll_runs r on r.id=c.run_id where c.employee_id=p_employee and c.benefit_month>=m and r.status in ('submitted','locked')) then raise exception 'CONTRIBUTION_MONTH_FROZEN'; end if;
 insert into employee_contribution_terms(employee_id,effective_month,sss,philhealth,pagibig) values(p_employee,m,p_sss,p_philhealth,p_pagibig)
 on conflict(employee_id,effective_month) do update set sss=excluded.sss,philhealth=excluded.philhealth,pagibig=excluded.pagibig;
 return m;
end $$;
revoke execute on function set_employee_contributions(uuid,bigint,bigint,bigint) from public;
grant execute on function set_employee_contributions(uuid,bigint,bigint,bigint) to app_user;

-- Authoritative validation independently reproduces the pure TypeScript allocation.
create function expected_contributions(p_start date,p_run uuid default null)
returns table(employee_id uuid,benefit_month date,sss bigint,philhealth bigint,pagibig bigint,monthly_sss bigint,monthly_philhealth bigint,monthly_pagibig bigint,classification text,term_id uuid,payday_count integer)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare e record; t record; final boolean; m date; eligible date; pd date:=p_start+6; days date[]; idx integer; first_pd date; totals bigint[]; amounts bigint[]; used bigint[]; k integer; d date;
begin
 if app_role() is null then raise exception 'FORBIDDEN'; end if;
 for e in select emp.* from employees emp where emp.hire_date<=pd and (emp.end_date is null or emp.end_date>=p_start) order by emp.code loop
  final:=e.end_date between p_start and pd;
  m:=date_trunc('month',case when final then e.end_date else pd end)::date;
  eligible:=date_trunc('month',e.hire_date)::date;
  if extract(day from e.hire_date)>5 then eligible:=(eligible+interval '1 month')::date; end if;
  if m<greatest(eligible,'2026-11-01'::date) then continue; end if;
  select * into t from employee_contribution_terms ct where ct.employee_id=e.id and ct.effective_month<=m order by ct.effective_month desc limit 1;
  if t.id is null then continue; end if;
  if exists(select 1 from payroll_contributions c join payroll_runs r on r.id=c.run_id where c.employee_id=e.id and c.benefit_month=m and r.status='locked' and r.id is distinct from p_run and r.payday>pd) then raise exception 'CONTRIBUTION_BACKFILL'; end if;
  select array_agg(x::date order by x) into days from generate_series(m,m+interval '1 month'-interval '1 day',interval '1 day') x where extract(dow from x)=0;
  payday_count:=array_length(days,1);idx:=array_position(days,pd);
  select min(x) into first_pd from unnest(days) x where x>=e.hire_date;
  select array[coalesce(sum(c.sss),0)::bigint,coalesce(sum(c.philhealth),0)::bigint,coalesce(sum(c.pagibig),0)::bigint] into used
   from payroll_contributions c join payroll_runs r on r.id=c.run_id where c.employee_id=e.id and c.benefit_month=m and r.status='locked' and r.id is distinct from p_run;
  totals:=array[t.sss,t.philhealth,t.pagibig];amounts:=array[0::bigint,0::bigint,0::bigint];
  classification:=case when final then 'final_settlement' when pd=first_pd and days[1]<e.hire_date then 'joining_catchup' else 'ordinary' end;
  for k in 1..3 loop
   if final then amounts[k]:=totals[k]-used[k];
   else
    if idx is null then raise exception 'INVALID_PAYDAY'; end if;
    amounts[k]:=totals[k]/payday_count+case when idx<=totals[k]%payday_count then 1 else 0 end;
    if classification='joining_catchup' then
     foreach d in array days loop
      if d<e.hire_date then amounts[k]:=amounts[k]+totals[k]/payday_count+case when array_position(days,d)<=totals[k]%payday_count then 1 else 0 end; end if;
     end loop;
    end if;
   end if;
   if amounts[k]<0 or amounts[k]+used[k]>totals[k] then raise exception 'CONTRIBUTION_EXCEEDS_ENTITLEMENT'; end if;
  end loop;
  employee_id:=e.id;benefit_month:=m;sss:=amounts[1];philhealth:=amounts[2];pagibig:=amounts[3];
  monthly_sss:=t.sss;monthly_philhealth:=t.philhealth;monthly_pagibig:=t.pagibig;term_id:=t.id;
  return next;
 end loop;
end $$;
revoke execute on function expected_contributions(date,uuid) from public;
grant execute on function expected_contributions(date,uuid) to app_user;

create function validate_run_contributions(p_run uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r payroll_runs; expected jsonb; actual jsonb;
begin
 if app_role() is null then raise exception 'FORBIDDEN'; end if;
 select * into r from payroll_runs where id=p_run;
 if not r.contributions_recorded then return; end if;
 select coalesce(jsonb_agg(to_jsonb(x)-'payday_count' order by x.employee_id,x.benefit_month),'[]') into expected from expected_contributions(r.period_start,p_run) x;
 select coalesce(jsonb_agg(jsonb_build_object('employee_id',c.employee_id,'benefit_month',c.benefit_month,'sss',c.sss,'philhealth',c.philhealth,'pagibig',c.pagibig,'monthly_sss',c.monthly_sss,'monthly_philhealth',c.monthly_philhealth,'monthly_pagibig',c.monthly_pagibig,'classification',c.classification,'term_id',c.term_id) order by c.employee_id,c.benefit_month),'[]') into actual from payroll_contributions c where c.run_id=p_run;
 if actual is distinct from expected then raise exception 'CONTRIBUTION_RUN_STALE'; end if;
end $$;
revoke execute on function validate_run_contributions(uuid) from public;

create function save_draft_with_contributions(p_start date,p_hash text,p_snapshot jsonb,p_lines jsonb,p_items jsonb,p_contributions jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare id uuid;
begin
 perform pg_advisory_xact_lock(76239146);
 if app_role() is null then raise exception 'FORBIDDEN'; end if;
 id:=save_draft(p_start,p_hash,p_snapshot,p_lines,p_items);
 insert into payroll_contributions(run_id,employee_id,benefit_month,sss,philhealth,pagibig,monthly_sss,monthly_philhealth,monthly_pagibig,classification,term_id,provenance)
 select id,x.employee_id,x.benefit_month,x.sss,x.philhealth,x.pagibig,x.monthly_sss,x.monthly_philhealth,x.monthly_pagibig,x.classification,x.term_id,x.provenance
 from jsonb_to_recordset(p_contributions) as x(employee_id uuid,benefit_month date,sss bigint,philhealth bigint,pagibig bigint,monthly_sss bigint,monthly_philhealth bigint,monthly_pagibig bigint,classification text,term_id uuid,provenance jsonb);
 update payroll_runs set contributions_recorded=true where payroll_runs.id=id;
 perform validate_run_contributions(id);
 return id;
end $$;
revoke execute on function save_draft_with_contributions(date,text,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function save_draft_with_contributions(date,text,jsonb,jsonb,jsonb,jsonb) to app_user;

create function check_contribution_transition() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.status in ('submitted','locked') and old.status is distinct from new.status then perform validate_run_contributions(old.id); end if;
 if new.status='draft' and new.generated_at is distinct from old.generated_at then new.contributions_recorded:=false; end if;
 return new;
end $$;
create trigger contribution_transition before update on payroll_runs for each row execute function check_contribution_transition();

create or replace function archive_approved_run() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.status='locked' and new.status='draft' then
  if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN'; end if;
  insert into payroll_run_versions(run_id,archived_by,reason,snapshot) values(old.id,app_current_user_id(),new.sent_back_note,jsonb_build_object(
   'run',to_jsonb(old),'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('code',e.code,'full_name',e.full_name) order by e.code) from payroll_lines l join employees e on e.id=l.employee_id where l.run_id=old.id),'[]'),
   'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from payroll_items i where i.run_id=old.id),'[]'),
   'contributions',coalesce((select jsonb_agg(to_jsonb(c) order by c.employee_id,c.benefit_month) from payroll_contributions c where c.run_id=old.id),'[]')));
 end if;return new;
end $$;

create function guard_contribution_employment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (new.hire_date is distinct from old.hire_date or new.end_date is distinct from old.end_date)
 and exists(select 1 from payroll_contributions c join payroll_runs r on r.id=c.run_id where c.employee_id=old.id and r.status in ('submitted','locked')
 and (new.hire_date is distinct from old.hire_date or c.classification='final_settlement' or (new.end_date is not null and new.end_date<=r.payday))) then raise exception 'CONTRIBUTION_EMPLOYMENT_FROZEN: reopen the latest affected payroll before changing dates'; end if;
 return new;
end $$;
create trigger contribution_employment before update on employees for each row execute function guard_contribution_employment();

-- Approval PDFs must carry the saved employer values, including explicit legacy coverage.
create function verify_payslip_contributions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare w jsonb; expected jsonb; recorded boolean;
begin
 if new.status='approved' and old.status='pending' then
  for w in select value from jsonb_array_elements(new.snapshot->'weeks') loop
   select r.contributions_recorded into recorded from payroll_runs r where r.id=(w->>'runId')::uuid;
   if recorded then
    select coalesce(jsonb_agg(jsonb_build_object('employeeId',c.employee_id,'benefitMonth',c.benefit_month,'amounts',jsonb_build_object('sss',c.sss,'philhealth',c.philhealth,'pagibig',c.pagibig),'monthly',jsonb_build_object('sss',c.monthly_sss,'philhealth',c.monthly_philhealth,'pagibig',c.monthly_pagibig),'classification',c.classification,'provenance',c.provenance) order by c.benefit_month),'[]') into expected from payroll_contributions c where c.run_id=(w->>'runId')::uuid and c.employee_id=new.employee_id;
    if w->'contributions' is distinct from expected then raise exception 'CONTRIBUTION_SNAPSHOT_INVALID'; end if;
   elsif w->'contributions' is distinct from 'null'::jsonb then raise exception 'CONTRIBUTION_SNAPSHOT_INVALID'; end if;
  end loop;
 end if;return new;
end $$;
create trigger payslip_contributions before update on payslip_requests for each row execute function verify_payslip_contributions();
