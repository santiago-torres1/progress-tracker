-- =============================================================================
-- progress-tracker :: one-off -- remove redundant duplicate repeat rules
--
-- NOT A MIGRATION. Nothing here changes the schema, and it must never be added
-- to migrations/: it edits one project's data, once, to clean up after a bug
-- that has since been fixed on the client. A migration is a fact about the
-- shape of every database; this is a decision about one database's contents.
--
-- WHAT WENT WRONG. The rule editor could create a SECOND and THIRD repeat rule
-- on a goal while only ever being able to address the first, so a goal ended up
-- with several identical rules, each materialising the same days. The calendar
-- shows one occurrence per rule, so a Tuesday appears two or three times, and
-- editing "the" rule only ever moved one of them.
--
-- WHAT THIS DOES. For every group of rules on ONE goal that are IDENTICAL in
-- every field that decides which days they produce, it keeps the most recently
-- updated one and removes the others -- after dealing with each occurrence the
-- removed rules had already put on the calendar:
--
--   repoint_entry     the surviving rule has nothing on that day, so the
--                     occurrence is simply re-pointed at it. Nothing about the
--                     row changes except which rule it belongs to.
--   delete_kept_entry the surviving rule's own row for that day is plain, unlived
--                     plan, and the duplicate's row for the same day is not --
--                     it is completed, skipped, or was edited by hand. Keeping
--                     both would leave exactly the double-booked day this
--                     script exists to remove, and keeping the plain one would
--                     throw away the only row that records anything. So the
--                     plain one goes and the one that carries something takes
--                     its place (the repoint_entry paired with it). It is only
--                     ever a 'planned', non-exception row that is deleted here.
--   detach_entry      the surviving rule already has that day, the duplicate's
--                     row carries something, and the place beside the surviving
--                     rule is already taken (a second duplicate got there
--                     first). The row is kept exactly as it is, with its
--                     recurrence_id cleared, so it stays on the calendar as a
--                     one-off. public.goal_progress does not look at
--                     recurrence_id, so a completed session still counts.
--   delete_entry      the surviving rule already has that day and the duplicate
--                     row is a plain planned occurrence, or a tombstone of a
--                     rule that is going away. It records nothing the surviving
--                     rule does not already say, so it goes.
--   delete_recurrence the duplicate rule itself, once its occurrences are dealt
--                     with.
--
-- WHAT IT WILL NOT DO. Two rules on one goal that differ in ANY of freq,
-- interval, weekdays, start date, end date, start/end time, time zone or
-- paused-ness are NOT duplicates -- they are two different plans, and one of
-- them may be what somebody actually wanted. Those goals are listed in the
-- report as "several distinct rules" and left completely alone. Deciding
-- between them is a person's job, through the app.
--
-- A COMPLETED OCCURRENCE IS NEVER DELETED and never changes status. The most
-- that happens to one is that its recurrence_id moves or is cleared.
--
-- WHAT IT CANNOT UNDO. Everything in the apply step is permanent and there is
-- no journal:
--   * a deleted duplicate planned occurrence cannot be brought back, except by
--     the surviving rule having planned that day anyway (which is the condition
--     under which it was deleted);
--   * a deleted duplicate rule is gone -- if it turns out it was not redundant
--     after all, it has to be recreated by hand in the app;
--   * a detached occurrence has lost which rule made it, permanently. It keeps
--     its day, time, status and completion.
-- Take a backup first if the project is worth one.
--
-- SAFE TO RUN TWICE. Everything it does removes duplicates, so a second run
-- finds no duplicate groups and plans nothing. The apply step also re-checks
-- each row's current status against the plan and skips anything that has
-- changed since, so a plan left sitting while somebody used the app cannot be
-- applied to a row it no longer describes.
--
-- HOW TO RUN IT. As service_role or the table owner (it must see every
-- account's rows), top to bottom, IN ONE SESSION -- step 3 reads a temporary
-- table step 1 builds:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/maintenance/dedupe_recurrences.sql
--
-- Step 3 does nothing until you change `v_apply := false` to `true`. So: run
-- the file, read the plan, change the line, run it again.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off

-- -----------------------------------------------------------------------------
-- STEP 0. What is out there. Read this first; it changes nothing.
--
-- `shape` is what makes two rules the same rule: every field that decides which
-- days it produces, with the weekday list sorted so '{4,2}' and '{2,4}' are one
-- shape rather than two.
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== STEP 0: goals with more than one repeat rule ==='

with shaped as (
  select
    r.id,
    r.goal_id,
    r.updated_at,
    md5(
      row(
        r.goal_id, r.freq, r.interval_count,
        coalesce(
          (select array_agg(w order by w) from unnest(r.byweekday) as w),
          '{}'::smallint[]
        ),
        r.start_date, r.until_date, r.start_time, r.end_time, r.time_zone, r.is_active
      )::text
    ) as shape
  from public.recurrences r
)
select
  s.goal_id,
  g.title,
  count(*) as rules,
  count(distinct s.shape) as distinct_shapes,
  count(*) - count(distinct s.shape) as removable_duplicates,
  case
    when count(*) - count(distinct s.shape) = 0 then 'several DISTINCT rules - left alone'
    when count(distinct s.shape) = 1 then 'all identical - this script keeps one'
    else 'mixed - identical ones deduplicated, distinct ones left alone'
  end as verdict
from shaped s
join public.goals g on g.id = s.goal_id
group by s.goal_id, g.title
having count(*) > 1
order by removable_duplicates desc, s.goal_id;

-- -----------------------------------------------------------------------------
-- STEP 1. Build the plan. Still changes nothing.
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== STEP 1: building the plan ==='

-- pg_temp-qualified throughout, so nothing here can name a real table by accident.
drop table if exists pg_temp.dedupe_recurrence_plan;

create temporary table dedupe_recurrence_plan (
  goal_id uuid not null,
  keep_recurrence_id uuid not null,
  drop_recurrence_id uuid not null,
  entry_id uuid,
  entry_date date,
  entry_status text,
  action text not null
);

insert into pg_temp.dedupe_recurrence_plan
with shaped as (
  select
    r.*,
    md5(
      row(
        r.goal_id, r.freq, r.interval_count,
        coalesce(
          (select array_agg(w order by w) from unnest(r.byweekday) as w),
          '{}'::smallint[]
        ),
        r.start_date, r.until_date, r.start_time, r.end_time, r.time_zone, r.is_active
      )::text
    ) as shape
  from public.recurrences r
),
ranked as (
  -- Most recently updated survives; created_at and then id break ties, so the
  -- same rule wins on every run and the plan is reproducible.
  select
    s.*,
    row_number() over (
      partition by s.shape order by s.updated_at desc, s.created_at desc, s.id desc
    ) as rn,
    first_value(s.id) over (
      partition by s.shape order by s.updated_at desc, s.created_at desc, s.id desc
    ) as keep_id
  from shaped s
),
losers as (
  select r.id as drop_id, r.keep_id, r.goal_id from ranked r where r.rn > 1
),
keeper_days as (
  select ce.recurrence_id, ce.entry_date, ce.id as entry_id, ce.status::text as status, ce.is_exception
  from public.calendar_entries ce
  where ce.recurrence_id in (select distinct l.keep_id from losers l)
),
loser_entries as (
  select
    l.goal_id,
    l.keep_id,
    l.drop_id,
    ce.id as entry_id,
    ce.entry_date,
    ce.status::text as status,
    ce.is_exception,
    -- Which duplicate row gets the free day, when two duplicates both hold it:
    -- the one that carries the most. Completions first, then decisions, then
    -- hand-edited rows, then plain plan.
    row_number() over (
      partition by l.keep_id, ce.entry_date
      order by
        case ce.status
          when 'completed' then 0
          when 'skipped' then 1
          when 'cancelled' then 2
          else 3
        end,
        ce.is_exception desc,
        ce.created_at,
        ce.id
    ) as pick
  from losers l
  join public.calendar_entries ce on ce.recurrence_id = l.drop_id
),
-- Every loser occurrence, beside the surviving rule's own row for that day (if
-- it has one). `carries` is the whole judgement: a row that is completed,
-- skipped or hand-edited says something no rule can regenerate; a plain planned
-- row says only what the rule already says.
decided as (
  select
    le.*,
    kd.entry_id as keeper_entry_id,
    kd.status as keeper_status,
    kd.is_exception as keeper_is_exception,
    (le.status in ('completed', 'skipped') or le.is_exception) as carries,
    (kd.entry_id is not null and kd.status = 'planned' and not kd.is_exception) as keeper_is_plain
  from loser_entries le
  left join keeper_days kd
    on kd.recurrence_id = le.keep_id and kd.entry_date = le.entry_date
)
select
  d.goal_id, d.keep_id, d.drop_id, d.keeper_entry_id, d.entry_date, d.keeper_status,
  'delete_kept_entry'
from decided d
where d.pick = 1 and d.carries and d.keeper_is_plain

union all

select
  d.goal_id,
  d.keep_id,
  d.drop_id,
  d.entry_id,
  d.entry_date,
  d.status,
  case
    -- The day is free beside the surviving rule -- either it never had one, or
    -- the row above is about to remove the plain one it did have.
    when d.pick = 1 and (d.keeper_entry_id is null or (d.carries and d.keeper_is_plain))
      then 'repoint_entry'
    -- A tombstone shadows ONE rule's occurrence on one day (see
    -- 20260924100000). Its rule is going away and the surviving rule's row for
    -- that day stands, so the tombstone has nothing left to shadow.
    when d.status = 'cancelled' then 'delete_entry'
    when d.carries then 'detach_entry'
    else 'delete_entry'
  end as action
from decided d

union all

select l.goal_id, l.keep_id, l.drop_id, null, null, null, 'delete_recurrence'
from losers l;

-- -----------------------------------------------------------------------------
-- STEP 2. Read the plan. This is the "prints what it would do" step.
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== STEP 2: the plan, in summary ==='

select
  p.action,
  count(*) as rows_affected,
  count(distinct p.goal_id) as goals,
  count(*) filter (where p.entry_status = 'completed') as completed_occurrences_touched
from pg_temp.dedupe_recurrence_plan p
group by p.action
order by p.action;

\echo ''
\echo '=== STEP 2b: the plan, per goal ==='

select
  p.goal_id,
  g.title,
  count(*) filter (where p.action = 'delete_recurrence') as duplicate_rules_removed,
  count(*) filter (where p.action = 'repoint_entry') as occurrences_repointed,
  count(*) filter (where p.action = 'delete_kept_entry') as plain_days_cleared,
  count(*) filter (where p.action = 'detach_entry') as occurrences_detached,
  count(*) filter (where p.action = 'delete_entry') as occurrences_deleted,
  min(p.entry_date) filter (where p.entry_date is not null) as earliest_day,
  max(p.entry_date) filter (where p.entry_date is not null) as latest_day
from pg_temp.dedupe_recurrence_plan p
join public.goals g on g.id = p.goal_id
group by p.goal_id, g.title
order by duplicate_rules_removed desc, p.goal_id;

\echo ''
\echo '(every row of it: select * from pg_temp.dedupe_recurrence_plan order by goal_id, entry_date;)'

-- -----------------------------------------------------------------------------
-- STEP 3. Apply it.
--
-- Change `v_apply := false` to `v_apply := true` on the marked line and run the
-- file again. With it false this block reports and returns.
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== STEP 3: apply ==='

do $$
declare
  v_apply boolean := false; -- <<< CHANGE TO true TO APPLY >>>
  v_planned integer;
  v_cleared integer;
  v_repointed integer;
  v_detached integer;
  v_deleted integer;
  v_rules integer;
begin
  select count(*)::integer into v_planned from pg_temp.dedupe_recurrence_plan;

  if v_planned = 0 then
    raise notice 'Nothing to do: no goal has two identical repeat rules.';
    return;
  end if;

  if not v_apply then
    raise notice 'DRY RUN. % planned actions. Nothing was changed.', v_planned;
    raise notice 'Set v_apply := true in STEP 3 and run this file again to apply it.';
    return;
  end if;

  -- 1. Clear the surviving rule's plain rows where something that carries more
  -- is about to take their place. FIRST, so the re-point below has the day free.
  -- Guarded three ways on top of the plan: the row must still belong to the
  -- surviving rule, still be exactly the status the plan saw, and still be an
  -- unlived planned row.
  delete from public.calendar_entries ce
  using pg_temp.dedupe_recurrence_plan p
  where p.action = 'delete_kept_entry'
    and ce.id = p.entry_id
    and ce.recurrence_id = p.keep_recurrence_id
    and ce.status::text = p.entry_status
    and ce.status = 'planned'
    and not ce.is_exception;
  get diagnostics v_cleared = row_count;

  -- 2. Re-point. Guarded on the row still being what the plan described, so a
  -- stale plan skips rather than misfires, and on the day beside the surviving
  -- rule actually being free -- which it is by construction, and the NOT EXISTS
  -- is what turns "by construction" into "or nothing happens" if the plan has
  -- gone stale under it. calendar_entries_recurrence_day_uidx would otherwise
  -- abort the whole block.
  update public.calendar_entries ce
  set recurrence_id = p.keep_recurrence_id
  from pg_temp.dedupe_recurrence_plan p
  where p.action = 'repoint_entry'
    and ce.id = p.entry_id
    and ce.recurrence_id = p.drop_recurrence_id
    and ce.entry_date = p.entry_date
    and ce.status::text = p.entry_status
    and not exists (
      select 1 from public.calendar_entries k
      where k.recurrence_id = p.keep_recurrence_id and k.entry_date = p.entry_date
    );
  get diagnostics v_repointed = row_count;

  -- 3. Detach. The row keeps everything it had; it just stops belonging to a
  -- rule that is about to stop existing.
  update public.calendar_entries ce
  set recurrence_id = null
  from pg_temp.dedupe_recurrence_plan p
  where p.action = 'detach_entry'
    and ce.id = p.entry_id
    and ce.recurrence_id = p.drop_recurrence_id
    and ce.status::text = p.entry_status;
  get diagnostics v_detached = row_count;

  -- 4. Delete. `status <> 'completed'` is belt and braces on top of the plan's
  -- own rule: no path above can put a completed row in this branch, and if one
  -- ever did, this statement would still refuse it.
  delete from public.calendar_entries ce
  using pg_temp.dedupe_recurrence_plan p
  where p.action = 'delete_entry'
    and ce.id = p.entry_id
    and ce.recurrence_id = p.drop_recurrence_id
    and ce.status::text = p.entry_status
    and ce.status <> 'completed';
  get diagnostics v_deleted = row_count;

  -- 5. The duplicate rules. Anything of theirs the plan missed -- a row created
  -- between the plan and the apply -- is detached by the ON DELETE SET NULL on
  -- calendar_entries.recurrence_id rather than lost.
  delete from public.recurrences r
  using pg_temp.dedupe_recurrence_plan p
  where p.action = 'delete_recurrence' and r.id = p.drop_recurrence_id;
  get diagnostics v_rules = row_count;

  raise notice 'APPLIED: % plain days cleared, % occurrences re-pointed, % detached, % deleted, % duplicate rules removed.',
    v_cleared, v_repointed, v_detached, v_deleted, v_rules;
end $$;

-- -----------------------------------------------------------------------------
-- STEP 4. Check, and tidy up.
--
-- After a successful apply this must be empty. Re-running the whole file is the
-- other check: STEP 0 reports nothing removable.
-- -----------------------------------------------------------------------------
\echo ''
\echo '=== STEP 4: duplicate shapes remaining (empty after a successful apply) ==='

with shaped as (
  select
    r.goal_id,
    md5(
      row(
        r.goal_id, r.freq, r.interval_count,
        coalesce(
          (select array_agg(w order by w) from unnest(r.byweekday) as w),
          '{}'::smallint[]
        ),
        r.start_date, r.until_date, r.start_time, r.end_time, r.time_zone, r.is_active
      )::text
    ) as shape
  from public.recurrences r
)
select s.goal_id, s.shape, count(*) as identical_rules
from shaped s
group by s.goal_id, s.shape
having count(*) > 1;

-- Leave no temporary table behind for the next thing that runs in this session.
drop table if exists pg_temp.dedupe_recurrence_plan;
