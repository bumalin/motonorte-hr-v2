-- 010_backdating_review_fixes.sql — review of 009 (docs/reviews/OWNER-REQUEST-2026-09-27b.md)
-- 1. A backfilled week must not deduct a carry-over that a later locked week already deducted.
-- 2. Pay terms only guard the locked weeks THIS employee was paid in (other employees' locks are irrelevant to them),
--    so their hire date can move earlier after they've been paid.
-- 3. Changing a user's email signs out their sessions, like a password or role change.

create or replace function carried_in_for(p_period_start date) returns table (employee_id uuid, carried_in bigint)
  language sql stable security definer set search_path = public, pg_temp as
$$
  select employee_id, carry_out from (
    select distinct on (l.employee_id) l.employee_id, l.carry_out
    from payroll_lines l join payroll_runs r on r.id = l.run_id
    where r.status = 'locked' and r.period_start < p_period_start
    order by l.employee_id, r.period_start desc) latest
  where carry_out > 0 and app_role() is not null
    -- A later locked week that included this employee already took the balance (backfilled weeks, PR-072)
    and not exists (select 1 from payroll_lines l2 join payroll_runs r2 on r2.id = l2.run_id
                    where r2.status = 'locked' and r2.period_start > p_period_start and l2.employee_id = latest.employee_id)
$$;

-- Locked weeks inside [p_from, p_to) in which this employee was paid
create function overlaps_locked_for(p_employee uuid, p_from date, p_to date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from payroll_runs r join payroll_lines l on l.run_id = r.id
                  where r.status = 'locked' and l.employee_id = p_employee
                    and r.period_start + 6 >= p_from and (p_to is null or r.period_start < p_to)) $$;
revoke execute on function overlaps_locked_for(uuid, date, date) from public;
grant execute on function overlaps_locked_for(uuid, date, date) to app_user;

create or replace function guard_effective_date() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare
  d date := (to_jsonb(new) ->> tg_argv[0])::date;
  o date := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> tg_argv[0])::date end;
  next_d date;
  next_o date;
  hit_o boolean := false;
  hit_d boolean;
begin
  -- Rejecting a stale proposal changes nothing that locked weeks depend on
  if tg_table_name = 'pay_terms' and tg_op = 'UPDATE' and d = o
     and (to_jsonb(old) ->> 'status') = 'proposed' and (to_jsonb(new) ->> 'status') = 'rejected'
     and (to_jsonb(new) - array['status','decided_by','decided_at']) = (to_jsonb(old) - array['status','decided_by','decided_at']) then
    return new;
  end if;
  if tg_table_name = 'pay_terms' then
    select min(effective_from) into next_d from pay_terms
      where employee_id = new.employee_id and status = 'approved' and effective_from > d and id <> new.id;
    hit_d := overlaps_locked_for(new.employee_id, d, next_d);
    if o is not null then
      select min(effective_from) into next_o from pay_terms
        where employee_id = old.employee_id and status = 'approved' and effective_from > o and id <> old.id;
      hit_o := overlaps_locked_for(old.employee_id, o, next_o);
    end if;
  elsif tg_table_name = 'catalog_amounts' then
    select min(effective_from) into next_d from catalog_amounts where job_id = new.job_id and effective_from > d;
    hit_d := overlaps_locked(d, next_d);
    if o is not null then
      select min(effective_from) into next_o from catalog_amounts where job_id = old.job_id and effective_from > o;
      hit_o := overlaps_locked(o, next_o);
    end if;
  elsif tg_table_name = 'settings' then
    select min(effective_from) into next_d from settings where key = new.key and effective_from > d;
    hit_d := overlaps_locked(d, next_d);
    if o is not null then
      select min(effective_from) into next_o from settings where key = old.key and effective_from > o;
      hit_o := overlaps_locked(o, next_o);
    end if;
  else
    raise exception 'guard_effective_date: unsupported table %', tg_table_name;
  end if;
  if hit_o then
    raise exception 'PERIOD_LOCKED: row effective % is part of locked history', o using errcode = 'P0001';
  end if;
  if hit_d then
    raise exception 'PERIOD_LOCKED: a change effective % would alter a locked payroll week', d using errcode = 'P0001';
  end if;
  return new;
end
$$;

create or replace function users_after_update() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if new.password_hash is distinct from old.password_hash
     or new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.email is distinct from old.email then
    delete from sessions where user_id = new.id;
  end if;
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active) then
    perform pg_advisory_xact_lock(hashtext('motonorte_last_owner'));
    if not exists (select 1 from users where role = 'owner' and active) then
      raise exception 'LAST_OWNER: at least one active owner is required' using errcode = 'P0001';
    end if;
  end if;
  return null;
end
$$;
