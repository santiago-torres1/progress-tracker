-- =============================================================================
-- progress-tracker :: 20260917100000_anonymous_identity
--
-- 0.2.0-alpha Phase 1. This is the migration 20260916090400's header promised:
-- "what changes when login arrives". Login arrives as ANONYMOUS ACCOUNTS --
-- Supabase anonymous sign-in gives every visitor a real auth.users row and an
-- access token with no sign-in screen, which is what finally makes auth.uid()
-- a real value and the RLS policies load-bearing.
--
-- Everything before 20260917* has been applied to the hosted project. They are
-- immutable now; this file and its siblings are how the schema changes.
--
-- What this migration does, and why each part exists:
--
--   1. public.users.last_seen_at  -- the clock behind expiry.
--   2. public.users.is_anonymous  -- which accounts expiry is allowed to delete.
--   3. The real FK users.auth_user_id -> auth.users(id) ON DELETE CASCADE, so
--      deleting the auth account actually deletes the data (the security
--      posture: "deleting a session's data must actually delete it").
--   4. A SECURITY DEFINER trigger on auth.users that creates the public.users
--      row at signup, so a visitor's very first request already has a profile.
--   5. A second trigger that keeps is_anonymous in step when an anonymous
--      account is converted to a permanent one -- conversion keeps every row
--      AND stops the account expiring.
--   6. Removal of the login-less singleton (is_default, default_user_id()).
--   7. Column-level UPDATE grants on public.users, so a session cannot edit its
--      way out of expiry.
--
-- EXPIRY IS COMPUTED FROM last_seen_at, NOT STORED.
--   A stored expires_at is the same fact written twice, and every code path
--   that touches last_seen_at would have to remember to update it; one that
--   forgets either deletes somebody's data early or never deletes it at all.
--   Computing it costs nothing (the cleanup job filters on last_seen_at, which
--   is indexed) and changing the retention window becomes a one-line change to
--   one function rather than a backfill over every row.
--   A generated column is not even available as a compromise: PostgreSQL
--   requires generation expressions to be IMMUTABLE, and `timestamptz +
--   interval` is only STABLE (adding days/months depends on the session's
--   TimeZone), so `expires_at generated always as (last_seen_at + interval '90
--   days') stored` is rejected outright.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 + 2. The two columns expiry needs.
-- -----------------------------------------------------------------------------

-- Sliding window: every visit refreshes it (see public.begin_request), and an
-- account 90 days past its last visit is deleted. Day resolution is all that is
-- needed, which is what lets the touch be a once-a-day write.
alter table public.users
  add column if not exists last_seen_at timestamptz not null default now();

-- Only anonymous accounts expire. DEFAULT false is the safe direction: a row
-- created by hand or by a migration (the demo row below) is not a throwaway
-- session and must never be swept up. The signup trigger sets it explicitly.
alter table public.users
  add column if not exists is_anonymous boolean not null default false;

comment on column public.users.last_seen_at is
  'Last time this account made a request. Refreshed at most once a day; the expiry job deletes anonymous accounts 90 days past it.';
comment on column public.users.is_anonymous is
  'True while this account came from Supabase anonymous sign-in and has not been converted to a permanent one. Only true rows expire.';

-- The expiry sweep's driving scan, and nothing else: partial on is_anonymous so
-- it stays the size of the live session population, not of the table.
create index if not exists users_anonymous_last_seen_idx
  on public.users (last_seen_at) where is_anonymous;

-- -----------------------------------------------------------------------------
-- 3. The FK that has been a comment since 20260916090100.
--
-- ON DELETE CASCADE in this direction means "delete the auth account -> the
-- profile and everything hanging off it goes too", which is exactly what the
-- expiry job wants to say. auth.users is therefore the root of deletion, and
-- deleting it is the only way to make a session's token stop working as well as
-- its rows disappear.
--
-- NULL is still allowed: the pre-auth demo row (20260916090500) has no auth
-- account, and a row with auth_user_id IS NULL matches no policy at all
-- (`auth_user_id = auth.uid()` is NULL, never true), so it is invisible to
-- every session rather than visible to all of them.
-- -----------------------------------------------------------------------------
do $$ begin
  alter table public.users
    add constraint users_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Profile creation at signup.
--
-- SECURITY DEFINER because the inserting session is not `authenticated` yet --
-- GoTrue is mid-signup and there is no JWT to satisfy a policy with. Owned by
-- the migration role, with an empty search_path, and it writes exactly one row
-- keyed on the id GoTrue just created; it takes no arguments from the caller.
--
-- It deliberately does NOT swallow errors. A signup that half-succeeds (an auth
-- account with no profile) would give the visitor a token that authenticates
-- and then 401s on every product route with `no_profile` -- a broken app that
-- looks like a backend bug. Failing the signup is louder and recoverable.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (auth_user_id, display_name, is_anonymous)
  values (
    new.id,
    'Me',
    -- auth.users.is_anonymous exists from GoTrue 2.150; coalesce keeps this
    -- working against an older local stack, where nothing is anonymous.
    coalesce(new.is_anonymous, false)
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Creates the public.users profile for a new auth.users row, so a visitor has one before their first request.';

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 5. Conversion: anonymous -> permanent.
--
-- When the visitor adds an email or links an OAuth identity, GoTrue flips
-- auth.users.is_anonymous to false on the SAME row. Every goal, entry and
-- check-in is already keyed on that row's id, so conversion keeps all of it --
-- the only thing that has to change is that the account stops expiring.
-- -----------------------------------------------------------------------------
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users u
  set is_anonymous = coalesce(new.is_anonymous, false)
  where u.auth_user_id = new.id
    and u.is_anonymous is distinct from coalesce(new.is_anonymous, false);
  return new;
end;
$$;

comment on function public.handle_auth_user_updated() is
  'Keeps public.users.is_anonymous in step with auth.users, so converting an anonymous account stops it expiring.';

create or replace trigger on_auth_user_updated
  after update of is_anonymous on auth.users
  for each row execute function public.handle_auth_user_updated();

-- -----------------------------------------------------------------------------
-- 6. The login-less singleton is gone.
--
-- is_default answered "which row is THE user" -- a question that only exists
-- while there is exactly one. With a session per visitor there is no "the"
-- user, so the flag, its partial unique index and public.default_user_id() are
-- dead weight that could only ever be read by mistake. The backend's
-- DEFAULT_USER_ID env var goes with them.
--
-- 20260916090500_reference_data.sql still inserts its fixed-id row (migrations
-- run in filename order, so the column is still there when it does) and
-- supabase/seed.sql still hangs the demo goals off it. That row now has
-- auth_user_id IS NULL and is_anonymous = false: unreachable by any session,
-- and never swept up by expiry. Locally it is what `supabase db reset` gives
-- you a populated board from. In the hosted project it is 0.1.1-alpha's demo
-- content sitting where nobody can see it -- deleting it is a separate,
-- deliberate act for the human (see supabase/README.md).
-- -----------------------------------------------------------------------------
drop index if exists public.users_single_default_uidx;
drop function if exists public.default_user_id();
alter table public.users drop column if exists is_default;

comment on table public.users is
  'Application profile, one per auth.users row. Anonymous accounts expire 90 days after last_seen_at.';

-- -----------------------------------------------------------------------------
-- 7. Privileges: what a session may change about itself.
--
-- 20260916090400 granted a blanket UPDATE on public.users. With real sessions
-- that is too much: it would let a visitor set is_anonymous = false and opt out
-- of expiry, or rewrite last_seen_at to stay alive forever, or move
-- auth_user_id (the WITH CHECK would stop the obvious attack, but the column
-- has no business being writable at all). Column-level grants say precisely
-- which three fields are the user's own preferences. last_seen_at is written
-- only by public.begin_request; is_anonymous only by the auth.users triggers.
-- -----------------------------------------------------------------------------
revoke update on table public.users from authenticated;
grant update (display_name, time_zone, week_starts_on) on table public.users to authenticated;
