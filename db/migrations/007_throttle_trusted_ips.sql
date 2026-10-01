-- 007_throttle_trusted_ips.sql — review TASK-024..027
-- 1. The per-email ceiling (50 failures / 15 min) no longer applies to IPs that have signed in successfully as that
--    email within 30 days, so a distributed stranger can't lock the Owner out of their usual devices/office.
-- 2. Login attempts are kept 30 days (attack trail); indexes keep throttle + housekeeping cheap.

create or replace function auth_throttle(p_email text, p_ip text) returns text
  language sql stable security definer set search_path = public, pg_temp as
$$
  with last_ok as (
    select coalesce(max(at), '-infinity') as t from login_attempts where email = lower(p_email) and success
  ), recent as (
    select * from login_attempts where not success and at > now() - interval '15 minutes'
  ), trusted as (
    select exists (select 1 from login_attempts where email = lower(p_email) and success and p_ip is not null
                   and ip = p_ip and at > now() - interval '30 days') as yes
  )
  select case
    when (select count(*) from recent, last_ok where email = lower(p_email) and ip is not distinct from p_ip and at > last_ok.t) >= 5 then 'email_ip'
    when p_ip is not null and (select count(*) from recent where ip = p_ip) >= 20 then 'ip'
    when not (select yes from trusted)
         and (select count(*) from recent, last_ok where email = lower(p_email) and at > last_ok.t) >= 50 then 'email'
    else 'ok' end
$$;

create or replace function auth_housekeeping() returns void
  language sql security definer set search_path = public, pg_temp as
$$
  delete from login_attempts where at < now() - interval '30 days';
  delete from sessions where expires_at < now();
$$;

create index if not exists login_attempts_ip_at_idx on login_attempts (ip, at desc);
create index if not exists login_attempts_at_idx on login_attempts (at);
create index if not exists sessions_expires_idx on sessions (expires_at);
