-- 006_login_hardening.sql — security report H-1 (TASK-024), M-4, L-6
-- 1. Lockout-proof throttle: failures are counted per (email, IP) and per IP, so a stranger can't lock the Owner
--    out from elsewhere. A per-email ceiling across all IPs remains as a backstop against distributed guessing.
-- 2. Housekeeping: old login attempts and expired sessions are deleted (they grew forever).
-- 3. Users can change their own password (the Owner no longer has to know staff passwords).

-- Returns 'ok' or the reason the attempt is refused. Limits over the last 15 minutes:
--   5 failures for this email from this IP (since that email's last success)  → 'email_ip'
--   20 failures from this IP across any emails                                 → 'ip'
--   50 failures for this email across all IPs (since its last success)         → 'email'
create function auth_throttle(p_email text, p_ip text) returns text
  language sql stable security definer set search_path = public, pg_temp as
$$
  with last_ok as (
    select coalesce(max(at), '-infinity') as t from login_attempts where email = lower(p_email) and success
  ), recent as (
    select * from login_attempts where not success and at > now() - interval '15 minutes'
  )
  select case
    when (select count(*) from recent, last_ok where email = lower(p_email) and ip is not distinct from p_ip and at > last_ok.t) >= 5 then 'email_ip'
    when p_ip is not null and (select count(*) from recent where ip = p_ip) >= 20 then 'ip'
    when (select count(*) from recent, last_ok where email = lower(p_email) and at > last_ok.t) >= 50 then 'email'
    else 'ok' end
$$;

create function auth_housekeeping() returns void
  language sql security definer set search_path = public, pg_temp as
$$
  delete from login_attempts where at < now() - interval '1 day';
  delete from sessions where expires_at < now();
$$;

-- Current user replaces their own password hash (the app verifies the old password first).
-- The users trigger (002/003) ends all of that user's sessions; the app then issues a fresh one.
create function auth_change_password(p_new_hash text) returns void
  language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_role() is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(length(p_new_hash), 0) < 20 then raise exception 'BAD_HASH' using errcode = 'P0001'; end if;
  update users set password_hash = p_new_hash where id = app_current_user_id() and active;
end
$$;

revoke execute on function auth_throttle(text, text), auth_housekeeping(), auth_change_password(text) from public;
grant execute on function auth_throttle(text, text), auth_housekeeping(), auth_change_password(text) to app_user;
