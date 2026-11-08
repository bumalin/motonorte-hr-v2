-- Review fix (2026-11-08): a first-time configuration skips a month that already has a SUBMITTED payroll for the
-- employee, not only a locked one, so it can never land behind a week that is waiting for approval. Otherwise
-- identical to 020 (whose checksum stays unchanged).
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
  if exists(select 1 from payroll_runs r join payroll_lines l on l.run_id=r.id where l.employee_id=p_employee and r.status in ('submitted','locked') and date_trunc('month',r.payday)::date=m) then m:=(m+interval '1 month')::date; end if;
 end if;
 if exists(select 1 from payroll_contributions c join payroll_runs r on r.id=c.run_id where c.employee_id=p_employee and c.benefit_month>=m and r.status in ('submitted','locked')) then raise exception 'CONTRIBUTION_MONTH_FROZEN'; end if;
 insert into employee_contribution_terms(employee_id,effective_month,sss,philhealth,pagibig) values(p_employee,m,p_sss,p_philhealth,p_pagibig) on conflict(employee_id,effective_month) do update set sss=excluded.sss,philhealth=excluded.philhealth,pagibig=excluded.pagibig;return m;
end $$;
