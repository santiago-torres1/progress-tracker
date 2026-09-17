-- =============================================================================
-- progress-tracker :: 20260916090400_row_level_security
--
-- RLS is enabled on every table NOW, with the policies login will need, even
-- though nothing can satisfy them yet.
--
-- How this behaves today (no auth):
--   * The backend talks to Supabase with the SERVICE-ROLE key. service_role has
--     BYPASSRLS, so it sees and writes everything. That is the only reason the
--     app works, and the reason the key must never reach the browser.
--   * anon and authenticated hold table privileges (Supabase's default grants)
--     but no policy can ever match, because public.current_user_id() is NULL
--     when auth.uid() is NULL. So a leaked ANON key reads exactly nothing.
--
-- What changes when login arrives:
--   1. Set public.users.auth_user_id on the existing row(s) to the auth.users id.
--   2. alter table public.users
--        add constraint users_auth_user_id_fkey
--        foreign key (auth_user_id) references auth.users (id) on delete cascade;
--   3. Add a trigger on auth.users (SECURITY DEFINER) that inserts a
--      public.users row on signup, and drop the is_default singleton.
--   4. Move the backend's per-request reads onto the user's access token
--      (anon key + Authorization header) so these policies do the work; keep
--      service_role only for genuinely administrative jobs.
--   No policy below has to change for that.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers (table-dependent, hence defined here rather than in 090000)
-- -----------------------------------------------------------------------------

-- The public.users row for the caller's JWT. STABLE so it is evaluated once per
-- statement; policies additionally wrap it in a scalar subquery, which is the
-- documented Supabase trick for keeping RLS off the per-row path.
create or replace function public.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select u.id from public.users u where u.auth_user_id = (select auth.uid());
$$;

comment on function public.current_user_id() is
  'public.users.id for the current JWT, or NULL when unauthenticated.';

-- The single login-less user. Returns NULL for anon/authenticated (RLS hides
-- the row); only the service-role backend can resolve it, which is intended.
create or replace function public.default_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select u.id from public.users u where u.is_default order by u.created_at limit 1;
$$;

comment on function public.default_user_id() is
  'Id of the single login-less user. Temporary: delete once auth is wired up.';

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.life_areas enable row level security;
alter table public.goals enable row level security;
alter table public.recurrences enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.progress_entries enable row level security;

-- -----------------------------------------------------------------------------
-- Policies. One per command (Supabase's recommendation: a SELECT policy that
-- also had to cover INSERT would have to be weaker than either needs).
-- All are scoped `to authenticated` -- anon is never granted a path.
-- CREATE POLICY has no IF NOT EXISTS, so each is dropped first for re-runnability.
-- -----------------------------------------------------------------------------

-- users: you can see and edit your own profile row; rows are created by the
-- backend (service role) or, later, by the signup trigger.
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- life_areas: built-in areas are readable by everyone; only your own are writable.
drop policy if exists life_areas_select on public.life_areas;
create policy life_areas_select on public.life_areas
  for select to authenticated
  using (user_id is null or user_id = (select public.current_user_id()));

drop policy if exists life_areas_insert on public.life_areas;
create policy life_areas_insert on public.life_areas
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));

drop policy if exists life_areas_update on public.life_areas;
create policy life_areas_update on public.life_areas
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

drop policy if exists life_areas_delete on public.life_areas;
create policy life_areas_delete on public.life_areas
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

-- goals
drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select to authenticated
  using (user_id = (select public.current_user_id()));

drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));

drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

-- recurrences
drop policy if exists recurrences_select on public.recurrences;
create policy recurrences_select on public.recurrences
  for select to authenticated
  using (user_id = (select public.current_user_id()));

drop policy if exists recurrences_insert on public.recurrences;
create policy recurrences_insert on public.recurrences
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));

drop policy if exists recurrences_update on public.recurrences;
create policy recurrences_update on public.recurrences
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

drop policy if exists recurrences_delete on public.recurrences;
create policy recurrences_delete on public.recurrences
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

-- calendar_entries
drop policy if exists calendar_entries_select on public.calendar_entries;
create policy calendar_entries_select on public.calendar_entries
  for select to authenticated
  using (user_id = (select public.current_user_id()));

drop policy if exists calendar_entries_insert on public.calendar_entries;
create policy calendar_entries_insert on public.calendar_entries
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));

drop policy if exists calendar_entries_update on public.calendar_entries;
create policy calendar_entries_update on public.calendar_entries
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

drop policy if exists calendar_entries_delete on public.calendar_entries;
create policy calendar_entries_delete on public.calendar_entries
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

-- progress_entries
drop policy if exists progress_entries_select on public.progress_entries;
create policy progress_entries_select on public.progress_entries
  for select to authenticated
  using (user_id = (select public.current_user_id()));

drop policy if exists progress_entries_insert on public.progress_entries;
create policy progress_entries_insert on public.progress_entries
  for insert to authenticated
  with check (user_id = (select public.current_user_id()));

drop policy if exists progress_entries_update on public.progress_entries;
create policy progress_entries_update on public.progress_entries
  for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

drop policy if exists progress_entries_delete on public.progress_entries;
create policy progress_entries_delete on public.progress_entries
  for delete to authenticated
  using (user_id = (select public.current_user_id()));

-- -----------------------------------------------------------------------------
-- Privileges
--
-- Explicit rather than relying on Supabase's default grants, so the intent is
-- readable here. anon is granted nothing: it has no policy either, so this is
-- belt and braces.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, update on table public.users to authenticated;
grant select, insert, update, delete on table
  public.life_areas,
  public.goals,
  public.recurrences,
  public.calendar_entries,
  public.progress_entries
to authenticated;

grant select, insert, update, delete on table
  public.users,
  public.life_areas,
  public.goals,
  public.recurrences,
  public.calendar_entries,
  public.progress_entries
to service_role;

-- Views inherit nothing: grant explicitly. security_invoker keeps RLS in force.
grant select on table public.goal_progress, public.goal_dashboard
  to authenticated, service_role;

-- expand_recurrence writes rows, so it is not left executable by PUBLIC.
revoke execute on function public.expand_recurrence(uuid, date) from public;
grant execute on function public.expand_recurrence(uuid, date) to authenticated, service_role;
