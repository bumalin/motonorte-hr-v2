-- 003_review_fixes.sql — review TASK-007..010
-- 1. A proposal dated inside a week that later got locked can still be REJECTED (never approved).
-- 2. LAST_OWNER check only when an active owner is removed, serialized so concurrent demotions can't both pass.

create or replace function guard_effective_date() returns trigger
  language plpgsql set search_path = public, pg_temp as
$$
declare
  d date := (to_jsonb(new) ->> tg_argv[0])::date;
  o date := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> tg_argv[0])::date end;
begin
  -- Rejecting a stale proposal changes nothing that locked weeks depend on
  if tg_table_name = 'pay_terms' and tg_op = 'UPDATE' and d = o
     and (to_jsonb(old) ->> 'status') = 'proposed' and (to_jsonb(new) ->> 'status') = 'rejected'
     and (to_jsonb(new) - array['status','decided_by','decided_at']) = (to_jsonb(old) - array['status','decided_by','decided_at']) then
    return new;
  end if;
  if o <= last_locked_day() then
    raise exception 'PERIOD_LOCKED: row effective % is part of locked history', o using errcode = 'P0001';
  end if;
  if d <= last_locked_day() then
    raise exception 'PERIOD_LOCKED: effective date % is on or before the last locked week', d using errcode = 'P0001';
  end if;
  return new;
end
$$;

create or replace function users_after_update() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if new.password_hash is distinct from old.password_hash
     or new.role is distinct from old.role
     or new.active is distinct from old.active then
    delete from sessions where user_id = new.id;
  end if;
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active) then
    perform pg_advisory_xact_lock(hashtext('motonorte_last_owner'));
    if not exists (select 1 from users where role = 'owner' and active) then
      raise exception 'LAST_OWNER: at least one active owner is required' using errcode = 'P0001';
    end if;
  end if;
  return null;
end
$$;
