-- =============================================================================
-- progress-tracker :: 20260917100100_ownership_hardening
--
-- Two cross-tenant holes found while re-reading the RLS policies with
-- auth.uid() about to become a real value. Neither is a read leak -- RLS still
-- stops anyone reading anyone else's rows -- but both let one session attach a
-- row of its own to another session's object, and one of them is a genuine
-- denial-of-service on someone else's calendar.
--
-- The schema already had the right pattern for this: goals carries
-- `unique (id, user_id)` so children can reference (goal_id, user_id) with a
-- COMPOSITE foreign key and therefore cannot claim a parent they do not own.
-- These two columns were simply left as plain single-column FKs.
--
-- HOLE 1 -- calendar_entries.recurrence_id
--   `references public.recurrences (id)` with no owner check. A session could
--   insert its own calendar entry carrying somebody else's recurrence_id: legal
--   under calendar_entries_insert (user_id is its own) and legal under the FK.
--   That row then occupies (recurrence_id, entry_date) in
--   calendar_entries_recurrence_day_uidx -- the unique index that makes
--   public.expand_recurrence() idempotent via ON CONFLICT DO NOTHING. The real
--   owner's expansion for that day would silently do nothing, and the
--   occurrence would never appear on their calendar. A handful of rows could
--   blank out another person's schedule.
--
-- HOLE 2 -- progress_entries.calendar_entry_id
--   Same shape: a check-in could be linked to another session's calendar entry.
--   Today nothing reads that link (public.goal_progress does not join on it),
--   so the impact is confined to the ON DELETE SET NULL side effect -- but it
--   is a foreign key pointing across a tenant boundary, and Phase 2's write
--   routes are exactly the code that would start trusting it.
--
-- ON DELETE SET NULL (column_list) is PostgreSQL 15+, which is what makes this
-- fix possible at all: the plain form would try to NULL user_id too, and
-- user_id is NOT NULL, so the parent delete would fail at runtime instead.
-- =============================================================================

-- The targets of the two composite keys. goals already has its equivalent
-- (goals_id_user_id_key); these are the same idea for the other two parents.
do $$ begin
  alter table public.recurrences add constraint recurrences_id_user_id_key unique (id, user_id);
exception when duplicate_table or duplicate_object then null;
end $$;

do $$ begin
  alter table public.calendar_entries
    add constraint calendar_entries_id_user_id_key unique (id, user_id);
exception when duplicate_table or duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Hole 1: an entry may only cite a rule with the same owner.
--
-- MATCH SIMPLE (the default) means the constraint simply does not apply while
-- recurrence_id IS NULL -- which is every ad-hoc, one-off entry, exactly as
-- intended. user_id stays anchored by its own FK to public.users.
-- -----------------------------------------------------------------------------
alter table public.calendar_entries
  drop constraint if exists calendar_entries_recurrence_id_fkey;

do $$ begin
  alter table public.calendar_entries
    add constraint calendar_entries_recurrence_fk
    foreign key (recurrence_id, user_id) references public.recurrences (id, user_id)
    on delete set null (recurrence_id);
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Hole 2: a check-in may only cite an entry with the same owner.
-- -----------------------------------------------------------------------------
alter table public.progress_entries
  drop constraint if exists progress_entries_calendar_entry_id_fkey;

do $$ begin
  alter table public.progress_entries
    add constraint progress_entries_calendar_entry_fk
    foreign key (calendar_entry_id, user_id) references public.calendar_entries (id, user_id)
    on delete set null (calendar_entry_id);
exception when duplicate_object then null;
end $$;

comment on column public.calendar_entries.recurrence_id is
  'The rule this occurrence was materialised from. Composite FK with user_id: an entry can only cite a rule its own owner holds.';
comment on column public.progress_entries.calendar_entry_id is
  'Optional link to the timeline. Composite FK with user_id: a check-in can only cite an entry its own owner holds.';
