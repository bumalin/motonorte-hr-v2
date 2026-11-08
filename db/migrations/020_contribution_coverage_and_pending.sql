-- Review fixes, preserving previous migration checksums and approved history.
alter table payroll_lines add column contribution_coverage text not null default 'legacy' check(contribution_coverage in ('legacy','unconfigured','not_eligible','recorded'));
create function employee_contribution_coverage(p_employee uuid,p_start date) returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare e employees; m date; eligible date;
begin
 if app_role() is null and app_employee_id() is distinct from p_employee then raise exception 'FORBIDDEN'; end if;
 select * into e from employees where id=p_employee;if e.id is null then return 'unconfigured'; end if;
 m:=date_trunc('month',case when e.end_date between p_start and p_start+6 then e.end_date else p_start+6 end)::date;
 eligible:=date_trunc('month',e.hire_date)::date;if extract(day from e.hire_date)>5 then eligible:=(eligible+interval '1 month')::date; end if;
 if e.hire_date>p_start+6 or e.end_date<p_start or m<greatest(eligible,'2026-11-01'::date) then return 'not_eligible'; end if;
 if not exists(select 1 from employee_contribution_terms t where t.employee_id=p_employee and t.effective_month<=m) then return 'unconfigured'; end if;
 return 'recorded';
end $$;
revoke execute on function employee_contribution_coverage(uuid,date) from public;grant execute on function employee_contribution_coverage(uuid,date) to app_user;

create or replace function set_employee_contributions(p_employee uuid,p_sss bigint,p_philhealth bigint,p_pagibig bigint) returns date language plpgsql security definer set search_path=public,pg_temp as $$
declare current_month date:=date_trunc('month',now() at time zone 'Asia/Manila')::date; m date; h date; eligible date; initial_pending date;
begin
 perform pg_advisory_xact_lock(76239146);if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN'; end if;
 if p_sss is null or p_philhealth is null or p_pagibig is null then raise exception 'CONTRIBUTION_AMOUNT_REQUIRED'; end if;
 select hire_date into h from employees where id=p_employee;if h is null then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
 eligible:=date_trunc('month',h)::date;if extract(day from h)>5 then eligible:=(eligible+interval '1 month')::date; end if;
 select min(t.effective_month) into initial_pending from employee_contribution_terms t where t.employee_id=p_employee;
 if initial_pending is not null then m:=case when initial_pending>current_month then greatest(initial_pending,eligible) else (current_month+interval '1 month')::date end;
 else
  m:=greatest(current_month,eligible,'2026-11-01'::date);
  if exists(select 1 from payroll_runs r join payroll_lines l on l.run_id=r.id where l.employee_id=p_employee and r.status='locked' and date_trunc('month',r.payday)::date=m) then m:=(m+interval '1 month')::date; end if;
 end if;
 if exists(select 1 from payroll_contributions c join payroll_runs r on r.id=c.run_id where c.employee_id=p_employee and c.benefit_month>=m and r.status in ('submitted','locked')) then raise exception 'CONTRIBUTION_MONTH_FROZEN'; end if;
 insert into employee_contribution_terms(employee_id,effective_month,sss,philhealth,pagibig) values(p_employee,m,p_sss,p_philhealth,p_pagibig) on conflict(employee_id,effective_month) do update set sss=excluded.sss,philhealth=excluded.philhealth,pagibig=excluded.pagibig;return m;
end $$;

create or replace function save_draft_with_contributions(p_start date,p_hash text,p_snapshot jsonb,p_lines jsonb,p_items jsonb,p_contributions jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run uuid;
begin
 perform pg_advisory_xact_lock(76239146);if app_role() is null then raise exception 'FORBIDDEN'; end if;
 v_run:=save_draft(p_start,p_hash,p_snapshot,p_lines,p_items);
 insert into payroll_contributions(run_id,employee_id,benefit_month,sss,philhealth,pagibig,monthly_sss,monthly_philhealth,monthly_pagibig,classification,term_id,provenance)
 select v_run,x.employee_id,x.benefit_month,x.sss,x.philhealth,x.pagibig,x.monthly_sss,x.monthly_philhealth,x.monthly_pagibig,x.classification,x.term_id,x.provenance from jsonb_to_recordset(p_contributions) as x(employee_id uuid,benefit_month date,sss bigint,philhealth bigint,pagibig bigint,monthly_sss bigint,monthly_philhealth bigint,monthly_pagibig bigint,classification text,term_id uuid,provenance jsonb);
 update payroll_lines l set contribution_coverage=employee_contribution_coverage(l.employee_id,p_start) where l.run_id=v_run;
 update payroll_runs set contributions_recorded=true where payroll_runs.id=v_run;perform validate_run_contributions(v_run);return v_run;
end $$;

create or replace function verify_payslip_contributions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare w jsonb; expected jsonb; recorded boolean; coverage text;
begin
 if new.status='approved' and old.status='pending' then
  for w in select value from jsonb_array_elements(new.snapshot->'weeks') loop
   select r.contributions_recorded,l.contribution_coverage into recorded,coverage from payroll_runs r join payroll_lines l on l.run_id=r.id where r.id=(w->>'runId')::uuid and l.employee_id=new.employee_id;
   if recorded then
    if w->>'contributionCoverage' is distinct from coverage then raise exception 'CONTRIBUTION_SNAPSHOT_INVALID'; end if;
    if coverage in ('legacy','unconfigured') then expected:='null'::jsonb;
    else
     select coalesce(jsonb_agg(jsonb_build_object('employeeId',c.employee_id,'benefitMonth',c.benefit_month,'amounts',jsonb_build_object('sss',c.sss,'philhealth',c.philhealth,'pagibig',c.pagibig),'monthly',jsonb_build_object('sss',c.monthly_sss,'philhealth',c.monthly_philhealth,'pagibig',c.monthly_pagibig),'classification',c.classification,'provenance',c.provenance) order by c.benefit_month),'[]') into expected from payroll_contributions c where c.run_id=(w->>'runId')::uuid and c.employee_id=new.employee_id;
    end if;
    if w->'contributions' is distinct from expected then raise exception 'CONTRIBUTION_SNAPSHOT_INVALID'; end if;
   elsif coalesce(w->'contributions','null'::jsonb) is distinct from 'null'::jsonb then raise exception 'CONTRIBUTION_SNAPSHOT_INVALID'; end if;
  end loop;
 end if;return new;
end $$;
