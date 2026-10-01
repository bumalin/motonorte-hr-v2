-- 008_daily_allowance_flexible_rest.sql — Owner decisions 2026-09-27 (PRD OQ-20/21, rules PR-021/022/062)
-- 1. Daily allowance is part of each employee's effective-dated pay terms.
-- 2. Rest days are not fixed: R (day off) may be recorded on any day.

alter table pay_terms add column daily_allowance bigint not null default 0
  check (daily_allowance between 0 and 1000000);   -- centavos; cap ₱10,000/day

create or replace function validate_attendance() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare e employees;
begin
  select * into e from employees where id = new.employee_id;
  if new.date < e.hire_date or (e.end_date is not null and new.date > e.end_date) then
    raise exception 'NOT_EMPLOYED: % is outside % employment dates', new.date, e.code using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := app_current_user_id();
  return new;
end
$$;

-- Column appended at the end so CREATE OR REPLACE VIEW keeps existing columns in place
create or replace view v_employee_current with (security_invoker = true) as
select e.*, t.position, t.daily_rate, t.effective_from as terms_since, t.daily_allowance
from employees e
left join lateral (
  select position, daily_rate, effective_from, daily_allowance from pay_terms
  where employee_id = e.id and status = 'approved' and effective_from <= (now() at time zone 'Asia/Manila')::date
  order by effective_from desc limit 1) t on true;
