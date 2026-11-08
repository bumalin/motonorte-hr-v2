-- Preserve 018's applied checksum; fix ambiguous local identifier found by isolated save tests.
create or replace function save_draft_with_contributions(p_start date,p_hash text,p_snapshot jsonb,p_lines jsonb,p_items jsonb,p_contributions jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run uuid;
begin
 perform pg_advisory_xact_lock(76239146);
 if app_role() is null then raise exception 'FORBIDDEN'; end if;
 v_run:=save_draft(p_start,p_hash,p_snapshot,p_lines,p_items);
 insert into payroll_contributions(run_id,employee_id,benefit_month,sss,philhealth,pagibig,monthly_sss,monthly_philhealth,monthly_pagibig,classification,term_id,provenance)
 select v_run,x.employee_id,x.benefit_month,x.sss,x.philhealth,x.pagibig,x.monthly_sss,x.monthly_philhealth,x.monthly_pagibig,x.classification,x.term_id,x.provenance
 from jsonb_to_recordset(p_contributions) as x(employee_id uuid,benefit_month date,sss bigint,philhealth bigint,pagibig bigint,monthly_sss bigint,monthly_philhealth bigint,monthly_pagibig bigint,classification text,term_id uuid,provenance jsonb);
 update payroll_runs set contributions_recorded=true where payroll_runs.id=v_run;
 perform validate_run_contributions(v_run);
 return v_run;
end $$;

create or replace function crew_run_fresh(p_run uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select coalesce((select not exists(select 1 from audit_log a where a.at>r.generated_at
and a.table_name in ('employees','pay_terms','attendance','job_log','adjustments','catalog_jobs','catalog_amounts','settings','holidays','employee_contribution_terms'))
from payroll_runs r where r.id=p_run and exists(select 1 from payroll_lines l where l.run_id=r.id and l.employee_id=app_employee_id())),false)
$$;
