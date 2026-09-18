-- =============================================================================
-- progress-tracker :: 20260917100400_session_expiry
--
-- "A session whose owner has not returned for 90 days is deleted and its rows
-- freed." This is that, as one callable, idempotent function.
--
-- NOTHING HERE SCHEDULES IT. Turning it on is a deliberate act; see the
-- recommendation at the bottom of this file and in supabase/README.md.
-- =============================================================================

-- The retention window, in one place, so begin_request()'s expires_at and the
-- sweep below can never disagree about what 90 days means. IMMUTABLE and
-- readable by a session, so the UI can say "kept until <date>" without a second
-- copy of the number in TypeScript.
create or replace function public.anonymous_retention()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '90 days';
$$;

comment on function public.anonymous_retention() is
  'How long an anonymous account survives after its last visit. Sliding: every visit refreshes last_seen_at.';

grant execute on function public.anonymous_retention() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.delete_expired_anonymous_users()
--
-- Deletes auth.users, NOT public.users. That is the whole point: the auth row
-- is the root, users_auth_user_id_fkey cascades to the profile, and the
-- profile's own FKs cascade on to goals -> recurrences / calendar entries /
-- check-ins. Deleting only the profile would leave a live auth account whose
-- token still authenticates, pointing at nothing.
--
-- Only is_anonymous rows are eligible. A converted (permanent) account and the
-- login-less demo row are both is_anonymous = false and are never touched, no
-- matter how long they sit.
--
-- SECURITY DEFINER because it writes in the auth schema, and granted to
-- service_role alone: this is a maintenance job, never something a session can
-- invoke. It takes no identity from the caller.
--
-- Idempotent (a second run finds nothing) and safe to run concurrently:
-- FOR UPDATE SKIP LOCKED means two overlapping runs take disjoint sets instead
-- of blocking on, or double-counting, the same rows. p_limit bounds one run so
-- a long-neglected backlog is worked off in chunks rather than in one
-- long-running transaction.
-- -----------------------------------------------------------------------------
create or replace function public.delete_expired_anonymous_users(
  p_retention interval default null,
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention interval := coalesce(p_retention, public.anonymous_retention());
  v_cutoff timestamptz := now() - v_retention;
  v_limit integer := greatest(coalesce(p_limit, 1000), 0);
  v_deleted integer := 0;
  v_batch integer;
begin
  with doomed as (
    select u.auth_user_id
    from public.users u
    where u.is_anonymous
      and u.auth_user_id is not null
      and u.last_seen_at < v_cutoff
    order by u.last_seen_at
    limit v_limit
    for update skip locked
  )
  delete from auth.users a using doomed d where a.id = d.auth_user_id;
  get diagnostics v_batch = row_count;
  v_deleted := v_deleted + v_batch;

  -- A profile flagged anonymous with no auth row should not exist -- the signup
  -- trigger always sets auth_user_id -- but if one ever does, the cascade above
  -- can never reach it and it would sit there forever. Swept here so "expired"
  -- means the same thing for every row.
  with orphaned as (
    select u.id
    from public.users u
    where u.is_anonymous
      and u.auth_user_id is null
      and u.last_seen_at < v_cutoff
    order by u.last_seen_at
    limit v_limit
    for update skip locked
  )
  delete from public.users p using orphaned o where p.id = o.id;
  get diagnostics v_batch = row_count;
  v_deleted := v_deleted + v_batch;

  return v_deleted;
end;
$$;

comment on function public.delete_expired_anonymous_users(interval, integer) is
  'Deletes anonymous accounts idle longer than the retention window, cascading to all their data. Returns how many were removed.';

revoke execute on function public.delete_expired_anonymous_users(interval, integer) from public;
grant execute on function public.delete_expired_anonymous_users(interval, integer) to service_role;

-- -----------------------------------------------------------------------------
-- How to schedule it (RECOMMENDED: pg_cron, inside Supabase).
--
--   create extension if not exists pg_cron with schema cron;
--   select cron.schedule(
--     'expire-anonymous-accounts', '17 3 * * *',
--     $job$ select public.delete_expired_anonymous_users(); $job$
--   );
--   select cron.schedule(
--     'sweep-rate-limits', '47 3 * * *',
--     $job$ select public.delete_expired_rate_limits(); $job$
--   );
--
-- pg_cron over a scheduled GitHub Actions workflow because it needs no
-- credential anywhere (no service-role key in CI, nothing to leak or rotate),
-- no network path from GitHub into Supabase, and it cannot be silently disabled
-- the way GitHub disables scheduled workflows on repositories with no activity
-- for 60 days -- which is exactly the failure mode that would quietly stop data
-- being deleted while the app looks fine.
--
-- Not run here: enabling an extension and creating a cron job on the hosted
-- project is the human's call, and the schedule is worth agreeing on first.
-- -----------------------------------------------------------------------------
