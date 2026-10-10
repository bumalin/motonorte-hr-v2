-- verify.sql — RLS, lock, and integrity checks. Run as the owner role AFTER migrations + seed:
--   npm run db:verify
-- Everything runs in one transaction and is rolled back. Any FAIL aborts with an error.

begin;

create schema t;
grant usage on schema t to app_user;

create function t.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL %', label; end if;
  raise notice 'PASS %', label;
end $$;

create function t.expect_fail(label text, q text, pat text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ~* pat then raise notice 'PASS %', label; return; end if;
    raise exception 'FAIL % — wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL % — no error raised', label;
end $$;

grant execute on all functions in schema t to app_user;

-- Test users (created as owner; the app would use create-user)
insert into users (id, email, full_name, password_hash, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local', 'Owner', 'x', 'owner'),
  ('00000000-0000-0000-0000-0000000000a2', 'staff@test.local', 'Staff', 'x', 'staff');

-- Start from no payroll runs, whatever the dev DB holds (rolled back at the end; lock triggers bypassed only here)
set session_replication_role = replica;  -- also skips FK cascades, so delete children explicitly
delete from payroll_items; delete from payroll_lines; delete from payroll_runs;
set session_replication_role = origin;

create table t.expected as select (select count(*) from employees) as employees;
grant select on t.expected to app_user;

set role app_user;

-- ── Anonymous (no app.user_id) ──
select set_config('app.user_id', '', false);
select t.ok('anon sees no employees', (select count(*) from employees) = 0);
select t.ok('anon gets no user names', user_name('00000000-0000-0000-0000-0000000000a1') is null);
select t.expect_fail('anon cannot save a draft',
  $q$ select save_draft('2026-10-05', 'h', '{}', '[]', '[]') $q$, 'FORBIDDEN');

-- ── Staff ──
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a2', false);
select t.ok('staff role resolves', app_role() = 'staff');
select t.expect_fail('app cannot create temp tables (no pg_temp shadowing)',
  $q$ create temp table payroll_runs (period_start date, status run_status_t) $q$, 'permission denied');
select t.ok('every function pins search_path with pg_temp last',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%', false)));
select t.ok('staff sees all employees', (select count(*) from employees) = (select employees from t.expected));
select t.expect_fail('staff cannot read password_hash',
  $q$ select password_hash from users $q$, 'permission denied');
select t.ok('staff sees only self in users', (select count(*) from users) = 1);
select t.ok('staff can see other users'' display names only via user_name()', user_name('00000000-0000-0000-0000-0000000000a1') = 'Owner');
select t.expect_fail('staff cannot change catalog amounts',
  $q$ insert into catalog_amounts (job_id, effective_from, amount) values ('00000000-0000-0000-0000-00000000b001', '2026-11-02', 99900) $q$,
  'row-level security');
select t.expect_fail('staff cannot change settings',
  $q$ insert into settings values ('ot_multiplier', '2026-11-02', 200) $q$, 'row-level security');
select t.expect_fail('staff cannot insert an approved rate',
  $q$ insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
      values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'mechanic', 70000, 'approved') $q$, 'row-level security');
insert into pay_terms (employee_id, effective_from, position, daily_rate)
  values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'mechanic', 70000);
insert into pay_terms (employee_id, effective_from, position, daily_rate)
  values ('00000000-0000-0000-0000-00000000a005', '2026-10-08', 'mechanic', 75000);  -- will be stranded by the Oct 5 lock
select t.ok('staff can propose a rate', exists (select 1 from pay_terms where effective_from = '2026-11-02' and status = 'proposed'));
update pay_terms set status = 'approved' where effective_from = '2026-11-02';   -- RLS: silently matches 0 rows
select t.ok('staff cannot approve a rate', (select status from pay_terms where effective_from = '2026-11-02') = 'proposed');

select t.expect_fail('staff cannot insert attendance',
  $q$ insert into attendance (employee_id,date,status) values ('00000000-0000-0000-0000-00000000a004','2026-11-02','F') $q$, 'ATTENDANCE_ADMIN_ONLY');
select t.expect_fail('staff cannot update attendance',
  $q$ update attendance set status='H' where date='2026-10-05' $q$, 'ATTENDANCE_ADMIN_ONLY');
select t.expect_fail('staff cannot delete attendance',
  $q$ delete from attendance where date='2026-10-05' $q$, 'ATTENDANCE_ADMIN_ONLY');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
update attendance set status = 'R' where employee_id = '00000000-0000-0000-0000-00000000a004' and date = '2026-10-05';
select t.ok('R (day off) may be recorded on any day (008)',
  (select status from attendance where employee_id = '00000000-0000-0000-0000-00000000a004' and date = '2026-10-05') = 'R');
update attendance set status = 'F' where employee_id = '00000000-0000-0000-0000-00000000a004' and date = '2026-10-05';
select t.expect_fail('daily allowance is capped at PHP 10,000',
  $q$ insert into pay_terms (employee_id, effective_from, position, daily_rate, daily_allowance)
      values ('00000000-0000-0000-0000-00000000a004', '2026-11-09', 'mechanic', 70000, 1000001) $q$, 'check constraint');
select t.expect_fail('OT only on full days',
  $q$ update attendance set status = 'H', ot_minutes = 60 where employee_id = '00000000-0000-0000-0000-00000000a004' and date = '2026-10-05' $q$,
  'check constraint');
select t.expect_fail('attendance before hire date rejected',
  $q$ insert into attendance values ('00000000-0000-0000-0000-00000000a004', '2024-12-30', 'F') $q$, 'NOT_EMPLOYED');
select t.expect_fail('staff cannot write payroll_runs directly',
  $q$ update payroll_runs set status = 'locked' $q$, 'permission denied');

select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a2', false);

-- Draft for Oct 5–11 (F07 values for mechanics; S002 carries a balance like F15)
select t.expect_fail('line totals must be consistent',
  $q$ select save_draft('2026-10-05', 'h0', '{}',
      '[{"employee_id":"00000000-0000-0000-0000-00000000a004","basic":390000,"base":390000,"ot":0,"incentive":20000,"allowances":0,"deductions":0,"carried_in":0,"gross":999,"net":999,"carry_out":0}]', '[]') $q$,
  'check constraint');

select save_draft('2026-10-05', 'hash-1', '{"settings":{}}',
  '[{"employee_id":"00000000-0000-0000-0000-00000000a004","basic":390000,"base":390000,"ot":0,"incentive":20000,"allowances":0,"deductions":0,"carried_in":0,"gross":410000,"net":410000,"carry_out":0},
    {"employee_id":"00000000-0000-0000-0000-00000000a005","basic":420000,"base":420000,"ot":0,"incentive":20000,"allowances":0,"deductions":0,"carried_in":0,"gross":440000,"net":440000,"carry_out":0},
    {"employee_id":"00000000-0000-0000-0000-00000000a006","basic":360000,"base":360000,"ot":0,"incentive":20000,"allowances":0,"deductions":0,"carried_in":0,"gross":380000,"net":380000,"carry_out":0},
    {"employee_id":"00000000-0000-0000-0000-00000000a002","basic":55000,"base":55000,"ot":0,"incentive":0,"allowances":0,"deductions":80000,"carried_in":0,"gross":55000,"net":0,"carry_out":25000}]',
  '[{"employee_id":"00000000-0000-0000-0000-00000000a004","date":"2026-10-06","kind":"incentive","amount":20000,"rule_id":"PR-053","source":{"pool":60000,"eligible":["M001","M002","M003"]}}]');
select t.ok('draft saved with 4 lines', (select count(*) from payroll_lines) = 4);
select t.ok('draft is regenerable', save_draft('2026-10-05', 'hash-2', '{"settings":{}}',
  (select jsonb_agg(to_jsonb(l) - 'run_id') from payroll_lines l), '[]') is not null);
select t.ok('regenerate replaced items', (select count(*) from payroll_items) = 0);

select submit_run((select id from payroll_runs where period_start = '2026-10-05'));
select t.ok('staff submitted', (select status from payroll_runs where period_start = '2026-10-05') = 'submitted');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select t.expect_fail('submitted week is frozen: attendance',
  $q$ update attendance set status = 'A' where date = '2026-10-06' $q$, 'PERIOD_LOCKED');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a2', false);
select t.expect_fail('submitted week is frozen: job log',
  $q$ insert into job_log (date, job_id, qty) values ('2026-10-07', '00000000-0000-0000-0000-00000000b001', 1) $q$, 'PERIOD_LOCKED');
select t.expect_fail('adjustment amounts are capped',
  $q$ insert into adjustments (employee_id, period_start, kind, type, amount, reason)
      values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'deduction', 'other', 100000001, 'typo') $q$, 'check constraint');
select t.expect_fail('staff cannot lock',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-10-05'), 'hash-2') $q$, 'FORBIDDEN');
select t.expect_fail('staff cannot send back',
  $q$ select send_back_run((select id from payroll_runs where period_start = '2026-10-05'), 'x') $q$, 'FORBIDDEN');

-- ── Owner ──
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select t.ok('owner sees all users', (select count(*) from users where email like '%@test.local') = 2);
select t.expect_fail('stale draft cannot be locked',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-10-05'), 'hash-OLD') $q$, 'RUN_STALE');
select lock_run((select id from payroll_runs where period_start = '2026-10-05'), 'hash-2');
select t.ok('owner locked the run', (select status from payroll_runs where period_start = '2026-10-05') = 'locked');

select t.expect_fail('locked week: attendance frozen',
  $q$ update attendance set status = 'A' where date = '2026-10-06' $q$, 'PERIOD_LOCKED');
select t.expect_fail('locked week: job log frozen',
  $q$ insert into job_log (date, job_id, qty) values ('2026-10-07', '00000000-0000-0000-0000-00000000b001', 1) $q$, 'PERIOD_LOCKED');
select t.expect_fail('locked week: adjustments frozen',
  $q$ insert into adjustments (employee_id, period_start, kind, type, amount, reason)
      values ('00000000-0000-0000-0000-00000000a004', '2026-10-05', 'deduction', 'clawback', 100, 'x') $q$, 'PERIOD_LOCKED');
select t.expect_fail('locked week: rate change cannot start inside it',
  $q$ insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
      values ('00000000-0000-0000-0000-00000000a004', '2026-10-08', 'mechanic', 70000, 'approved') $q$, 'PERIOD_LOCKED');
select t.expect_fail('locked week: incentive amount cannot start inside it',
  $q$ insert into catalog_amounts (job_id, effective_from, amount) values ('00000000-0000-0000-0000-00000000b001', '2026-10-09', 18000) $q$,
  'PERIOD_LOCKED');
select t.expect_fail('stranded proposal in a locked week cannot be approved',
  $q$ update pay_terms set status = 'approved' where effective_from = '2026-10-08' and status = 'proposed' $q$, 'PERIOD_LOCKED');
update pay_terms set status = 'rejected' where effective_from = '2026-10-08' and status = 'proposed';
select t.ok('stranded proposal in a locked week can be rejected',
  (select status from pay_terms where effective_from = '2026-10-08' and employee_id = '00000000-0000-0000-0000-00000000a005') = 'rejected');
select t.expect_fail('rejecting cannot smuggle in a rate change',
  $q$ update pay_terms set status = 'proposed', daily_rate = 1 where effective_from = '2026-10-08' and employee_id = '00000000-0000-0000-0000-00000000a005' $q$, 'PERIOD_LOCKED');
select t.expect_fail('locked run cannot be regenerated',
  $q$ select save_draft('2026-10-05', 'h', '{}', '[]', '[]') $q$, 'RUN_NOT_DRAFT');
select t.expect_fail('locked run cannot be locked again',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-10-05'), 'hash-2') $q$, 'RUN_NOT_LOCKABLE');

insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
  values ('00000000-0000-0000-0000-00000000a004', '2026-10-12', 'mechanic', 70000, 'approved');
select t.ok('rate change after locked week allowed, decision stamped',
  (select decided_by from pay_terms where effective_from = '2026-10-12') = '00000000-0000-0000-0000-0000000000a1');

select t.ok('carry-over flows to next week',
  (select carried_in from carried_in_for('2026-10-12') where employee_id = '00000000-0000-0000-0000-00000000a002') = 25000);
select t.expect_fail('a backdated rate change cannot reach into a locked week',
  $q$ insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
      values ('00000000-0000-0000-0000-00000000a004', '2026-09-14', 'mechanic', 1, 'approved') $q$, 'PERIOD_LOCKED');
select t.expect_fail('a backdated incentive amount cannot reach into a locked week',
  $q$ insert into catalog_amounts (job_id, effective_from, amount) values ('00000000-0000-0000-0000-00000000b001', '2026-09-01', 1) $q$,
  'PERIOD_LOCKED');
select t.expect_fail('effective-dated rows cannot be moved out of locked history',
  $q$ update pay_terms set effective_from = '2026-11-09' where effective_from = '2025-01-01'
      and employee_id = '00000000-0000-0000-0000-00000000a004' $q$, 'PERIOD_LOCKED');

-- Out-of-order locking is blocked
select save_draft('2026-10-19', 'h19', '{}', '[]', '[]');
select save_draft('2026-10-12', 'h12', '{}', '[]', '[]');
select t.expect_fail('draft cannot be locked without submit',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-10-19'), 'h19') $q$, 'RUN_NOT_LOCKABLE');
select submit_run((select id from payroll_runs where period_start = '2026-10-19'));
select t.expect_fail('cannot lock a week while an earlier week is unlocked',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-10-19'), 'h19') $q$, 'EARLIER_RUN_UNLOCKED');
-- Lock Oct 12 with no line for S002: S002's balance must still carry into Oct 19
select submit_run((select id from payroll_runs where period_start = '2026-10-12'));
select lock_run((select id from payroll_runs where period_start = '2026-10-12'), 'h12');
select t.ok('carry-over survives a week the employee is absent from',
  (select carried_in from carried_in_for('2026-10-19') where employee_id = '00000000-0000-0000-0000-00000000a002') = 25000);
select t.expect_fail('locked run cannot be sent back',
  $q$ select send_back_run((select id from payroll_runs where period_start = '2026-10-05'), 'x') $q$, 'RUN_NOT_SUBMITTED');

-- 009: historical weeks before locked history can be generated and locked, unless they'd strand a carry-over
select t.ok('historical draft before a locked week is allowed', save_draft('2026-09-28', 'h28', '{}',
  '[{"employee_id":"00000000-0000-0000-0000-00000000a002","basic":0,"base":0,"ot":0,"incentive":0,"allowances":0,"deductions":100,"carried_in":0,"gross":0,"net":0,"carry_out":100}]',
  '[]') is not null);
select submit_run((select id from payroll_runs where period_start = '2026-09-28'));
select t.expect_fail('historical week cannot strand a carry-over behind locked weeks',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-09-28'), 'h28') $q$, 'HISTORICAL_CARRY');
select send_back_run((select id from payroll_runs where period_start = '2026-09-28'), 'no carry');
select save_draft('2026-09-28', 'h28b', '{}', '[]', '[]');
select submit_run((select id from payroll_runs where period_start = '2026-09-28'));
select lock_run((select id from payroll_runs where period_start = '2026-09-28'), 'h28b');
select t.ok('historical week locked', (select status from payroll_runs where period_start = '2026-09-28') = 'locked');
select t.ok('later carry-over unchanged by the historical week',
  (select carried_in from carried_in_for('2026-10-19') where employee_id = '00000000-0000-0000-0000-00000000a002') = 25000);

-- 010: a backfilled week between a carry and the later locked week that deducted it gets no carry (no double deduction)
reset role;
set session_replication_role = replica;
insert into payroll_runs (id, period_start, status, input_hash, snapshot, locked_at) values
  ('00000000-0000-0000-0000-0000000c0803', '2026-08-03', 'locked', 'x', '{}', now()),
  ('00000000-0000-0000-0000-0000000c0817', '2026-08-17', 'locked', 'x', '{}', now());
insert into payroll_lines (run_id, employee_id, basic, base, ot, incentive, allowances, deductions, carried_in, gross, net, carry_out) values
  ('00000000-0000-0000-0000-0000000c0803', '00000000-0000-0000-0000-00000000a002', 0, 0, 0, 0, 0, 700, 0, 0, 0, 700),
  ('00000000-0000-0000-0000-0000000c0817', '00000000-0000-0000-0000-00000000a002', 1000, 1000, 0, 0, 0, 0, 700, 1000, 300, 0);
set session_replication_role = origin;
select t.ok('backfilled week does not re-deduct a carry a later locked week took',
  not exists (select 1 from carried_in_for('2026-08-10') where employee_id = '00000000-0000-0000-0000-00000000a002'));
set session_replication_role = replica;
delete from payroll_lines where run_id in ('00000000-0000-0000-0000-0000000c0803', '00000000-0000-0000-0000-0000000c0817');
delete from payroll_runs where id in ('00000000-0000-0000-0000-0000000c0803', '00000000-0000-0000-0000-0000000c0817');
set session_replication_role = origin;
set role app_user;

-- 010: an earlier hire date's starting terms can be added after the employee was paid (their locked weeks untouched)
insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
  values ('00000000-0000-0000-0000-00000000a004', '2024-12-02', 'mechanic', 65000, 'approved');
-- 012: hired on the last day of a locked week; copying their rate further back only touches days they didn't work
reset role;
set session_replication_role = replica;
insert into employees (id, code, full_name, rest_day, hire_date) values
  ('00000000-0000-0000-0000-0000000000e9', 'Z009', 'Late hire', 'sun', '2026-10-11');
insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
  values ('00000000-0000-0000-0000-0000000000e9', '2026-10-11', 'staff', 50000, 'approved');
insert into attendance (employee_id, date, status) values ('00000000-0000-0000-0000-0000000000e9', '2026-10-11', 'R');
set session_replication_role = origin;
set role app_user;
insert into pay_terms (employee_id, effective_from, position, daily_rate, status)
  values ('00000000-0000-0000-0000-0000000000e9', '2026-08-10', 'staff', 50000, 'approved');
select t.ok('earlier hire date allowed when the locked week only has later days',
  exists (select 1 from pay_terms where employee_id = '00000000-0000-0000-0000-0000000000e9' and effective_from = '2026-08-10'));
select t.expect_fail('but changing the rate of a worked locked day is still refused',
  $q$ update pay_terms set daily_rate = 1 where employee_id = '00000000-0000-0000-0000-0000000000e9' and effective_from = '2026-10-11' $q$,
  'PERIOD_LOCKED');
-- 013: the Owner can reopen only the latest locked week, with a reason
select t.expect_fail('only the latest locked week can be reopened',
  $q$ select unlock_run((select id from payroll_runs where period_start = '2026-10-05'), 'x') $q$, 'RUN_NOT_LATEST');
select t.expect_fail('reopening needs a reason',
  $q$ select unlock_run((select id from payroll_runs where period_start = '2026-10-12'), ' ') $q$, 'NOTE_REQUIRED');
select unlock_run((select id from payroll_runs where period_start = '2026-10-12'), 'missed OT');
select t.ok('reopened week is a draft with the reason',
  (select status = 'draft' and sent_back_note like '%missed OT' and locked_at is null from payroll_runs where period_start = '2026-10-12'));
select t.ok('reopened week is editable again', not is_period_locked('2026-10-12'));
select t.expect_fail('a later week cannot be locked while the reopened week is open',
  $q$ select lock_run((select id from payroll_runs where period_start = '2026-10-19'), 'h19') $q$, 'EARLIER_RUN_UNLOCKED');
select submit_run((select id from payroll_runs where period_start = '2026-10-12'));
select lock_run((select id from payroll_runs where period_start = '2026-10-12'), 'h12');
select t.ok('reopened week re-locked', (select status from payroll_runs where period_start = '2026-10-12') = 'locked');
select t.expect_fail('a locked run still cannot be edited directly',
  $q$ update payroll_runs set status = 'draft' where period_start = '2026-10-12' $q$, 'permission denied|RUN_LOCKED');

-- 013: back pay is the only addition, Owner only
insert into adjustments (employee_id, period_start, kind, type, amount, reason)
  values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'allowance', 'back_pay', 5000, 'missed Sep 22');
select t.ok('owner adds back pay', exists (select 1 from adjustments where type = 'back_pay'));
select t.expect_fail('other additions are refused',
  $q$ insert into adjustments (employee_id, period_start, kind, type, amount, reason)
      values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'allowance', 'meal', 5000, 'x') $q$, 'ADDITION_OWNER_ONLY');
select t.expect_fail('back pay cannot be a deduction',
  $q$ insert into adjustments (employee_id, period_start, kind, type, amount, reason)
      values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'deduction', 'back_pay', 5000, 'x') $q$, 'ADDITION_OWNER_ONLY');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a2', false);
select t.expect_fail('staff cannot reopen a week',
  $q$ select unlock_run((select id from payroll_runs where period_start = '2026-10-12'), 'x') $q$, 'FORBIDDEN');
select t.expect_fail('staff cannot add back pay',
  $q$ insert into adjustments (employee_id, period_start, kind, type, amount, reason)
      values ('00000000-0000-0000-0000-00000000a004', '2026-11-02', 'allowance', 'back_pay', 5000, 'x') $q$, 'ADDITION_OWNER_ONLY');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);

-- 014: a job set to one mechanic is credited to them automatically; a shared job goes to the pool
update catalog_jobs set specialist_id = '00000000-0000-0000-0000-00000000a005' where id = '00000000-0000-0000-0000-00000000b001';
insert into job_log (date, job_id, qty, employee_id) values ('2026-11-03', '00000000-0000-0000-0000-00000000b001', 1, '00000000-0000-0000-0000-00000000a004');
select t.ok('job for one mechanic is credited to that mechanic, whatever was sent',
  (select employee_id from job_log where date = '2026-11-03') = '00000000-0000-0000-0000-00000000a005');
update catalog_jobs set specialist_id = null where id = '00000000-0000-0000-0000-00000000b001';
insert into job_log (date, job_id, qty, employee_id) values ('2026-11-04', '00000000-0000-0000-0000-00000000b001', 1, '00000000-0000-0000-0000-00000000a005');
select t.ok('shared job goes to the pool', (select employee_id from job_log where date = '2026-11-04') is null);
select t.ok('reassigning a job does not move entries already logged',
  (select employee_id from job_log where date = '2026-11-03') = '00000000-0000-0000-0000-00000000a005');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a2', false);
update catalog_jobs set specialist_id = '00000000-0000-0000-0000-00000000a004' where id = '00000000-0000-0000-0000-00000000b001';
select t.ok('staff cannot change who earns a job',
  (select specialist_id from catalog_jobs where id = '00000000-0000-0000-0000-00000000b001') is null);
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);

select t.ok('starting terms copied to an earlier hire date after locks',
  exists (select 1 from pay_terms where employee_id = '00000000-0000-0000-0000-00000000a004' and effective_from = '2024-12-02'));

-- Audit
update employee_private set tin = '123-456-789-000' where employee_id = '00000000-0000-0000-0000-00000000a004';
select t.ok('audit masks sensitive fields',
  (select new ->> 'tin' from audit_log where table_name = 'employee_private' and action = 'UPDATE' order by id desc limit 1) = '••••-000');
select t.ok('audit records the actor',
  (select actor from audit_log where table_name = 'employee_private' order by id desc limit 1) = '00000000-0000-0000-0000-0000000000a1');
select t.ok('audit never stores password hashes',
  not exists (select 1 from audit_log where table_name = 'users' and (new ? 'password_hash' or old ? 'password_hash')));
select t.expect_fail('audit log is append-only',
  $q$ delete from audit_log $q$, 'permission denied');
select log_reveal('00000000-0000-0000-0000-00000000a004', 'tin');
select t.ok('reveal is logged', exists (select 1 from audit_log where action = 'REVEAL'));

-- Reports (locked runs only)
select t.ok('13th-month view reads locked runs',
  (select total_basic from v_thirteenth_month where year = 2026 and employee_id = '00000000-0000-0000-0000-00000000a004') = 390000);
select t.ok('monthly summary by payday month',
  (select net from v_monthly_summary where month = '2026-10-01' and employee_id = '00000000-0000-0000-0000-00000000a005') = 440000);
select t.ok('current terms view', (select daily_rate from v_employee_current where code = 'M002') = 70000);

-- Auth functions
select auth_record_attempt('Staff@Test.local', '127.0.0.1', false);
select auth_record_attempt('staff@test.local', '127.0.0.1', false);
select t.ok('failed logins counted (case-insensitive)', auth_recent_failures('STAFF@test.local') = 2);
select auth_record_attempt('staff@test.local', '127.0.0.1', true);
select t.ok('success resets the failure window', auth_recent_failures('staff@test.local') = 0);
-- 006: lockout-proof throttle
select auth_record_attempt('victim@test.local', '10.0.0.66', false) from generate_series(1, 5);
select t.ok('5 failures lock that email from that IP', auth_throttle('victim@test.local', '10.0.0.66') = 'email_ip');
select t.ok('...but not the same email from another IP (no remote lockout)', auth_throttle('victim@test.local', '10.0.0.1') = 'ok');
select auth_record_attempt('spray' || g || '@test.local', '10.0.0.99', false) from generate_series(1, 20) g;
select t.ok('20 failures from one IP block that IP for any email', auth_throttle('someone@test.local', '10.0.0.99') = 'ip');
reset role;
insert into login_attempts (email, ip, success, at) values ('victim@test.local', '10.0.0.7', true, now() - interval '3 days');
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select auth_record_attempt('victim@test.local', '10.9.' || g || '.1', false) from generate_series(1, 50) g;
select t.ok('distributed guessing hits the per-email ceiling for unknown IPs', auth_throttle('victim@test.local', '10.0.0.1') = 'email');
select t.ok('...but the owner''s trusted IP (recent success) is exempt — no remote lockout', auth_throttle('victim@test.local', '10.0.0.7') = 'ok');
reset role;
insert into login_attempts (email, ip, success, at) values ('victim@test.local', '10.0.0.8', true, now() - interval '29 days' - interval '23 hours');
update login_attempts set at = now() - interval '31 days' where email = 'victim@test.local' and ip = '10.0.0.8' and success;
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select t.ok('a success older than 30 days no longer makes an IP trusted', auth_throttle('victim@test.local', '10.0.0.8') = 'email');
select auth_record_attempt('reset@test.local', null, false) from generate_series(1, 4);
select t.ok('no-IP (direct/dev) attempts are throttled per email', auth_throttle('reset@test.local', null) = 'ok');
select auth_record_attempt('reset@test.local', null, false);
select t.ok('5th no-IP failure locks that email', auth_throttle('reset@test.local', null) = 'email_ip');
reset role;
update login_attempts set at = at - interval '1 second' where email = 'reset@test.local';
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select auth_record_attempt('reset@test.local', null, true);
select t.ok('a successful sign-in resets that email''s failure count', auth_throttle('reset@test.local', null) = 'ok');
reset role;
insert into login_attempts (email, ip, success, at) values ('old@test.local', '10.0.0.5', false, now() - interval '31 days'),
  ('recent@test.local', '10.0.0.5', false, now() - interval '2 days');
insert into sessions (token_hash, user_id, expires_at) values ('expired-tok', '00000000-0000-0000-0000-0000000000a2', now() - interval '1 minute');
insert into sessions (token_hash, user_id, expires_at) values ('live-tok', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour');
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select auth_housekeeping();
reset role;
select t.ok('housekeeping removes >30-day attempts and expired sessions',
  not exists (select 1 from login_attempts where email = 'old@test.local') and not exists (select 1 from sessions where token_hash = 'expired-tok'));
select t.ok('housekeeping keeps recent attempts (attack trail)', exists (select 1 from login_attempts where email = 'recent@test.local'));
select t.ok('housekeeping keeps unexpired sessions', exists (select 1 from sessions where token_hash = 'live-tok'));
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a2', false);
select auth_change_password('scrypt$65536$8$1$newsalt$newhashnewhashnewhash');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
reset role;
select t.ok('users can change their own password', (select password_hash from users where id = '00000000-0000-0000-0000-0000000000a2') like 'scrypt$65536$8$1$newsalt%');
set role app_user;
select set_config('app.user_id', '', false);
select t.expect_fail('anonymous cannot change a password', $q$ select auth_change_password('scrypt$x$y$z$aaaaaaaaaaaaaaaaaaaa') $q$, 'FORBIDDEN');
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select auth_create_session('tokhash', '00000000-0000-0000-0000-0000000000a2', now() + interval '12 hours', '127.0.0.1', 'test');
select t.ok('valid session returns user', (select role from auth_get_session('tokhash', now() + interval '12 hours')) = 'staff');
select t.expect_fail('sessions table not directly readable',
  $q$ select * from sessions $q$, 'permission denied');
select auth_delete_session('tokhash');

-- 002: account changes end sessions; last owner can't be removed
reset role;
select auth_create_session('tok-staff', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour', null, null);
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
update users set role = 'owner' where id = '00000000-0000-0000-0000-0000000000a2';
select t.ok('role change ends that user''s sessions', not exists (select 1 from auth_get_session('tok-staff', now() + interval '1 hour')));
update users set role = 'staff' where id = '00000000-0000-0000-0000-0000000000a2';
reset role;
select auth_create_session('tok-staff2', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour', null, null);
select auth_create_session('tok-staff3', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour', null, null);
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
update users set password_hash = 'y' where id = '00000000-0000-0000-0000-0000000000a2';
select t.ok('password reset ends that user''s sessions', not exists (select 1 from auth_get_session('tok-staff2', now() + interval '1 hour')));
reset role;
select auth_create_session('tok-staff4', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour', null, null);
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
update users set active = false where id = '00000000-0000-0000-0000-0000000000a2';
reset role;
select t.ok('deactivation ends that user''s sessions', not exists (select 1 from sessions where token_hash = 'tok-staff4'));
set role app_user;
select set_config('app.user_id', '00000000-0000-0000-0000-0000000000a1', false);
select t.expect_fail('cannot deactivate the last active owner',
  $q$ update users set active = false where role = 'owner' $q$, 'LAST_OWNER');
reset role;
insert into sessions (token_hash, user_id, expires_at) values ('email-tok', '00000000-0000-0000-0000-0000000000a2', now() + interval '1 hour');
update users set email = 'renamed@test.local' where id = '00000000-0000-0000-0000-0000000000a2';
select t.ok('email change signs the user out', not exists (select 1 from sessions where token_hash = 'email-tok'));
set role app_user;
select t.ok('logout invalidates session', not exists (select 1 from auth_get_session('tokhash', now() + interval '12 hours')));

reset role;
do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
