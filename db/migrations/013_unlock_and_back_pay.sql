-- 013_unlock_and_back_pay.sql — Owner decision 2026-09-28
-- 1. The Owner may reopen the LATEST locked week (reason required, audited). It goes back to draft; later drafts that
--    took its carry-over become stale through their input hash, and later weeks can't be locked until it is re-locked.
-- 2. Back pay: the only kind of addition adjustment (money missed in an already-locked week), Owner only.
--    Everything else stays a deduction (PR-060). Enforced here, not only in the app.

create or replace function guard_run() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
begin
  -- unlock_run() sets this for its own single update (app_user can't UPDATE payroll_runs directly)
  if old.status = 'locked' and coalesce(current_setting('app.unlocking', true), '') <> old.id::text then
    raise exception 'RUN_LOCKED: payroll run is locked' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;

create function unlock_run(p_run uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as
$$
declare r payroll_runs;
begin
  if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then raise exception 'NOTE_REQUIRED' using errcode = 'P0001'; end if;
  select * into r from payroll_runs where id = p_run for update;
  if r.id is null or r.status <> 'locked' then raise exception 'RUN_NOT_LOCKED' using errcode = 'P0001'; end if;
  if exists (select 1 from payroll_runs where status = 'locked' and period_start > r.period_start) then
    raise exception 'RUN_NOT_LATEST: only the most recent locked week can be reopened' using errcode = 'P0001';
  end if;
  perform set_config('app.unlocking', p_run::text, true);
  update payroll_runs set status = 'draft', locked_by = null, locked_at = null, submitted_by = null, submitted_at = null,
    sent_back_note = 'Reopened by the Owner: ' || trim(p_reason)
  where id = p_run;
  perform set_config('app.unlocking', '', true);
end
$$;
revoke execute on function unlock_run(uuid, text) from public;
grant execute on function unlock_run(uuid, text) to app_user;

alter table adjustments drop constraint adjustments_type_check;
alter table adjustments add constraint adjustments_type_check
  check (type in ('meal', 'transport', 'cash_advance', 'clawback', 'correction', 'other', 'back_pay'));

create function validate_adjustment() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
begin
  if new.kind = 'allowance' and (new.type <> 'back_pay' or app_role() is distinct from 'owner') then
    raise exception 'ADDITION_OWNER_ONLY: only the Owner can add back pay' using errcode = 'P0001';
  end if;
  if new.kind = 'deduction' and new.type = 'back_pay' then
    raise exception 'ADDITION_OWNER_ONLY: back pay is an addition' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger adjustments_kind before insert or update on adjustments for each row execute function validate_adjustment();
