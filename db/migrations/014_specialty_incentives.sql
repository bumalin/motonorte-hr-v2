-- 014_specialty_incentives.sql — Owner decisions 2026-09-28 (rule PR-055)
-- Each incentive job is either shared (the daily pool, as before) or for one specific mechanic. A specific job is
-- credited to that mechanic automatically when logged; they earn qty × amount in full, whatever their attendance
-- that day, and it stays out of the pool. The mechanic is recorded on each log entry, so reassigning the job later
-- doesn't move money already logged.

alter table catalog_jobs add column specialist_id uuid references employees (id);   -- null = shared pool
alter table job_log      add column employee_id   uuid references employees (id);   -- set by the trigger below

create or replace function validate_job_log() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare j catalog_jobs;
begin
  select * into j from catalog_jobs where id = new.job_id;
  if j.id is null or not j.active then
    raise exception 'JOB_INACTIVE: job is not active' using errcode = 'P0001';
  end if;
  if not exists (select 1 from catalog_amounts where job_id = new.job_id and effective_from <= new.date) then
    raise exception 'JOB_NO_AMOUNT: job has no amount on %', new.date using errcode = 'P0001';
  end if;
  new.employee_id := j.specialist_id;
  if new.employee_id is not null and not exists (select 1 from employees where id = new.employee_id
       and hire_date <= new.date and (end_date is null or end_date >= new.date)) then
    raise exception 'NOT_EMPLOYED: the mechanic for this job is not employed on %', new.date using errcode = 'P0001';
  end if;
  return new;
end
$$;
