-- =============================================================================
-- progress-tracker :: 20260918100000_goal_templates
--
-- 0.2.0-alpha Phase 2. The starting sets a new visitor picks from: six per life
-- area, 36 in all. docs/goal-catalogue.md is the source of truth for the list;
-- change it there and change this table in the same pull request.
--
-- A TABLE, NOT AN ENUM OR A CONSTANT IN TYPESCRIPT.
-- The catalogue was approved as a starting point and is expected to be edited
-- as the app is used. Rows can be added, retired (is_active = false) and
-- reordered by one migration; an enum would need a type change, and a constant
-- in the frontend would put product content behind a redeploy of the browser
-- bundle. It is also the same shape life_areas already uses, for the same
-- reason.
--
-- THE TWO PRODUCT RULES, EXPRESSED IN THE MODEL RATHER THAN IN A ROUTE:
--
--   1. "Everything a template suggests is editable."
--      public.goals gains NO template_id column, and there is no foreign key in
--      either direction. A template seeds a form; the row that comes back is an
--      ordinary goal with no memory of where its numbers came from. Editing a
--      template later therefore CANNOT reach into anybody's goal, and no field
--      can be marked read-only because it arrived from one -- there is nothing
--      to read it back from. Every column below is named `suggested_*` to say
--      so at the point of use.
--
--   2. "Every area also offers a custom goal."
--      Nothing here special-cases "Something else", because the write path
--      never mentions a template at all: POST /api/goals takes plain fields.
--      Picking a template is a client-side pre-fill, so "no template" is not a
--      branch -- it is the only path there is. GET /api/goal-templates returns
--      every area, including one with no templates, so a custom goal is always
--      offered by the shape of the response rather than by UI special-casing.
--
-- WHY THE SUGGESTIONS ARE ALL NULLABLE.
-- "Reach a weight" cannot know which weight, and "Save for something specific"
-- cannot know how much. A template that had to carry a number would have to
-- invent one. NULL means "the person supplies this", which is different from 0.
-- =============================================================================

create table if not exists public.goal_templates (
  id uuid primary key default gen_random_uuid(),

  -- Which of the six life areas the picker files this under. NOT NULL: the
  -- catalogue is organised by area, and an area-less template would have
  -- nowhere to appear. Built-in areas only in practice (they are the only ones
  -- that exist), but the FK deliberately does not say so -- user-defined areas
  -- are a planned release and a user's own template would be the same row.
  life_area_id uuid not null references public.life_areas (id) on delete cascade,

  -- Stable machine name. The frontend may key an illustration off it; it is
  -- never stored on a goal.
  slug text not null,

  -- Second-person and deliberately unspecific: the person makes it concrete.
  title text not null,

  kind public.goal_kind not null,

  -- kind = 'measured' -------------------------------------------------------
  suggested_measurement_unit text,
  suggested_start_value numeric(14, 4),
  suggested_target_value numeric(14, 4),

  -- kind = 'habit' ----------------------------------------------------------
  suggested_target_count integer,
  suggested_minimum_count integer,
  suggested_habit_period public.habit_period,

  -- kind = 'scheduled' ------------------------------------------------------
  suggested_target_sessions integer,

  -- Cadence, for the recurrence editor rather than for the goal row: "repeats
  -- weekly", "repeats monthly". byweekday is deliberately absent -- which days
  -- somebody runs is not something a catalogue can guess, and a weekly rule
  -- needs real days before it can be saved.
  suggested_freq public.recurrence_freq,
  suggested_interval_count smallint,

  sort_order integer not null default 0,

  -- Retiring a template must not rewrite history or renumber ids, and a goal
  -- created from one is unaffected either way (there is no link). So retire by
  -- flipping this, never by DELETE.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint goal_templates_slug_format check (slug ~ '^[a-z][a-z0-9_-]{1,59}$'),
  constraint goal_templates_slug_key unique (slug),
  constraint goal_templates_title_not_blank check (btrim(title) <> '' and length(title) <= 200),
  constraint goal_templates_interval_positive check (
    suggested_interval_count is null or suggested_interval_count > 0
  ),

  -- The same shape rule public.goals enforces, minus the "must be present"
  -- half: a suggestion may always be absent, but a suggestion belonging to
  -- another kind is a data bug and is unstorable. `else false` for the same
  -- reason as goals_kind_fields -- a new goal_kind has to declare itself here.
  constraint goal_templates_kind_fields check (
    case kind
      when 'measured' then
        (suggested_start_value is null
         or suggested_target_value is null
         or suggested_start_value <> suggested_target_value)
        and suggested_target_count is null
        and suggested_minimum_count is null
        and suggested_habit_period is null
        and suggested_target_sessions is null
      when 'habit' then
        suggested_habit_period is not null
        and suggested_target_count is not null
        and suggested_target_count > 0
        and suggested_minimum_count is not null
        and suggested_minimum_count >= 1
        and suggested_minimum_count <= suggested_target_count
        and suggested_measurement_unit is null
        and suggested_start_value is null
        and suggested_target_value is null
        and suggested_target_sessions is null
      when 'scheduled' then
        (suggested_target_sessions is null or suggested_target_sessions > 0)
        and suggested_measurement_unit is null
        and suggested_start_value is null
        and suggested_target_value is null
        and suggested_target_count is null
        and suggested_minimum_count is null
        and suggested_habit_period is null
      else false
    end
  )
);

comment on table public.goal_templates is
  'The goal catalogue: suggested starting points, six per life area. Reference data, never referenced by a goal -- a template seeds a form and is forgotten.';
comment on column public.goal_templates.suggested_minimum_count is
  'Ships well below the target on purpose, so a new habit encourages from its first week. See CLAUDE.md.';
comment on column public.goal_templates.suggested_freq is
  'Cadence for the recurrence editor, not a field of the goal. No byweekday: which days is the person''s to choose.';

create index if not exists goal_templates_area_sort_idx
  on public.goal_templates (life_area_id, sort_order, title) where is_active;

create or replace trigger goal_templates_set_updated_at
  before update on public.goal_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-level security.
--
-- Read-only to a session, and writable by nobody: there is no INSERT, UPDATE or
-- DELETE policy and no such grant, so the only way this table changes is a
-- migration. Retired rows are invisible rather than filtered by the API, so a
-- forgotten `.eq('is_active', true)` cannot resurrect one.
-- -----------------------------------------------------------------------------
alter table public.goal_templates enable row level security;

drop policy if exists goal_templates_select on public.goal_templates;
create policy goal_templates_select on public.goal_templates
  for select to authenticated
  using (is_active);

revoke all on table public.goal_templates from anon, authenticated;
grant select on table public.goal_templates to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The catalogue itself, from docs/goal-catalogue.md.
--
-- Joined to life_areas by slug rather than by a hardcoded id: the six ids are
-- fixed constants in 20260916090500, but a join says WHY each row lands where
-- it does, and it fails loudly if an area is ever renamed out from under it.
--
-- Fixed ids + ON CONFLICT DO NOTHING keeps the migration re-runnable.
--
-- THREE PLACES THE CATALOGUE'S PROSE DOES NOT FIT THE SCHEMA, AND WHAT WAS DONE:
--
--   * "daily, minimum 3/week" (Drink more water) and "daily, minimum 5/week"
--     (Take medication). A habit has ONE period, and the minimum lives inside
--     it -- so these are stored as a WEEKLY period with a target of 7. The
--     intent survives exactly: aim for every day, and three (or five) is still
--     keeping it.
--   * "weekly, min 1/month" (Keep in touch with family, Check in on someone,
--     Play more) and "weekly, min 2/month" (Stick to a spending limit) become a
--     MONTHLY period with a target of 4 -- the same two numbers, expressed in
--     the larger of the two windows, which is the one the minimum is stated in.
--   * "monthly, min 1/quarter" (Meet someone new). There is no quarter period,
--     and inventing one for a single template is the wrong trade. Stored as
--     monthly 1/1; the person can widen it, which is what rule 1 is for.
--
-- Scheduled templates whose catalogue entry is a cadence rather than a count
-- ("3 sessions/week", "weekly", "monthly") carry suggested_freq and no
-- suggested_target_sessions: they are open-ended goals that repeat, and
-- progress reports adherence. The "3" in "3 sessions/week" is expressed when
-- the person picks their three days in the recurrence editor.
-- -----------------------------------------------------------------------------
insert into public.goal_templates (
  id, life_area_id, slug, title, kind, sort_order,
  suggested_measurement_unit, suggested_start_value, suggested_target_value,
  suggested_target_count, suggested_minimum_count, suggested_habit_period,
  suggested_target_sessions, suggested_freq, suggested_interval_count
)
select
  v.id::uuid,
  la.id,
  v.slug,
  v.title,
  v.kind::public.goal_kind,
  v.sort_order,
  v.unit,
  v.start_value::numeric(14, 4),
  v.target_value::numeric(14, 4),
  v.target_count,
  v.minimum_count,
  v.habit_period::public.habit_period,
  v.target_sessions,
  v.freq::public.recurrence_freq,
  v.interval_count::smallint
from (values
  -- id                                    area             slug                          title                          kind         sort  unit          start  target  tgt  min  period   sessions freq       interval
  -- Health & Wellbeing -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ('20000000-0000-4000-8000-000000000101', 'health',        'move-your-body',             'Move your body',              'habit',      10,  null,         null,  null,     3,   1, 'week',      null, null,          null),
  ('20000000-0000-4000-8000-000000000102', 'health',        'reach-a-weight',             'Reach a weight',              'measured',   20,  'kg',         null,  null,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000103', 'health',        'sleep-earlier',              'Sleep earlier',               'habit',      30,  null,         null,  null,     5,   2, 'week',      null, null,          null),
  ('20000000-0000-4000-8000-000000000104', 'health',        'drink-more-water',           'Drink more water',            'habit',      40,  null,         null,  null,     7,   3, 'week',      null, null,          null),
  ('20000000-0000-4000-8000-000000000105', 'health',        'quit-or-cut-back',           'Quit or cut back',            'measured',   50,  'a day',      null,     0,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000106', 'health',        'take-medication',            'Take medication or vitamins', 'habit',      60,  null,         null,  null,     7,   5, 'week',      null, null,          null),
  -- Learning & Skills --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ('20000000-0000-4000-8000-000000000201', 'learning',      'learn-a-language',           'Learn a language',            'scheduled',  10,  null,         null,  null,  null, null, null,       null, 'weekly',         1),
  ('20000000-0000-4000-8000-000000000202', 'learning',      'finish-a-course',            'Finish a course',             'scheduled',  20,  null,         null,  null,  null, null, null,         12, null,          null),
  ('20000000-0000-4000-8000-000000000203', 'learning',      'read-regularly',             'Read regularly',              'habit',      30,  null,         null,  null,     4,   1, 'week',      null, null,          null),
  ('20000000-0000-4000-8000-000000000204', 'learning',      'pass-a-certification',       'Pass a certification',        'measured',   40,  'modules',       0,  null,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000205', 'learning',      'practise-an-instrument',     'Practise an instrument',      'habit',      50,  null,         null,  null,     3,   1, 'week',      null, null,          null),
  ('20000000-0000-4000-8000-000000000206', 'learning',      'write-or-journal',           'Write or journal',            'habit',      60,  null,         null,  null,     3,   1, 'week',      null, null,          null),
  -- Money & Finances ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ('20000000-0000-4000-8000-000000000301', 'money',         'build-an-emergency-fund',    'Build an emergency fund',     'measured',   10,  null,            0,  null,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000302', 'money',         'pay-off-a-debt',             'Pay off a debt',              'measured',   20,  null,         null,     0,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000303', 'money',         'save-for-something',         'Save for something specific', 'measured',   30,  null,            0,  null,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000304', 'money',         'stick-to-a-spending-limit',  'Stick to a spending limit',   'habit',      40,  null,         null,  null,     4,   2, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000305', 'money',         'review-your-budget',         'Review your budget',          'scheduled',  50,  null,         null,  null,  null, null, null,       null, 'monthly',        1),
  ('20000000-0000-4000-8000-000000000306', 'money',         'invest-regularly',           'Invest regularly',            'habit',      60,  null,         null,  null,     1,   1, 'month',     null, null,          null),
  -- Relationships ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ('20000000-0000-4000-8000-000000000401', 'relationships', 'keep-in-touch-with-family',  'Keep in touch with family',   'habit',      10,  null,         null,  null,     4,   1, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000402', 'relationships', 'see-friends-properly',       'See friends properly',        'habit',      20,  null,         null,  null,     2,   1, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000403', 'relationships', 'time-with-your-partner',     'Regular time with your partner', 'scheduled', 30, null,        null,  null,  null, null, null,       null, 'weekly',         1),
  ('20000000-0000-4000-8000-000000000404', 'relationships', 'check-in-on-someone',        'Check in on someone specific','habit',      40,  null,         null,  null,     4,   1, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000405', 'relationships', 'meet-someone-new',           'Meet someone new',            'habit',      50,  null,         null,  null,     1,   1, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000406', 'relationships', 'write-to-someone-far-away',  'Write to someone far away',   'habit',      60,  null,         null,  null,     1,   1, 'month',     null, null,          null),
  -- Work & Career ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ('20000000-0000-4000-8000-000000000501', 'work',          'ship-a-project',             'Ship a project',              'measured',   10,  'milestones',    0,  null,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000502', 'work',          'prepare-for-a-promotion',    'Prepare for a promotion',     'scheduled',  20,  null,         null,  null,  null, null, null,         10, null,          null),
  ('20000000-0000-4000-8000-000000000503', 'work',          'build-a-portfolio',          'Build a portfolio or CV',     'measured',   30,  'pieces',        0,  null,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000504', 'work',          'network-deliberately',       'Network deliberately',        'habit',      40,  null,         null,  null,     2,   1, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000505', 'work',          'learn-a-work-skill',         'Learn a work skill',          'scheduled',  50,  null,         null,  null,  null, null, null,          8, null,          null),
  ('20000000-0000-4000-8000-000000000506', 'work',          'protect-focus-time',         'Protect focus time',          'habit',      60,  null,         null,  null,     3,   1, 'week',      null, null,          null),
  -- Creativity & Hobbies -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  ('20000000-0000-4000-8000-000000000601', 'creative',      'make-something-by-hand',     'Make something by hand',      'scheduled',  10,  null,         null,  null,  null, null, null,         12, null,          null),
  ('20000000-0000-4000-8000-000000000602', 'creative',      'practise-a-craft',           'Practise a craft',            'habit',      20,  null,         null,  null,     2,   1, 'week',      null, null,          null),
  ('20000000-0000-4000-8000-000000000603', 'creative',      'finish-a-creative-project',  'Finish a creative project',   'measured',   30,  '%',             0,   100,  null, null, null,       null, null,          null),
  ('20000000-0000-4000-8000-000000000604', 'creative',      'take-a-class',               'Take a class',                'scheduled',  40,  null,         null,  null,  null, null, null,         10, null,          null),
  ('20000000-0000-4000-8000-000000000605', 'creative',      'play-more',                  'Play more',                   'habit',      50,  null,         null,  null,     4,   1, 'month',     null, null,          null),
  ('20000000-0000-4000-8000-000000000606', 'creative',      'collect-or-curate',          'Collect or curate something', 'measured',   60,  'items',         0,  null,  null, null, null,       null, null,          null)
) as v (
  id, area_slug, slug, title, kind, sort_order,
  unit, start_value, target_value,
  target_count, minimum_count, habit_period,
  target_sessions, freq, interval_count
)
join public.life_areas la on la.slug = v.area_slug and la.user_id is null
on conflict (id) do nothing;
