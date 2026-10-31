-- Admin-only attendance, atomic approval and preserved correction history.
-- Existing payroll calculations and applied migrations are unchanged.
create function serialize_payroll_write() returns trigger
 language plpgsql set search_path = public, pg_temp as
$$ begin
 perform pg_advisory_xact_lock(76239146);
 if tg_table_name = 'attendance' and app_role() = 'staff' then
   raise exception 'ATTENDANCE_ADMIN_ONLY: only an administrator can edit attendance' using errcode = '42501';
 end if;
 return null;
end $$;

-- Statement locks are acquired before row locks, preventing a source edit and approval racing.
do $$ declare name text; begin
 foreach name in array array['employees','pay_terms','attendance','catalog_jobs','catalog_amounts','job_log','adjustments','settings','holidays','payroll_runs','payroll_lines','payroll_items'] loop
  execute format('create trigger payroll_serial before insert or update or delete on %I for each statement execute function serialize_payroll_write()',name);
 end loop;
end $$;

drop policy attendance_rw on attendance;
create policy attendance_read on attendance for select using (app_role() in ('staff','owner'));
create policy attendance_owner_write on attendance for all using (app_role() = 'owner') with check (app_role() = 'owner');

create table payroll_run_versions (
 id bigint generated always as identity primary key,
 run_id uuid not null references payroll_runs(id),
 archived_at timestamptz not null default now(),
 archived_by uuid not null references users(id),
 reason text not null,
 snapshot jsonb not null
);
alter table payroll_run_versions enable row level security;
create policy versions_read on payroll_run_versions for select using (app_role() in ('staff','owner'));
grant select on payroll_run_versions to app_user;

-- Every successful reopen archives the original approval and all saved amounts before changing the run.
create function archive_approved_run() returns trigger
 language plpgsql security definer set search_path = public, pg_temp as
$$ begin
 if old.status = 'locked' and new.status = 'draft' then
  if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into payroll_run_versions(run_id,archived_by,reason,snapshot)
  values(old.id,app_current_user_id(),new.sent_back_note,jsonb_build_object(
   'run',to_jsonb(old),
   'lines',coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('code',e.code,'full_name',e.full_name) order by e.code)
                      from payroll_lines l join employees e on e.id=l.employee_id where l.run_id=old.id),'[]'::jsonb),
   'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from payroll_items i where i.run_id=old.id),'[]'::jsonb)));
 end if;
 return new;
end $$;
revoke execute on function archive_approved_run() from public;
create trigger archive_approval before update on payroll_runs for each row execute function archive_approved_run();

create function immutable_payroll_version() returns trigger
 language plpgsql set search_path = public, pg_temp as
$$ begin raise exception 'IMMUTABLE_PAYROLL_VERSION' using errcode = '42501'; end $$;
create trigger immutable_version before update or delete on payroll_run_versions for each row execute function immutable_payroll_version();
