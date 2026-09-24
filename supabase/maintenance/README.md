# `supabase/maintenance/` — one-off scripts, run by a human

Scripts here are **not migrations** and must never be moved into `migrations/`. A migration is a
fact about the shape of every database that will ever exist; a script here is a decision about the
contents of one project, taken once, usually to clean up after a bug that is already fixed.

Nothing in this directory is run by CI, by `supabase db push`, or by the app. Every file is run by
a person, deliberately, against a project they have just taken a backup of.

The rules each script follows, and which a new one should too:

- **Report before it writes.** Running the file unchanged prints what it would do and changes
  nothing. Applying it takes a deliberate edit (a `v_apply` flag) and a second run.
- **Safe to run twice.** The second run finds nothing left to do and says so.
- **Never destroy a record of something somebody did.** A completed occurrence, a check-in: these
  may be moved or unlinked, never deleted and never given a different status.
- **Re-check at apply time.** Every statement is guarded on the row still being what the plan
  described, so a plan left sitting while somebody used the app skips rather than misfires.
- **Say what it cannot undo**, in the file's own header, before anyone runs it.

| File                     | What it is for                                                          |
| ------------------------ | ----------------------------------------------------------------------- |
| `dedupe_recurrences.sql` | Removes redundant duplicate repeat rules left on a goal by a client bug |

## `dedupe_recurrences.sql`

**The bug it cleans up after.** The rule editor could create a second and third repeat rule on one
goal while only ever being able to address the first. Each rule materialises the same days, so the
calendar showed a Tuesday two or three times and editing "the" rule only moved one of them. The
cause is fixed in the client; the rows it already created are not, and no route removes them —
`DELETE /api/goals/:goalId/recurrences/:recurrenceId` needs a rule id, and the interface could
only ever name the first one.

**What it considers a duplicate.** Only rules on the same goal that are identical in every field
that decides which days they produce: frequency, interval, weekdays (sorted, so `{4,2}` and
`{2,4}` are one rule), start date, end date, start and end time, time zone, and whether the rule
is paused. Two rules that differ in any of those are two different plans — one of them may be
exactly what somebody wanted — so they are reported and **left alone**. Choosing between those is
a person's job, in the app.

**What survives.** The most recently updated rule of each identical group. Every occurrence the
others had already put on the calendar is dealt with one at a time: re-pointed at the surviving
rule if that day is free beside it, kept as an unlinked one-off if it carries something (completed,
skipped, hand-edited) and the day is not free, and deleted only when it is plain planned days the
surviving rule already covers. Where a duplicate's row carries something and the surviving rule's
row for that day is unlived plan, the plain one is removed so the one that records something can
take its place — otherwise the script would leave behind exactly the double-booked day it exists
to remove.

**What it cannot undo.** Deleted planned occurrences and deleted duplicate rules are gone, and an
unlinked occurrence has permanently lost which rule made it (it keeps its day, time, status and
completion). There is no journal. Take a backup first.

```bash
# 1. Read the plan. Changes nothing.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/maintenance/dedupe_recurrences.sql

# 2. Change `v_apply boolean := false;` to `true` in STEP 3, then run it again.
```

Run it as `service_role` or the table owner — it has to see every account's rows — and run the
whole file in one session: step 3 reads a temporary table step 1 builds.

_Verified on PostgreSQL 17_ with every migration applied and a goal carrying three identical
weekly rules (one of them with its weekdays in the other order), a completed occurrence on one
duplicate, a skipped day on another, a gap in the surviving rule's own days, and a second goal
carrying two genuinely different rules. Result: three rules became one, the second goal was
untouched, the completed and skipped days survived with their statuses, the calendar went from 34
days appearing two and three times to 34 days appearing once each, and a second run reported
`Nothing to do`.
