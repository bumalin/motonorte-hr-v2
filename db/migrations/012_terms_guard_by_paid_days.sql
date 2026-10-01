-- 012_terms_guard_by_paid_days.sql — Owner report 2026-09-27: moving M006's hire date from Sep 27 to Aug 10 was refused
-- because Sep 21–27 is locked, although M006's only day in that week was Sep 27 itself.
-- A pay-terms row can only change a locked week through the days the employee has attendance there (rate, position and
-- allowance are all per attendance day; attendance in locked weeks is frozen). So guard those days, not whole weeks.
create or replace function overlaps_locked_for(p_employee uuid, p_from date, p_to date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from attendance a join payroll_runs r on r.period_start = period_start_of(a.date)
                  where a.employee_id = p_employee and r.status = 'locked'
                    and a.date >= p_from and (p_to is null or a.date < p_to)) $$;
