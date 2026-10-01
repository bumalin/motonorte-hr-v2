-- 005_names_and_summary.sql — review TASK-016..020
-- 1. user_name(): display name for any signed-in role. Staff can't read other users' rows (users RLS), so
--    "who did this" labels (audit log, logged by, proposed by) showed as blank/System for staff.
--    Returns ONLY full_name — never email, role or password data.
-- 2. v_monthly_summary gains carried_in / carry_out so Gross − Deductions − Carried in reconciles to Net.

create function user_name(p_user uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as
$$ select full_name from users where id = p_user and app_role() is not null $$;

revoke execute on function user_name(uuid) from public;
grant execute on function user_name(uuid) to app_user;

create or replace view v_monthly_summary with (security_invoker = true) as
select date_trunc('month', r.payday)::date as month, l.employee_id,
       sum(l.base) as base, sum(l.ot) as ot, sum(l.incentive) as incentive,
       sum(l.allowances) as allowances, sum(l.deductions) as deductions,
       sum(l.gross) as gross, sum(l.net) as net,
       sum(l.carried_in) as carried_in, sum(l.carry_out) as carry_out
from payroll_lines l join payroll_runs r on r.id = l.run_id
where r.status = 'locked'
group by 1, 2;
