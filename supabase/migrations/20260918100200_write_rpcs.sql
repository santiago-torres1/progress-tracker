-- =============================================================================
-- progress-tracker :: 20260918100200_write_rpcs
--
-- 0.2.0-alpha Phase 2. The writes that are more than one statement.
--
-- WHAT IS HERE AND WHAT IS NOT. A write that is a single statement (create a
-- goal, rename it, archive it, correct a check-in, delete one) is done by the
-- backend through PostgREST, because a function wrapping one INSERT adds a
-- deployment step and hides the policy that is doing the work. A write that is
-- a DECISION plus a statement, or several statements that must not half-happen,
-- is here instead -- PostgREST runs one request in one transaction, so an
-- exception thrown anywhere below rolls the whole thing back.
--
-- EVERY FUNCTION HERE IS SECURITY INVOKER (the default -- stated explicitly in
-- each comment, never declared, because a stray SECURITY DEFINER would be
-- invisible in a diff). That is the whole safety argument: these run as
-- `authenticated` with the caller's JWT, so the policies in 20260916090400
-- apply to every statement inside them. A bug in the plpgsql below cannot reach
-- another session's rows, because the rows are not visible to it in the first
-- place. public.begin_request() remains the only SECURITY DEFINER function on a
-- request path.
--
-- NONE OF THEM TAKES A user_id. Ownership comes from
-- public.current_user_id() -- i.e. from the verified JWT -- and never from an
-- argument. There is no parameter a caller could set to write as somebody else.
--
-- HOW THEY FAIL. Each raises a FIXED MACHINE TOKEN as the message
-- (goal_not_found, entry_not_found, recurrence_not_found, wrong_goal_kind,
-- layout_mismatch, layout_duplicate, empty_batch) and nothing else: no id, no
-- count, no caller input, nothing about another account. The backend maps that
-- token to a status code through an allowlist, so an unrecognised error can
-- only ever become a generic 5xx -- see backend/src/lib/write.ts.
--
-- "Not found" deliberately covers "not yours". RLS makes another session's goal
-- invisible, so `select ... where id = $1` simply returns nothing, and the
-- caller cannot tell the difference between an id that does not exist and one
-- that is not theirs. That is the answer we want to give.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The caller's today.
--
-- "Complete today" and "log today's number" mean the day it is where the person
-- is, not where the server is -- public.goal_progress already computes habit
-- periods that way, and a habit week that rolls over at the wrong moment is the
-- exact bug users.time_zone exists to prevent.
-- -----------------------------------------------------------------------------
create or replace function public.current_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone u.time_zone)::date
  from public.users u
  where u.id = (select public.current_user_id());
$$;

comment on function public.current_today() is
  'Today in the caller''s own time zone, or NULL when there is no identity.';

grant execute on function public.current_today() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- public.complete_occurrence(goal, on, entry) -- "I did it."
--
-- WHAT "COMPLETE TODAY" MEANS WHEN THERE IS NOTHING TO COMPLETE.
-- A habit tile is tapped on a day its rule never named, or on a goal with no
-- rule at all. There is no row to update, so one is created -- an ad-hoc
-- completion, which public.goal_progress counts exactly like a planned one
-- ("can also add the days they run even if not a target day"). It is marked
-- created_by_completion so undo can take it back out again.
--
-- IDEMPOTENCE. Two taps that both mean "I ran today" must not count as two
-- runs. The function looks for an existing occurrence on that day first and
-- returns it untouched if it is already completed, so completing is safe to
-- retry: same day, same goal, one row, whatever the network did. `created` in
-- the result says whether a row appeared, which is what tells the calendar
-- whether to insert one.
--   The cost, stated plainly: a person who genuinely did the thing twice in one
--   day gets one completion. Recording both is storable (the unique index on
--   (recurrence_id, entry_date) does not apply to ad-hoc rows) but it needs an
--   explicit "add another", and this release's tile is a toggle -- the second
--   tap is undo.
--
-- The advisory lock is what makes that true under concurrency rather than
-- merely usually: two taps arriving together would otherwise both find no
-- occurrence and both insert one. It is transaction-scoped, keyed on the entry
-- id when one is named and on (goal, day) otherwise, so it only ever serialises
-- taps on the same square of the same person's calendar.
-- -----------------------------------------------------------------------------
create or replace function public.complete_occurrence(
  p_goal_id uuid,
  p_on date default null,
  p_entry_id uuid default null
)
returns table (
  created boolean,
  id uuid,
  goal_id uuid,
  recurrence_id uuid,
  title text,
  notes text,
  entry_date date,
  start_at timestamptz,
  end_at timestamptz,
  time_zone text,
  status public.entry_status,
  completed_at timestamptz,
  created_by_completion boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_on date;
  v_entry public.calendar_entries;
  v_found boolean := false;
  v_created boolean := false;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  -- RLS scopes this: another session's goal is simply not there.
  perform 1 from public.goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal_not_found' using errcode = 'no_data_found';
  end if;

  v_on := coalesce(p_on, public.current_today());

  perform pg_catalog.pg_advisory_xact_lock(
    2001,
    pg_catalog.hashtext(coalesce(p_entry_id::text, p_goal_id::text || '@' || v_on::text))
  );

  if p_entry_id is not null then
    select ce.* into v_entry
    from public.calendar_entries ce
    where ce.id = p_entry_id and ce.goal_id = p_goal_id;
    v_found := found;
    if not v_found then
      raise exception 'entry_not_found' using errcode = 'no_data_found';
    end if;
  else
    -- An already-completed occurrence wins (that is the idempotent case), then
    -- a planned one, then the rule's own occurrence over a stray ad-hoc row.
    select ce.* into v_entry
    from public.calendar_entries ce
    where ce.goal_id = p_goal_id
      and ce.entry_date = v_on
      and ce.status <> 'cancelled'
    order by
      (ce.status = 'completed') desc,
      (ce.status = 'planned') desc,
      (ce.recurrence_id is not null) desc,
      ce.start_at nulls last,
      ce.created_at
    limit 1;
    v_found := found;
  end if;

  if v_found then
    if v_entry.status <> 'completed' then
      update public.calendar_entries ce
      set status = 'completed',
          -- The restore point. Set here and nowhere else.
          pre_completion_status = v_entry.status
      where ce.id = v_entry.id
      returning ce.* into v_entry;
    end if;
  else
    -- time_zone is left out on purpose: calendar_entries_before_write() fills it
    -- from the user, which is the one place that rule lives.
    insert into public.calendar_entries (
      user_id, goal_id, entry_date, status, created_by_completion
    )
    values (v_user, p_goal_id, v_on, 'completed', true)
    returning * into v_entry;
    v_created := true;
  end if;

  return query select
    v_created, v_entry.id, v_entry.goal_id, v_entry.recurrence_id, v_entry.title, v_entry.notes,
    v_entry.entry_date, v_entry.start_at, v_entry.end_at, v_entry.time_zone, v_entry.status,
    v_entry.completed_at, v_entry.created_by_completion;
end;
$$;

comment on function public.complete_occurrence(uuid, date, uuid) is
  'Records a completion for a goal on a day, creating the occurrence if that day had none. Idempotent: completing an already-completed day changes nothing.';

-- -----------------------------------------------------------------------------
-- public.undo_occurrence(goal, entry) -- "no, take that back."
--
-- The exact inverse of the call above, which is why it needs no arguments
-- describing the previous state: the row remembers it.
--
--   created_by_completion  -> the row only existed to record the completion, so
--                             it is deleted and the day looks untouched again.
--   otherwise              -> status goes back to pre_completion_status, which
--                             is 'planned' for a materialised session and
--                             'skipped' for a day that had been skipped before
--                             somebody ticked it. COALESCE to 'planned' covers
--                             rows completed before this release existed (the
--                             demo seed, 0.1.x data), which have no restore
--                             point stored.
--
-- Idempotent in the direction that matters: undoing an occurrence that is not
-- completed returns action = 'noop' rather than failing, so a retried request
-- is harmless. A retry after the DELETE case gets entry_not_found -- the
-- frontend should read a 404 here as "already taken back".
-- -----------------------------------------------------------------------------
create or replace function public.undo_occurrence(p_goal_id uuid, p_entry_id uuid)
returns table (
  action text,
  id uuid,
  goal_id uuid,
  recurrence_id uuid,
  title text,
  notes text,
  entry_date date,
  start_at timestamptz,
  end_at timestamptz,
  time_zone text,
  status public.entry_status,
  completed_at timestamptz,
  created_by_completion boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_entry public.calendar_entries;
  v_action text;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(2001, pg_catalog.hashtext(p_entry_id::text));

  select ce.* into v_entry
  from public.calendar_entries ce
  where ce.id = p_entry_id and ce.goal_id = p_goal_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'no_data_found';
  end if;

  if v_entry.status <> 'completed' then
    v_action := 'noop';
  elsif v_entry.created_by_completion then
    delete from public.calendar_entries ce where ce.id = v_entry.id;
    v_action := 'deleted';
  else
    update public.calendar_entries ce
    set status = coalesce(v_entry.pre_completion_status, 'planned')
    where ce.id = v_entry.id
    returning ce.* into v_entry;
    v_action := 'restored';
  end if;

  -- On the delete path this returns the row as it was, so the client knows
  -- exactly which occurrence to remove from the calendar it is holding.
  return query select
    v_action, v_entry.id, v_entry.goal_id, v_entry.recurrence_id, v_entry.title, v_entry.notes,
    v_entry.entry_date, v_entry.start_at, v_entry.end_at, v_entry.time_zone, v_entry.status,
    v_entry.completed_at, v_entry.created_by_completion;
end;
$$;

comment on function public.undo_occurrence(uuid, uuid) is
  'Takes a completion back: deletes the occurrence if the completion created it, otherwise restores the status it had before.';

-- -----------------------------------------------------------------------------
-- public.log_measurement(goal, value, on, note) -- a check-in.
--
-- An UPSERT on (goal_id, occurred_on), which is the shape of the fact: a
-- measured goal stores where the number IS on a day, not a list of events. So
-- logging twice for one day is a correction, not a second reading, and a
-- retried request is free of consequence (see the unique index in
-- 20260918100100).
--
-- The kind check is here rather than in a route because it is an invariant of
-- the data, not of one endpoint: a numeric check-in against a habit would be a
-- row public.goal_progress never reads, sitting against that goal's cap.
-- -----------------------------------------------------------------------------
create or replace function public.log_measurement(
  p_goal_id uuid,
  p_value numeric,
  p_occurred_on date default null,
  p_note text default null
)
returns table (
  id uuid,
  goal_id uuid,
  calendar_entry_id uuid,
  occurred_on date,
  value numeric,
  note text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
set search_path = ''
as $$
-- ON CONFLICT's target is a column list, and plpgsql resolves bare names in it
-- against this function's OUT parameters first -- one of which is called
-- goal_id, so `on conflict (goal_id, occurred_on)` is ambiguous without this.
-- Every other reference below is either qualified or v_-prefixed, so nothing
-- else changes meaning.
#variable_conflict use_column
declare
  v_user uuid := (select public.current_user_id());
  v_kind public.goal_kind;
  v_on date;
  v_row public.progress_entries;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  select g.kind into v_kind from public.goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal_not_found' using errcode = 'no_data_found';
  end if;
  if v_kind <> 'measured' then
    raise exception 'wrong_goal_kind' using errcode = 'invalid_parameter_value';
  end if;

  v_on := coalesce(p_occurred_on, public.current_today());

  insert into public.progress_entries (user_id, goal_id, occurred_on, value, note)
  values (v_user, p_goal_id, v_on, p_value, p_note)
  on conflict (goal_id, occurred_on) do update
    -- Full replacement, including clearing a note: the row is "the value on
    -- that day", so a later log of that day supersedes it entirely.
    set value = excluded.value, note = excluded.note
  returning * into v_row;

  return query select
    v_row.id, v_row.goal_id, v_row.calendar_entry_id, v_row.occurred_on,
    v_row.value, v_row.note, v_row.created_at, v_row.updated_at;
end;
$$;

comment on function public.log_measurement(uuid, numeric, date, text) is
  'Records a measured goal''s value on a day. Upserts on (goal, day), so it is safe to retry and doubles as "correct today''s number".';

-- -----------------------------------------------------------------------------
-- public.set_goal_layout(items) -- the canvas, after a drag.
--
-- One call for a whole board rather than N calls: dragging a tile renumbers
-- several of them, and N round trips over a phone connection is N chances to
-- half-apply the move. ALL OR NOTHING is the point of this function:
--
--   * It is one UPDATE. Every row moves in the same statement.
--   * It counts what it changed. If any id in the batch matched no row the
--     caller can see -- a typo, a goal deleted in another tab, or another
--     session's goal, which RLS makes invisible -- it raises, and the
--     transaction takes the whole batch back with it. A board is never left
--     half-reordered.
--   * Duplicated ids are refused outright, because "which of the two wins" has
--     no honest answer.
--
-- Only sort_order and size. This is the one write that is allowed to touch
-- several goals at once, so it is deliberately the write that can do the least.
-- -----------------------------------------------------------------------------
create or replace function public.set_goal_layout(p_items jsonb)
returns table (id uuid, sort_order integer, size public.goal_size)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_expected integer;
  v_distinct integer;
  v_updated integer;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'empty_batch' using errcode = 'invalid_parameter_value';
  end if;

  select count(*)::integer, count(distinct i.item ->> 'id')::integer
  into v_expected, v_distinct
  from pg_catalog.jsonb_array_elements(p_items) as i(item);

  if v_expected = 0 then
    raise exception 'empty_batch' using errcode = 'invalid_parameter_value';
  end if;
  if v_distinct <> v_expected then
    raise exception 'layout_duplicate' using errcode = 'invalid_parameter_value';
  end if;

  return query
  with items as (
    select
      (i.item ->> 'id')::uuid as goal_id,
      (i.item ->> 'sort_order')::integer as sort_order,
      (i.item ->> 'size')::public.goal_size as size
    from pg_catalog.jsonb_array_elements(p_items) as i(item)
  )
  update public.goals g
  -- COALESCE, so a batch that only reorders does not have to restate every
  -- tile's size (and cannot accidentally reset one).
  set sort_order = coalesce(it.sort_order, g.sort_order),
      size = coalesce(it.size, g.size)
  from items it
  where g.id = it.goal_id
  returning g.id, g.sort_order, g.size;

  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    -- Raising after RETURN QUERY is what discards those rows: the exception
    -- aborts the statement, and PostgREST's transaction with it.
    raise exception 'layout_mismatch' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.set_goal_layout(jsonb) is
  'Applies a batch of {id, sort_order, size} tile moves in one statement. Raises, and applies nothing, unless every id matched a goal the caller owns.';

-- -----------------------------------------------------------------------------
-- Recurrences: the rule, and the rows it materialises, kept in step.
--
-- public.expand_recurrence() writes occurrences up to a horizon. What it
-- deliberately does NOT do is notice that the rule changed -- it only ever
-- INSERTs, and only past generated_through. So editing a rule is three
-- statements, in this order, and they are the ones supabase/README.md has
-- documented since 0.1.1:
--
--   1. delete future PLANNED, NON-EXCEPTION occurrences of that rule;
--   2. reset generated_through, so expansion starts from the rule's start date;
--   3. expand again, to today + the horizon.
--
-- Step 1 is where completed history survives: it names `status = 'planned'`, so
-- a completed or skipped session is never touched, and `not is_exception`, so a
-- single occurrence somebody dragged to another time is left alone. It also
-- names `entry_date > today`, so the past is never rewritten. Step 3 cannot
-- overwrite anything either -- ON CONFLICT DO NOTHING on
-- (recurrence_id, entry_date).
--
-- Ad-hoc completions (recurrence_id IS NULL) are outside all three statements,
-- so an unplanned run stays exactly where it was.
-- -----------------------------------------------------------------------------
create or replace function public.resync_recurrence(p_recurrence_id uuid)
returns table (occurrences_removed integer, occurrences_created integer)
language plpgsql
set search_path = ''
as $$
declare
  v_today date := public.current_today();
  v_removed integer := 0;
  v_created integer := 0;
begin
  delete from public.calendar_entries ce
  where ce.recurrence_id = p_recurrence_id
    and ce.status = 'planned'
    and not ce.is_exception
    and ce.entry_date > v_today;
  get diagnostics v_removed = row_count;

  update public.recurrences r set generated_through = null where r.id = p_recurrence_id;

  select public.expand_recurrence(p_recurrence_id, v_today + public.recurrence_horizon_days())
  into v_created;

  return query select v_removed, v_created;
end;
$$;

comment on function public.resync_recurrence(uuid) is
  'Re-materialises a rule after it changed: drops future planned occurrences, keeps completed and edited ones, expands to the horizon.';

create or replace function public.create_recurrence(
  p_goal_id uuid,
  p_freq public.recurrence_freq,
  p_start_date date,
  p_interval_count integer default 1,
  p_byweekday integer[] default null,
  p_until_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_time_zone text default null
)
returns table (
  id uuid,
  goal_id uuid,
  freq public.recurrence_freq,
  interval_count smallint,
  byweekday smallint[],
  start_date date,
  until_date date,
  start_time time,
  end_time time,
  time_zone text,
  generated_through date,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  occurrences_removed integer,
  occurrences_created integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_rule public.recurrences;
  v_zone text;
  v_created integer;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal_not_found' using errcode = 'no_data_found';
  end if;

  -- A rule means nothing without its zone ("19:00 in Europe/Madrid"), and the
  -- person's own zone is the only defensible default.
  select coalesce(p_time_zone, u.time_zone) into v_zone
  from public.users u where u.id = v_user;

  insert into public.recurrences (
    user_id, goal_id, freq, interval_count, byweekday,
    start_date, until_date, start_time, end_time, time_zone
  )
  values (
    v_user, p_goal_id, p_freq, p_interval_count::smallint, p_byweekday::smallint[],
    p_start_date, p_until_date, p_start_time, p_end_time, v_zone
  )
  returning * into v_rule;

  select public.expand_recurrence(
    v_rule.id, public.current_today() + public.recurrence_horizon_days()
  ) into v_created;

  return query select
    v_rule.id, v_rule.goal_id, v_rule.freq, v_rule.interval_count, v_rule.byweekday,
    v_rule.start_date, v_rule.until_date, v_rule.start_time, v_rule.end_time, v_rule.time_zone,
    (select r.generated_through from public.recurrences r where r.id = v_rule.id),
    v_rule.is_active, v_rule.created_at, v_rule.updated_at,
    0, v_created;
end;
$$;

comment on function public.create_recurrence(uuid, public.recurrence_freq, date, integer, integer[], date, time, time, text) is
  'Adds a repeat rule to a goal and materialises it to the horizon, in one transaction.';

-- A rule is replaced whole, not patched. The editor holds the entire rule
-- anyway, and a partial update would make "does the absent field mean unchanged
-- or cleared?" a question with two plausible answers -- for fields (until_date,
-- start_time) whose absence is meaningful.
create or replace function public.update_recurrence(
  p_goal_id uuid,
  p_recurrence_id uuid,
  p_freq public.recurrence_freq,
  p_start_date date,
  p_interval_count integer default 1,
  p_byweekday integer[] default null,
  p_until_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_time_zone text default null,
  p_is_active boolean default true
)
returns table (
  id uuid,
  goal_id uuid,
  freq public.recurrence_freq,
  interval_count smallint,
  byweekday smallint[],
  start_date date,
  until_date date,
  start_time time,
  end_time time,
  time_zone text,
  generated_through date,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  occurrences_removed integer,
  occurrences_created integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_rule public.recurrences;
  v_zone text;
  v_removed integer;
  v_created integer;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  select r.* into v_rule
  from public.recurrences r
  where r.id = p_recurrence_id and r.goal_id = p_goal_id;
  if not found then
    raise exception 'recurrence_not_found' using errcode = 'no_data_found';
  end if;

  v_zone := coalesce(p_time_zone, v_rule.time_zone);

  update public.recurrences r
  set freq = p_freq,
      interval_count = p_interval_count::smallint,
      byweekday = p_byweekday::smallint[],
      start_date = p_start_date,
      until_date = p_until_date,
      start_time = p_start_time,
      end_time = p_end_time,
      time_zone = v_zone,
      is_active = p_is_active
  where r.id = p_recurrence_id
  returning r.* into v_rule;

  select rs.occurrences_removed, rs.occurrences_created into v_removed, v_created
  from public.resync_recurrence(p_recurrence_id) rs;

  return query select
    v_rule.id, v_rule.goal_id, v_rule.freq, v_rule.interval_count, v_rule.byweekday,
    v_rule.start_date, v_rule.until_date, v_rule.start_time, v_rule.end_time, v_rule.time_zone,
    (select r.generated_through from public.recurrences r where r.id = v_rule.id),
    v_rule.is_active, v_rule.created_at, v_rule.updated_at,
    v_removed, v_created;
end;
$$;

comment on function public.update_recurrence(uuid, uuid, public.recurrence_freq, date, integer, integer[], date, time, time, text, boolean) is
  'Replaces a rule and re-materialises it. Completed, skipped and hand-edited occurrences survive; future planned ones are regenerated.';

-- Deleting the rule keeps the history it produced. The composite FK is
-- ON DELETE SET NULL (recurrence_id), so completed sessions survive as ordinary
-- entries -- the progress they made is a fact, and removing the plan they came
-- from does not unmake it. Only the future plan is swept.
create or replace function public.delete_recurrence(p_goal_id uuid, p_recurrence_id uuid)
returns table (id uuid, occurrences_removed integer, occurrences_kept integer)
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select public.current_user_id());
  v_rule public.recurrences;
  v_today date := public.current_today();
  v_removed integer := 0;
  v_kept integer := 0;
begin
  if v_user is null then
    raise exception 'no_identity' using errcode = 'insufficient_privilege';
  end if;

  select r.* into v_rule
  from public.recurrences r
  where r.id = p_recurrence_id and r.goal_id = p_goal_id;
  if not found then
    raise exception 'recurrence_not_found' using errcode = 'no_data_found';
  end if;

  delete from public.calendar_entries ce
  where ce.recurrence_id = p_recurrence_id
    and ce.status = 'planned'
    and not ce.is_exception
    and ce.entry_date > v_today;
  get diagnostics v_removed = row_count;

  select count(*)::integer into v_kept
  from public.calendar_entries ce
  where ce.recurrence_id = p_recurrence_id;

  delete from public.recurrences r where r.id = p_recurrence_id;

  return query select p_recurrence_id, v_removed, v_kept;
end;
$$;

comment on function public.delete_recurrence(uuid, uuid) is
  'Removes a repeat rule and its future plan. Occurrences that already happened are kept, detached from the rule.';

-- -----------------------------------------------------------------------------
-- Privileges.
--
-- Not left executable by PUBLIC (which would include anon): every one of these
-- writes rows, and although RLS would refuse an anonymous caller anyway, a
-- function that writes should not be callable by a role that has no business
-- calling it. service_role is granted alongside authenticated only so a
-- maintenance script can use them; nothing on a request path runs as it.
-- -----------------------------------------------------------------------------
revoke execute on function
  public.complete_occurrence(uuid, date, uuid),
  public.undo_occurrence(uuid, uuid),
  public.log_measurement(uuid, numeric, date, text),
  public.set_goal_layout(jsonb),
  public.resync_recurrence(uuid),
  public.create_recurrence(uuid, public.recurrence_freq, date, integer, integer[], date, time, time, text),
  public.update_recurrence(uuid, uuid, public.recurrence_freq, date, integer, integer[], date, time, time, text, boolean),
  public.delete_recurrence(uuid, uuid)
from public;

grant execute on function
  public.complete_occurrence(uuid, date, uuid),
  public.undo_occurrence(uuid, uuid),
  public.log_measurement(uuid, numeric, date, text),
  public.set_goal_layout(jsonb),
  public.resync_recurrence(uuid),
  public.create_recurrence(uuid, public.recurrence_freq, date, integer, integer[], date, time, time, text),
  public.update_recurrence(uuid, uuid, public.recurrence_freq, date, integer, integer[], date, time, time, text, boolean),
  public.delete_recurrence(uuid, uuid)
to authenticated, service_role;
