-- Employee portal: separate crew boundary, activation, payment records and PDF requests.
alter table users add column access_kind text not null default 'office' check(access_kind in ('office','crew'));
alter table users add column employee_id uuid unique references employees(id);
alter table users add column activation_hash text;
alter table users add column activation_expires_at timestamptz;
alter table users add constraint crew_identity check(access_kind <> 'crew' or (role='staff' and employee_id is not null));
alter table users drop constraint users_tabs_check;
alter table users add constraint users_tabs_check check(tabs <@ array['dashboard','week','employees','payroll','catalog','reports','settings','team','audit','mypay','profile','payslips','requests']);
alter table users add constraint crew_tabs check(access_kind <> 'crew' or tabs <@ array['mypay','profile','payslips']);

create or replace function app_role() returns app_role_t
language sql stable security definer set search_path=public,pg_temp as
$$ select role from users where id=app_current_user_id() and active and access_kind='office' $$;
create function app_employee_id() returns uuid
language sql stable security definer set search_path=public,pg_temp as
$$ select employee_id from users where id=app_current_user_id() and active and access_kind='crew' $$;
revoke execute on function app_employee_id() from public;
grant execute on function app_employee_id() to app_user;
grant select(access_kind,employee_id,activation_expires_at) on users to app_user;
grant insert(access_kind,employee_id,activation_hash,activation_expires_at) on users to app_user;
grant update(activation_hash,activation_expires_at) on users to app_user;

create policy crew_employee on employees for select using(id=app_employee_id());
create policy crew_terms on pay_terms for select using(employee_id=app_employee_id() and status='approved');
create policy crew_attendance on attendance for select using(employee_id=app_employee_id());
create policy crew_runs on payroll_runs for select using(app_employee_id() is not null and exists(select 1 from payroll_lines l where l.run_id=payroll_runs.id and l.employee_id=app_employee_id()));
create policy crew_lines on payroll_lines for select using(employee_id=app_employee_id());
create policy crew_items on payroll_items for select using(employee_id=app_employee_id());
-- Existing derived views must honor row ownership rather than their privileged view owner.
alter view v_employee_current set(security_invoker=true);
alter view v_monthly_summary set(security_invoker=true);
alter view v_thirteenth_month set(security_invoker=true);

drop function auth_get_session(text,timestamptz);
create function auth_get_session(p_token_hash text,p_new_expires timestamptz)
returns table(user_id uuid,email text,full_name text,role app_role_t,tabs text[],access_kind text,employee_id uuid)
language sql security definer set search_path=public,pg_temp as $$
update sessions s set expires_at=p_new_expires from users u
where s.token_hash=p_token_hash and s.expires_at>now() and u.id=s.user_id and u.active
returning u.id,u.email,u.full_name,u.role,u.tabs,u.access_kind,u.employee_id $$;
revoke execute on function auth_get_session(text,timestamptz) from public;
grant execute on function auth_get_session(text,timestamptz) to app_user;

create or replace function auth_change_password(p_new_hash text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
if not exists(select 1 from users where id=app_current_user_id() and active) then raise exception 'FORBIDDEN'; end if;
update users set password_hash=p_new_hash where id=app_current_user_id() and active;
end $$;
-- Throttling is checked by the server before invoking this function. Atomic consumption prevents reuse.
create function activate_crew(p_email text,p_hash text,p_password text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
update users set password_hash=p_password,active=true,activation_hash=null,activation_expires_at=null
where email=lower(p_email) and access_kind='crew' and not active and activation_hash=p_hash and activation_expires_at>now()
returning id into result;
return result;
end $$;
revoke execute on function activate_crew(text,text,text) from public;
grant execute on function activate_crew(text,text,text) to app_user;

create or replace function audit_row() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare o jsonb:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
n jsonb:=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
if tg_table_name='employee_private' then o:=mask_private(o); n:=mask_private(n); end if;
if tg_table_name='users' then o:=o-'password_hash'-'activation_hash'; n:=n-'password_hash'-'activation_hash'; end if;
insert into audit_log(actor,table_name,row_id,action,old,new)
values(app_current_user_id(),tg_table_name,coalesce(n,o)->>coalesce(tg_argv[0],'id'),tg_op,o,n);
return null;
end $$;

create table payroll_payments(
id uuid primary key default gen_random_uuid(),
run_id uuid not null references payroll_runs(id),
employee_id uuid not null references employees(id),
amount bigint not null check(amount>0 and amount<=100000000000),
paid_on date not null,method text not null check(length(method) between 1 and 80),
reference text not null default '' check(length(reference)<=200),
recorded_by uuid not null default app_current_user_id() references users(id),
recorded_at timestamptz not null default now()
);
alter table payroll_payments enable row level security;
create policy payments_read on payroll_payments for select using(app_role() in ('owner','staff') or employee_id=app_employee_id());
grant select on payroll_payments to app_user;
create trigger audit after insert on payroll_payments for each row execute function audit_row('id');
create function record_payroll_payment(p_run uuid,p_employee uuid,p_amount bigint,p_date date,p_method text,p_ref text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare owed bigint; paid bigint;
begin
perform pg_advisory_xact_lock(76239146);
if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN'; end if;
select l.net into owed from payroll_lines l join payroll_runs r on r.id=l.run_id
where l.run_id=p_run and l.employee_id=p_employee and r.status='locked';
if owed is null or p_date>(now() at time zone 'Asia/Manila')::date then raise exception 'PAYMENT_INVALID'; end if;
select coalesce(sum(amount),0) into paid from payroll_payments where run_id=p_run and employee_id=p_employee;
if p_amount<=0 or paid+p_amount>owed then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
insert into payroll_payments(run_id,employee_id,amount,paid_on,method,reference)
values(p_run,p_employee,p_amount,p_date,p_method,p_ref);
end $$;
revoke execute on function record_payroll_payment(uuid,uuid,bigint,date,text,text) from public;
grant execute on function record_payroll_payment(uuid,uuid,bigint,date,text,text) to app_user;

create table payslip_requests(
id uuid primary key default gen_random_uuid(),
employee_id uuid not null references employees(id),
requested_by uuid not null default app_current_user_id() references users(id),
range_start date not null,range_end date not null check(range_end>=range_start and range_end-range_start<=366),
requested_at timestamptz not null default now(),
status text not null default 'pending' check(status in ('pending','approved','rejected','used','revoked')),
reviewed_by uuid references users(id),reviewed_at timestamptz,
note text not null default '' check(length(note)<=500),
expires_at timestamptz,used_at timestamptz,
snapshot jsonb
);
alter table payslip_requests enable row level security;
create policy request_read on payslip_requests for select using(app_role()='owner' or employee_id=app_employee_id());
create policy request_create on payslip_requests for insert with check(employee_id=app_employee_id() and requested_by=app_current_user_id() and status='pending' and reviewed_by is null and snapshot is null);
grant select on payslip_requests to app_user;
grant insert(employee_id,range_start,range_end) on payslip_requests to app_user;
create trigger audit after insert or update on payslip_requests for each row execute function audit_row('id');
-- Lock version markers invalidate outstanding approvals when a run is corrected.
create function revoke_payslips_on_reopen() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
if old.status='locked' and new.status='draft' then
update payslip_requests set status='revoked',note='Payroll corrected; please request a new document.'
where status='approved' and exists(select 1 from jsonb_array_elements(snapshot->'weeks') w where w->>'runId'=old.id::text);
end if;
return null;
end $$;
create trigger revoke_payslips after update on payroll_runs for each row execute function revoke_payslips_on_reopen();
-- Snapshot is supplied only by the authorized server, then verified against stored amounts/version markers.
create function review_payslip(p_id uuid,p_approve boolean,p_note text,p_snapshot jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare req payslip_requests; w jsonb; n integer;
begin
perform pg_advisory_xact_lock(76239146);
if app_role() is distinct from 'owner' then raise exception 'FORBIDDEN'; end if;
select * into req from payslip_requests where id=p_id for update;
if req.id is null or req.status<>'pending' then raise exception 'REQUEST_NOT_PENDING'; end if;
if p_approve then
select count(*) into n from payroll_runs r join payroll_lines l on l.run_id=r.id
where r.status='locked' and l.employee_id=req.employee_id and r.payday between req.range_start and req.range_end;
if n=0 or jsonb_array_length(p_snapshot->'weeks') is distinct from n then raise exception 'SNAPSHOT_INVALID'; end if;
if (p_snapshot->>'employeeId')::uuid is distinct from req.employee_id then raise exception 'SNAPSHOT_INVALID'; end if;
for w in select * from jsonb_array_elements(p_snapshot->'weeks') loop
if not exists(select 1 from payroll_runs r join payroll_lines l on l.run_id=r.id
where r.id=(w->>'runId')::uuid and l.employee_id=req.employee_id and r.status='locked'
and r.payday between req.range_start and req.range_end and r.locked_at::text=w->>'version'
and l.net=(w->>'net')::bigint and l.gross=(w->>'gross')::bigint) then raise exception 'SNAPSHOT_INVALID'; end if;
end loop;
else
if length(trim(p_note))=0 then raise exception 'REASON_REQUIRED'; end if;
end if;
update payslip_requests set status=case when p_approve then 'approved' else 'rejected' end,
reviewed_by=app_current_user_id(),reviewed_at=now(),note=p_note,
expires_at=case when p_approve then now()+interval '7 days' end,
snapshot=case when p_approve then p_snapshot end where id=p_id;
end $$;
create function consume_payslip(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
perform pg_advisory_xact_lock(76239146);
update payslip_requests set status='used',used_at=now()
where id=p_id and employee_id=app_employee_id() and status='approved' and expires_at>now()
returning snapshot into result;
if result is null then raise exception 'DOWNLOAD_UNAVAILABLE'; end if;
return result;
end $$;
revoke execute on function review_payslip(uuid,boolean,text,jsonb),consume_payslip(uuid),revoke_payslips_on_reopen() from public;
grant execute on function review_payslip(uuid,boolean,text,jsonb),consume_payslip(uuid) to app_user;


-- Conservative freshness check: source changes anywhere since generation require a refresh.
-- Reveals only a boolean for the caller's own week, never business source records.
create function crew_run_fresh(p_run uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select coalesce((select not exists(select 1 from audit_log a
where a.at>r.generated_at and a.table_name in ('employees','pay_terms','attendance','job_log','adjustments','catalog_jobs','catalog_amounts','settings','holidays'))
from payroll_runs r where r.id=p_run and exists(select 1 from payroll_lines l where l.run_id=r.id and l.employee_id=app_employee_id())),false)
$$;
revoke execute on function crew_run_fresh(uuid) from public;
grant execute on function crew_run_fresh(uuid) to app_user;

