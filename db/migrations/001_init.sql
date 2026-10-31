-- 001_init.sql — Motonorte HR & Payroll base schema
-- Rules: docs/02-payroll-rules.md · Architecture: docs/03-architecture.md §3, §5, §6
-- Runs as the table owner (migration role). The app connects as `app_user` (non-owner), so RLS applies to it.
-- Portable to Supabase: no extensions beyond core PG15+.


-- ───────────────────────── Types ─────────────────────────
create type app_role_t     as enum ('staff', 'owner');
create type position_t     as enum ('staff', 'mechanic', 'technician');
create type weekday_t      as enum ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');
create type day_status_t   as enum ('F', 'H', 'A', 'R');
create type adj_kind_t     as enum ('allowance', 'deduction');
create type run_status_t   as enum ('draft', 'submitted', 'locked');
create type term_status_t  as enum ('proposed', 'approved', 'rejected');
create type holiday_type_t as enum ('regular', 'special');

-- ───────────────────────── Helpers ─────────────────────────
create function app_current_user_id() returns uuid
  language sql stable set search_path = public, pg_temp as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function period_start_of(d date) returns date
  language sql immutable set search_path = public, pg_temp as
$$ select d - (extract(isodow from d)::int - 1) $$;

create function weekday_of(d date) returns weekday_t
  language sql immutable set search_path = public, pg_temp as
$$ select ((array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from d)::int])::weekday_t $$;

-- ───────────────────────── Auth tables ─────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(email) and email like '%@%'),
  full_name     text not null check (length(trim(full_name)) > 0),
  password_hash text not null,
  role          app_role_t not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index users_email_key on users (email);

create table sessions (
  token_hash text primary key,              -- sha256 of the cookie token, hex
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip         text,
  user_agent text
);
create index sessions_user_idx on sessions (user_id);

create table login_attempts (
  id      bigint generated always as identity primary key,
  email   text not null,
  ip      text,
  success boolean not null,
  at      timestamptz not null default now()
);
create index login_attempts_email_at_idx on login_attempts (email, at desc);

-- Role of the current request's user (RLS uses only this). SECURITY DEFINER so it can read `users` under RLS.
create function app_role() returns app_role_t
  language sql stable security definer set search_path = public, pg_temp as
$$ select role from users where id = app_current_user_id() and active $$;

-- ───────────────────────── People ─────────────────────────
create table employees (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z]{1,3}[0-9]{3,4}$'),
  full_name  text not null check (length(trim(full_name)) > 0),
  rest_day   weekday_t not null,
  hire_date  date not null,
  end_date   date check (end_date is null or end_date >= hire_date),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default app_current_user_id() references users (id)
);

create table employee_private (
  employee_id     uuid primary key references employees (id),
  tin             text,
  sss_no          text,
  philhealth_no   text,
  pagibig_no      text,
  bank_name       text not null default 'RCBC',
  bank_account_no text
);

-- Position + daily rate, effective-dated together (PR-020)
create table pay_terms (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees (id),
  effective_from date not null,
  position       position_t not null,
  daily_rate     bigint not null check (daily_rate > 0),          -- centavos
  status         term_status_t not null default 'proposed',
  proposed_by    uuid default app_current_user_id() references users (id),
  decided_by     uuid references users (id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index pay_terms_one_active_per_day
  on pay_terms (employee_id, effective_from) where status <> 'rejected';

-- ───────────────────────── Catalog & settings ─────────────────────────
create table catalog_jobs (
  id     uuid primary key default gen_random_uuid(),
  code   text not null unique check (code ~ '^[A-Z0-9_]{2,20}$'),
  name   text not null check (length(trim(name)) > 0),
  active boolean not null default true
);

create table catalog_amounts (                                   -- PR-050
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references catalog_jobs (id),
  effective_from date not null,
  amount         bigint not null check (amount > 0),             -- centavos
  created_by     uuid default app_current_user_id() references users (id),
  unique (job_id, effective_from)
);

create table settings (                                          -- PR-030, integer hundredths (ADR-003)
  key              text not null check (key in ('rest_day_worked_multiplier', 'holiday_worked_multiplier',
                                                'holiday_unworked_multiplier', 'ot_multiplier')),
  effective_from   date not null,
  value_hundredths int  not null check (value_hundredths between 0 and 1000),
  primary key (key, effective_from)
);

create table holidays (
  date date primary key,
  name text not null,
  type holiday_type_t not null
);

-- ───────────────────────── Weekly inputs ─────────────────────────
create table attendance (                                        -- PR-022
  employee_id uuid not null references employees (id),
  date        date not null,
  status      day_status_t not null,
  ot_minutes  int not null default 0 check (ot_minutes between 0 and 960),
  updated_by  uuid default app_current_user_id() references users (id),
  updated_at  timestamptz not null default now(),
  primary key (employee_id, date),
  check (ot_minutes = 0 or status = 'F')                         -- PR-041
);

create table job_log (                                           -- PR-051
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  job_id         uuid not null references catalog_jobs (id),
  qty            int not null check (qty between 1 and 100),
  work_order_ref text,
  plate_no       text,
  created_by     uuid default app_current_user_id() references users (id),
  created_at     timestamptz not null default now()
);
create index job_log_date_idx on job_log (date);

create table adjustments (                                       -- PR-060
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees (id),
  period_start   date not null check (extract(isodow from period_start) = 1),
  kind           adj_kind_t not null,
  type           text not null check (type in ('meal', 'transport', 'cash_advance', 'clawback', 'correction', 'other')),
  amount         bigint not null check (amount > 0),             -- centavos, sign comes from kind
  reason         text not null check (length(trim(reason)) > 0),
  work_order_ref text,
  created_by     uuid default app_current_user_id() references users (id),
  created_at     timestamptz not null default now()
);
create index adjustments_period_idx on adjustments (period_start);

-- ───────────────────────── Payroll runs ─────────────────────────
create table payroll_runs (
  id             uuid primary key default gen_random_uuid(),
  period_start   date not null unique check (extract(isodow from period_start) = 1),
  payday         date generated always as (period_start + 6) stored,
  status         run_status_t not null default 'draft',
  input_hash     text not null,                                  -- hash of PeriodInput; mismatch = stale draft
  snapshot       jsonb not null,                                 -- settings + catalog amounts used
  generated_by   uuid references users (id),
  generated_at   timestamptz not null default now(),
  submitted_by   uuid references users (id),
  submitted_at   timestamptz,
  sent_back_note text,
  locked_by      uuid references users (id),
  locked_at      timestamptz,
  check ((status = 'locked') = (locked_at is not null))
);

create table payroll_lines (                                     -- PR-061
  run_id      uuid not null references payroll_runs (id) on delete cascade,
  employee_id uuid not null references employees (id),
  basic       bigint not null check (basic >= 0),
  base        bigint not null check (base >= 0),
  ot          bigint not null check (ot >= 0),
  incentive   bigint not null check (incentive >= 0),
  allowances  bigint not null check (allowances >= 0),
  deductions  bigint not null check (deductions >= 0),
  carried_in  bigint not null check (carried_in >= 0),
  gross       bigint not null check (gross >= 0),
  net         bigint not null check (net >= 0),
  carry_out   bigint not null check (carry_out >= 0),
  primary key (run_id, employee_id),
  check (gross = base + ot + incentive + allowances),
  check (net - carry_out = gross - deductions - carried_in),
  check (net = 0 or carry_out = 0)
);

create table payroll_items (                                     -- provenance for drill-down (US-031)
  id          bigint generated always as identity primary key,
  run_id      uuid not null references payroll_runs (id) on delete cascade,
  employee_id uuid not null references employees (id),
  date        date,
  kind        text not null check (kind in ('base', 'ot', 'incentive', 'allowance', 'deduction', 'carried_in')),
  amount      bigint not null check (amount >= 0),
  rule_id     text not null check (rule_id ~ '^PR-[0-9]{3}$'),
  source      jsonb not null default '{}'
);
create index payroll_items_run_emp_idx on payroll_items (run_id, employee_id);

-- ───────────────────────── Audit ─────────────────────────
create table audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  table_name text not null,
  row_id     text,
  action     text not null,
  old        jsonb,
  new        jsonb
);
create index audit_log_at_idx on audit_log (at desc);

create function mask_private(j jsonb) returns jsonb
  language sql immutable set search_path = public, pg_temp as
$$
  select coalesce(jsonb_object_agg(k,
           case when k in ('tin','sss_no','philhealth_no','pagibig_no','bank_account_no') and jsonb_typeof(v) = 'string'
                then to_jsonb('••••' || right(v #>> '{}', 4)) else v end), '{}'::jsonb)
  from jsonb_each(j) as e(k, v)
$$;

create function audit_row() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if tg_table_name = 'employee_private' then o := mask_private(o); n := mask_private(n); end if;
  if tg_table_name = 'users' then o := o - 'password_hash'; n := n - 'password_hash'; end if;
  insert into audit_log (actor, table_name, row_id, action, old, new)
  values (app_current_user_id(), tg_table_name,
          coalesce(n, o) ->> coalesce(tg_argv[0], 'id'), tg_op, o, n);
  return null;
end
$$;

-- US-004-ish: log when someone reveals a masked field (UX S-04)
create function log_reveal(p_employee_id uuid, p_field text) returns void
  language sql security definer set search_path = public, pg_temp as
$$
  insert into audit_log (actor, table_name, row_id, action, new)
  select app_current_user_id(), 'employee_private', p_employee_id::text, 'REVEAL', jsonb_build_object('field', p_field)
  where app_role() is not null
$$;

-- ───────────────────────── Lock guards (ADR-008, PR-071) ─────────────────────────
create function is_period_locked(p date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from payroll_runs where period_start = p and status = 'locked') $$;

create function last_locked_day() returns date
  language sql stable security definer set search_path = public, pg_temp as
$$ select max(period_start) + 6 from payroll_runs where status = 'locked' $$;

create function guard_locked_day() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare d date;
begin
  foreach d in array array[
      case when tg_op <> 'INSERT' then (to_jsonb(old) ->> tg_argv[0])::date end,
      case when tg_op <> 'DELETE' then (to_jsonb(new) ->> tg_argv[0])::date end] loop
    if d is not null and is_period_locked(period_start_of(d)) then
      raise exception 'PERIOD_LOCKED: % falls in a locked payroll week', d using errcode = 'P0001';
    end if;
  end loop;
  return coalesce(new, old);
end
$$;

-- Effective-dated config can't start inside or before a locked week
create function guard_effective_date() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare
  d date := (to_jsonb(new) ->> tg_argv[0])::date;
  o date := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> tg_argv[0])::date end;
begin
  if o <= last_locked_day() then
    raise exception 'PERIOD_LOCKED: row effective % is part of locked history', o using errcode = 'P0001';
  end if;
  if d <= last_locked_day() then
    raise exception 'PERIOD_LOCKED: effective date % is on or before the last locked week', d using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function guard_run_rows() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
begin
  if exists (select 1 from payroll_runs where id = coalesce(new.run_id, old.run_id) and status = 'locked') then
    raise exception 'RUN_LOCKED: payroll run is locked' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;

create function guard_run() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
begin
  if old.status = 'locked' then
    raise exception 'RUN_LOCKED: payroll run is locked' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;

-- ───────────────────────── Validation triggers ─────────────────────────
create function validate_attendance() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare e employees;
begin
  select * into e from employees where id = new.employee_id;
  if new.date < e.hire_date or (e.end_date is not null and new.date > e.end_date) then
    raise exception 'NOT_EMPLOYED: % is outside % employment dates', new.date, e.code using errcode = 'P0001';
  end if;
  if new.status = 'R' and weekday_of(new.date) <> e.rest_day then
    raise exception 'INVALID_REST_DAY: % rest day is %, not %', e.code, e.rest_day, weekday_of(new.date) using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := app_current_user_id();
  return new;
end
$$;

create function validate_job_log() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
begin
  if not exists (select 1 from catalog_jobs where id = new.job_id and active) then
    raise exception 'JOB_INACTIVE: job is not active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from catalog_amounts where job_id = new.job_id and effective_from <= new.date) then
    raise exception 'JOB_NO_AMOUNT: job has no amount on %', new.date using errcode = 'P0001';
  end if;
  return new;
end
$$;

create function stamp_pay_terms_decision() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
begin
  if new.status <> 'proposed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.decided_by := app_current_user_id();
    new.decided_at := now();
  end if;
  return new;
end
$$;

-- ───────────────────────── Triggers ─────────────────────────
create trigger attendance_locked  before insert or update or delete on attendance  for each row execute function guard_locked_day('date');
create trigger job_log_locked     before insert or update or delete on job_log     for each row execute function guard_locked_day('date');
create trigger adjustments_locked before insert or update or delete on adjustments for each row execute function guard_locked_day('period_start');
create trigger holidays_locked    before insert or update or delete on holidays    for each row execute function guard_locked_day('date');

create trigger pay_terms_effective       before insert or update on pay_terms       for each row execute function guard_effective_date('effective_from');
create trigger catalog_amounts_effective before insert or update on catalog_amounts for each row execute function guard_effective_date('effective_from');
create trigger settings_effective        before insert or update on settings        for each row execute function guard_effective_date('effective_from');

create trigger payroll_lines_locked before insert or update or delete on payroll_lines for each row execute function guard_run_rows();
create trigger payroll_items_locked before insert or update or delete on payroll_items for each row execute function guard_run_rows();
create trigger payroll_runs_locked  before update or delete on payroll_runs for each row execute function guard_run();

create trigger attendance_validate before insert or update on attendance for each row execute function validate_attendance();
create trigger job_log_validate    before insert or update on job_log    for each row execute function validate_job_log();
create trigger pay_terms_decision  before insert or update on pay_terms  for each row execute function stamp_pay_terms_decision();

create trigger audit after insert or update or delete on users            for each row execute function audit_row();
create trigger audit after insert or update or delete on employees        for each row execute function audit_row();
create trigger audit after insert or update or delete on employee_private for each row execute function audit_row('employee_id');
create trigger audit after insert or update or delete on pay_terms        for each row execute function audit_row();
create trigger audit after insert or update or delete on catalog_jobs     for each row execute function audit_row();
create trigger audit after insert or update or delete on catalog_amounts  for each row execute function audit_row();
create trigger audit after insert or update or delete on settings         for each row execute function audit_row('key');
create trigger audit after insert or update or delete on holidays         for each row execute function audit_row('date');
create trigger audit after insert or update or delete on attendance       for each row execute function audit_row('employee_id');
create trigger audit after insert or update or delete on job_log          for each row execute function audit_row();
create trigger audit after insert or update or delete on adjustments      for each row execute function audit_row();
create trigger audit after insert or update or delete on payroll_runs     for each row execute function audit_row();

-- ───────────────────────── Payroll run functions (§5) ─────────────────────────
-- The only write path to payroll_* tables. SECURITY DEFINER; each checks app_role() itself.

create function save_draft(p_period_start date, p_input_hash text, p_snapshot jsonb, p_lines jsonb, p_items jsonb)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as
$$
declare v_run uuid;
begin
  if app_role() is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_period_start <= (select max(period_start) from payroll_runs where status = 'locked') then
    raise exception 'PERIOD_BEFORE_LOCKED: % is on or before the latest locked week', p_period_start using errcode = 'P0001';
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

create function submit_run(p_run uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_role() is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update payroll_runs set status = 'submitted', submitted_by = app_current_user_id(), submitted_at = now(), sent_back_note = null
  where id = p_run and status = 'draft';
  if not found then raise exception 'RUN_NOT_DRAFT' using errcode = 'P0001'; end if;
end
$$;

create function send_back_run(p_run uuid, p_note text) returns void
  language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(length(trim(p_note)), 0) = 0 then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
  update payroll_runs set status = 'draft', sent_back_note = p_note, submitted_by = null, submitted_at = null
  where id = p_run and status = 'submitted';
  if not found then raise exception 'RUN_NOT_SUBMITTED' using errcode = 'P0001'; end if;
end
$$;

-- Caller (server) must verify input_hash is current before calling (stale-draft check).
create function lock_run(p_run uuid, p_expected_hash text) returns void
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
  update payroll_runs set status = 'locked', locked_by = app_current_user_id(), locked_at = now() where id = p_run;
end
$$;

-- carried_in for a period = each employee's carry_out from their latest locked line before it (PR-061)
create function carried_in_for(p_period_start date) returns table (employee_id uuid, carried_in bigint)
  language sql stable security definer set search_path = public, pg_temp as
$$
  select employee_id, carry_out from (
    select distinct on (l.employee_id) l.employee_id, l.carry_out
    from payroll_lines l join payroll_runs r on r.id = l.run_id
    where r.status = 'locked' and r.period_start < p_period_start
    order by l.employee_id, r.period_start desc) latest
  where carry_out > 0 and app_role() is not null
$$;

-- ───────────────────────── Auth functions (called before a user context exists) ─────────────────────────
create function auth_login_lookup(p_email text) returns table (id uuid, password_hash text, active boolean)
  language sql stable security definer set search_path = public, pg_temp as
$$ select id, password_hash, active from users where email = lower(p_email) $$;

create function auth_recent_failures(p_email text) returns int
  language sql stable security definer set search_path = public, pg_temp as
$$
  select count(*)::int from login_attempts
  where email = lower(p_email) and not success and at > now() - interval '15 minutes'
    and at > coalesce((select max(at) from login_attempts where email = lower(p_email) and success), '-infinity')
$$;

create function auth_record_attempt(p_email text, p_ip text, p_success boolean) returns void
  language sql security definer set search_path = public, pg_temp as
$$ insert into login_attempts (email, ip, success) values (lower(p_email), p_ip, p_success) $$;

create function auth_create_session(p_token_hash text, p_user uuid, p_expires timestamptz, p_ip text, p_ua text) returns void
  language sql security definer set search_path = public, pg_temp as
$$
  insert into sessions (token_hash, user_id, expires_at, ip, user_agent) values (p_token_hash, p_user, p_expires, p_ip, p_ua);
  update users set last_login_at = now() where id = p_user;
$$;

-- Returns the session's user if valid, and slides expiry.
create function auth_get_session(p_token_hash text, p_new_expires timestamptz)
  returns table (user_id uuid, email text, full_name text, role app_role_t)
  language sql security definer set search_path = public, pg_temp as
$$
  update sessions s set expires_at = p_new_expires
  from users u
  where s.token_hash = p_token_hash and s.expires_at > now() and u.id = s.user_id and u.active
  returning u.id, u.email, u.full_name, u.role
$$;

create function auth_delete_session(p_token_hash text) returns void
  language sql security definer set search_path = public, pg_temp as
$$ delete from sessions where token_hash = p_token_hash or expires_at < now() $$;

-- ───────────────────────── Reporting views (security_invoker → caller's RLS applies) ─────────────────────────
create view v_employee_current with (security_invoker = true) as
select e.*, t.position, t.daily_rate, t.effective_from as terms_since
from employees e
left join lateral (
  select position, daily_rate, effective_from from pay_terms
  where employee_id = e.id and status = 'approved' and effective_from <= (now() at time zone 'Asia/Manila')::date
  order by effective_from desc limit 1) t on true;

create view v_monthly_summary with (security_invoker = true) as        -- US-040, PR-011
select date_trunc('month', r.payday)::date as month, l.employee_id,
       sum(l.base) as base, sum(l.ot) as ot, sum(l.incentive) as incentive,
       sum(l.allowances) as allowances, sum(l.deductions) as deductions,
       sum(l.gross) as gross, sum(l.net) as net
from payroll_lines l join payroll_runs r on r.id = l.run_id
where r.status = 'locked'
group by 1, 2;

create view v_thirteenth_month with (security_invoker = true) as       -- US-041, PR-080
select extract(year from r.payday)::int as year, l.employee_id,
       sum(l.basic) as total_basic,
       floor((sum(l.basic) + 6) / 12)::bigint as thirteenth          -- half-up of total/12
from payroll_lines l join payroll_runs r on r.id = l.run_id
where r.status = 'locked'
group by 1, 2;

-- ───────────────────────── Default settings (PRD decisions) ─────────────────────────
insert into settings (key, effective_from, value_hundredths) values
  ('rest_day_worked_multiplier',  '2000-01-01', 100),
  ('holiday_worked_multiplier',   '2000-01-01', 100),
  ('holiday_unworked_multiplier', '2000-01-01', 0),
  ('ot_multiplier',               '2000-01-01', 125);

-- ───────────────────────── Row-level security ─────────────────────────
-- ENABLE (not FORCE): the app never connects as the owner; SECURITY DEFINER functions run as owner and bypass RLS by design.
alter table users            enable row level security;
alter table sessions         enable row level security;   -- no policies: functions only
alter table login_attempts   enable row level security;   -- no policies: functions only
alter table employees        enable row level security;
alter table employee_private enable row level security;
alter table pay_terms        enable row level security;
alter table catalog_jobs     enable row level security;
alter table catalog_amounts  enable row level security;
alter table settings         enable row level security;
alter table holidays         enable row level security;
alter table attendance       enable row level security;
alter table job_log          enable row level security;
alter table adjustments      enable row level security;
alter table payroll_runs     enable row level security;
alter table payroll_lines    enable row level security;
alter table payroll_items    enable row level security;
alter table audit_log        enable row level security;

create policy users_select on users for select using (id = app_current_user_id() or app_role() = 'owner');
create policy users_owner_write on users for insert with check (app_role() = 'owner');
create policy users_owner_update on users for update using (app_role() = 'owner') with check (app_role() = 'owner');

-- staff + owner, no delete
create policy employees_rw on employees for all using (app_role() in ('staff','owner')) with check (app_role() in ('staff','owner'));
create policy employee_private_rw on employee_private for all using (app_role() in ('staff','owner')) with check (app_role() in ('staff','owner'));

create policy pay_terms_select on pay_terms for select using (app_role() in ('staff','owner'));
create policy pay_terms_insert on pay_terms for insert
  with check (app_role() = 'owner' or (app_role() = 'staff' and status = 'proposed'));
create policy pay_terms_decide on pay_terms for update using (app_role() = 'owner') with check (app_role() = 'owner');

-- read for both, write owner only
create policy catalog_jobs_select    on catalog_jobs    for select using (app_role() in ('staff','owner'));
create policy catalog_jobs_owner     on catalog_jobs    for all    using (app_role() = 'owner') with check (app_role() = 'owner');
create policy catalog_amounts_select on catalog_amounts for select using (app_role() in ('staff','owner'));
create policy catalog_amounts_owner  on catalog_amounts for all    using (app_role() = 'owner') with check (app_role() = 'owner');
create policy settings_select        on settings        for select using (app_role() in ('staff','owner'));
create policy settings_owner         on settings        for all    using (app_role() = 'owner') with check (app_role() = 'owner');
create policy holidays_select        on holidays        for select using (app_role() in ('staff','owner'));
create policy holidays_owner         on holidays        for all    using (app_role() = 'owner') with check (app_role() = 'owner');

-- weekly inputs: both roles; locked weeks blocked by triggers
create policy attendance_rw  on attendance  for all using (app_role() in ('staff','owner')) with check (app_role() in ('staff','owner'));
create policy job_log_rw     on job_log     for all using (app_role() in ('staff','owner')) with check (app_role() in ('staff','owner'));
create policy adjustments_rw on adjustments for all using (app_role() in ('staff','owner')) with check (app_role() in ('staff','owner'));

-- payroll: read only; writes via functions
create policy payroll_runs_select  on payroll_runs  for select using (app_role() in ('staff','owner'));
create policy payroll_lines_select on payroll_lines for select using (app_role() in ('staff','owner'));
create policy payroll_items_select on payroll_items for select using (app_role() in ('staff','owner'));

create policy audit_select on audit_log for select using (app_role() in ('staff','owner'));

-- ───────────────────────── Grants for app_user ─────────────────────────
-- (role created outside migrations: db/init/ for Docker; Supabase uses its own roles)
revoke all on all tables in schema public from public;
revoke execute on all functions in schema public from public;
alter default privileges revoke execute on functions from public;   -- future migrations too
-- No temp tables for the app: blocks pg_temp shadowing of real tables (review TASK-001..004 blocker)
do $$ begin execute format('revoke temporary on database %I from public', current_database()); end $$;
grant usage on schema public to app_user;

-- users: password_hash is write-only for the app (login reads it via auth_login_lookup only)
grant select (id, email, full_name, role, active, created_at, last_login_at) on users to app_user;
grant insert (email, full_name, password_hash, role, active)                  on users to app_user;
grant update (full_name, password_hash, role, active)                         on users to app_user;
grant select, insert, update         on employees, employee_private, pay_terms, catalog_jobs, catalog_amounts, settings to app_user;
grant select, insert, update, delete on attendance, job_log, adjustments, holidays to app_user;
grant select                         on payroll_runs, payroll_lines, payroll_items, audit_log to app_user;
grant select                         on v_employee_current, v_monthly_summary, v_thirteenth_month to app_user;

grant execute on function
  app_current_user_id(), app_role(), period_start_of(date), weekday_of(date), is_period_locked(date), last_locked_day(),
  save_draft(date, text, jsonb, jsonb, jsonb), submit_run(uuid), send_back_run(uuid, text), lock_run(uuid, text),
  carried_in_for(date), log_reveal(uuid, text),
  auth_login_lookup(text), auth_recent_failures(text), auth_record_attempt(text, text, boolean),
  auth_create_session(text, uuid, timestamptz, text, text), auth_get_session(text, timestamptz), auth_delete_session(text)
to app_user;
-- Trigger functions and mask_private are invoked by the system; they need no grant to app_user.
grant execute on function mask_private(jsonb) to app_user;

