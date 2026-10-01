-- 004_freeze_and_caps.sql — review TASK-011..015
-- 1. A week is frozen while its run is SUBMITTED (not only when locked): no attendance/job/adjustment edits can slip in
--    between the Owner's review and lock_run. Sending the run back unfreezes it.
-- 2. Upper bounds on money inputs so a typo can't overflow downstream code (DB is the last line of defense).

create or replace function is_period_locked(p date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from payroll_runs where period_start = p and status in ('submitted', 'locked')) $$;

create or replace function guard_locked_day() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare d date;
begin
  foreach d in array array[
      case when tg_op <> 'INSERT' then (to_jsonb(old) ->> tg_argv[0])::date end,
      case when tg_op <> 'DELETE' then (to_jsonb(new) ->> tg_argv[0])::date end] loop
    if d is not null and is_period_locked(period_start_of(d)) then
      raise exception 'PERIOD_LOCKED: % falls in a submitted or locked payroll week', d using errcode = 'P0001';
    end if;
  end loop;
  return coalesce(new, old);
end
$$;

alter table adjustments     add constraint adjustments_amount_cap     check (amount <= 100000000);  -- ₱1,000,000
alter table catalog_amounts add constraint catalog_amounts_amount_cap check (amount <= 10000000);   -- ₱100,000
alter table pay_terms       add constraint pay_terms_daily_rate_cap   check (daily_rate <= 10000000); -- ₱100,000/day
