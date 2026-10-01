-- 011_user_contact.sql — Owner request 2026-09-27: contact details on user accounts.
-- Owner-only like the rest of the user record (users RLS). The audit log masks them, since staff can read the log.

alter table users
  add column phone                   text check (length(phone) <= 40),
  add column address                 text check (length(address) <= 300),
  add column emergency_contact       text check (length(emergency_contact) <= 120),
  add column emergency_contact_phone text check (length(emergency_contact_phone) <= 40);

grant select (phone, address, emergency_contact, emergency_contact_phone) on users to app_user;
grant insert (phone, address, emergency_contact, emergency_contact_phone) on users to app_user;
grant update (phone, address, emergency_contact, emergency_contact_phone) on users to app_user;

create or replace function mask_private(j jsonb) returns jsonb
  language sql immutable set search_path = public, pg_temp as
$$
  select coalesce(jsonb_object_agg(k,
           case when k in ('tin','sss_no','philhealth_no','pagibig_no','bank_account_no',
                           'phone','address','emergency_contact','emergency_contact_phone') and jsonb_typeof(v) = 'string'
                then to_jsonb('••••' || right(v #>> '{}', 4)) else v end), '{}'::jsonb)
  from jsonb_each(j) as e(k, v)
$$;

create or replace function audit_row() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if tg_table_name = 'employee_private' then o := mask_private(o); n := mask_private(n); end if;
  if tg_table_name = 'users' then  -- null stays null (INSERT has no old row, DELETE no new row)
    o := case when o is not null then mask_private(o - 'password_hash') end;
    n := case when n is not null then mask_private(n - 'password_hash') end;
  end if;
  insert into audit_log (actor, table_name, row_id, action, old, new)
  values (app_current_user_id(), tg_table_name,
          coalesce(n, o) ->> coalesce(tg_argv[0], 'id'), tg_op, o, n);
  return null;
end
$$;
