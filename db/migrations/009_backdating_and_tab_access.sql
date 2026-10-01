-- 009_backdating_and_tab_access.sql — Owner requests 2026-09-27
-- 1. Historical payroll: a draft may be generated for ANY week whose own run isn't submitted/locked, including weeks
--    before the latest locked week. Locked history stays immutable: effective-dated rows may be dated in the past as long
--    as they don't change what a locked week used, and a historical week can't be locked if it would carry a balance
--    into weeks that are already locked (that balance would never be deducted).
-- 2. Per-user tab access for staff (owners always see every tab).

-- ── 1. Backdating ──
-- True if [p_from, p_to) touches any day of a locked week (p_to null = open-ended)
create function overlaps_locked(p_from date, p_to date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from payroll_runs where status = 'locked'
                  and period_start + 6 >= p_from and (p_to is null or period_start < p_to)) $$;

-- An effective-dated row applies from its date until the next row for the same thing (same employee / job / key).
-- Reject any insert or update whose old or new span covers a locked week.
create or replace function guard_effective_date() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare
  d date := (to_jsonb(new) ->> tg_argv[0])::date;
  o date := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> tg_argv[0])::date end;
  next_d date;
  next_o date;
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
    if o is not null then
      select min(effective_from) into next_o from pay_terms
        where employee_id = old.employee_id and status = 'approved' and effective_from > o and id <> old.id;
    end if;
  elsif tg_table_name = 'catalog_amounts' then
    select min(effective_from) into next_d from catalog_amounts where job_id = new.job_id and effective_from > d;
    if o is not null then
      select min(effective_from) into next_o from catalog_amounts where job_id = old.job_id and effective_from > o;
    end if;
  elsif tg_table_name = 'settings' then
    select min(effective_from) into next_d from settings where key = new.key and effective_from > d;
    if o is not null then
      select min(effective_from) into next_o from settings where key = old.key and effective_from > o;
    end if;
  else
    raise exception 'guard_effective_date: unsupported table %', tg_table_name;
  end if;
  if o is not null and overlaps_locked(o, next_o) then
    raise exception 'PERIOD_LOCKED: row effective % is part of locked history', o using errcode = 'P0001';
  end if;
  if overlaps_locked(d, next_d) then
    raise exception 'PERIOD_LOCKED: a change effective % would alter a locked payroll week', d using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Drafts for any week that isn't itself submitted/locked (ON CONFLICT … WHERE status = 'draft' already refuses those)
create or replace function save_draft(p_period_start date, p_input_hash text, p_snapshot jsonb, p_lines jsonb, p_items jsonb)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as
$$
declare v_run uuid;
begin
  if app_role() is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from payroll_runs where period_start = p_period_start and status <> 'draft') then
    raise exception 'RUN_NOT_DRAFT: run for % is submitted or locked', p_period_start using errcode = 'P0001';
  end if;

  insert into payroll_runs (period_start, input_hash, snapshot, generated_by)
  values (p_period_start, p_input_hash, p_snapshot, app_current_user_id())
  on conflict (period_start) do update
    set input_hash = excluded.input_hash, snapshot = excluded.snapshot,
        generated_by = excluded.generated_by, generated_at = now(),
        status = 'draft', submitted_by = null, submitted_at = null
    where payroll_runs.status = 'draft'
  returning id into v_run;

  if v_run is null then
    raise exception 'RUN_NOT_DRAFT: run for % is submitted or locked', p_period_start using errcode = 'P0001';
  end if;

  delete from payroll_items where run_id = v_run;
  delete from payroll_lines where run_id = v_run;

  insert into payroll_lines (run_id, employee_id, basic, base, ot, incentive, allowances, deductions, carried_in, gross, net, carry_out)
  select v_run, employee_id, basic, base, ot, incentive, allowances, deductions, carried_in, gross, net, carry_out
  from jsonb_to_recordset(p_lines) as x(employee_id uuid, basic bigint, base bigint, ot bigint, incentive bigint,
       allowances bigint, deductions bigint, carried_in bigint, gross bigint, net bigint, carry_out bigint);

  insert into payroll_items (run_id, employee_id, date, kind, amount, rule_id, source)
  select v_run, employee_id, date, kind, amount, rule_id, coalesce(source, '{}')
  from jsonb_to_recordset(p_items) as x(employee_id uuid, date date, kind text, amount bigint, rule_id text, source jsonb);

  return v_run;
end
$$;

create or replace function lock_run(p_run uuid, p_expected_hash text) returns void
  language plpgsql security definer set search_path = public, pg_temp as
$$
declare r payroll_runs;
begin
  if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into r from payroll_runs where id = p_run for update;
  if r.id is null or r.status <> 'submitted' then raise exception 'RUN_NOT_LOCKABLE' using errcode = 'P0001'; end if;
  if r.input_hash <> p_expected_hash then raise exception 'RUN_STALE: regenerate the draft first' using errcode = 'P0001'; end if;
  if exists (select 1 from payroll_runs where period_start < r.period_start and status <> 'locked') then
    raise exception 'EARLIER_RUN_UNLOCKED: lock earlier weeks first' using errcode = 'P0001';
  end if;
  -- A historical week's unpaid balance could never reach the later weeks that are already locked
  if exists (select 1 from payroll_runs where period_start > r.period_start and status = 'locked')
     and exists (select 1 from payroll_lines where run_id = p_run and carry_out > 0) then
    raise exception 'HISTORICAL_CARRY: deductions exceed pay in a week before a locked week' using errcode = 'P0001';
  end if;
  update payroll_runs set status = 'locked', locked_by = app_current_user_id(), locked_at = now() where id = p_run;
end
$$;

-- ── 2. Tab access ──
alter table users add column tabs text[] not null
  default array['dashboard','week','employees','payroll','catalog','reports','settings','audit']
  check (tabs <@ array['dashboard','week','employees','payroll','catalog','reports','settings','audit']);

drop function auth_get_session(text, timestamptz);
create function auth_get_session(p_token_hash text, p_new_expires timestamptz)
  returns table (user_id uuid, email text, full_name text, role app_role_t, tabs text[])
  language sql security definer set search_path = public, pg_temp as
$$
  update sessions s set expires_at = p_new_expires
  from users u
  where s.token_hash = p_token_hash and s.expires_at > now() and u.id = s.user_id and u.active
  returning u.id, u.email, u.full_name, u.role, u.tabs
$$;
revoke execute on function auth_get_session(text, timestamptz) from public;
grant execute on function auth_get_session(text, timestamptz) to app_user;
grant execute on function overlaps_locked(date, date) to app_user;
revoke execute on function overlaps_locked(date, date) from public;

-- The Owner edits a user's name, email, role and tabs (RLS users_owner_update still limits writes to owners)
grant select (tabs) on users to app_user;
grant insert (tabs) on users to app_user;
grant update (email, tabs) on users to app_user;
