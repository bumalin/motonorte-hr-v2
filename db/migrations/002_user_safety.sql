-- 002_user_safety.sql — account changes end sessions; never leave the system without an active owner.
-- (review TASK-005..006: revoke a user's sessions on password reset, role change or deactivation)

create function users_after_update() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if new.password_hash is distinct from old.password_hash
     or new.role is distinct from old.role
     or new.active is distinct from old.active then
    delete from sessions where user_id = new.id;
  end if;
  if not exists (select 1 from users where role = 'owner' and active) then
    raise exception 'LAST_OWNER: at least one active owner is required' using errcode = 'P0001';
  end if;
  return null;
end
$$;

create trigger users_safety after update on users for each row execute function users_after_update();
revoke execute on function users_after_update() from public;
