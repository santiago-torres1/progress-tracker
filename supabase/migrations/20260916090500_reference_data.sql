-- =============================================================================
-- progress-tracker :: 20260916090500_reference_data
--
-- Reference data the application needs to function -- NOT demo data. Demo goals
-- live in supabase/seed.sql and are never applied to a real project.
--
-- Two things:
--   1. The single login-less user. Its id is a fixed, documented constant so the
--      backend can resolve "the" user without a lookup:
--        00000000-0000-4000-8000-000000000001
--      The backend should read it from the DEFAULT_USER_ID env var, defaulting
--      to that constant, and can fall back to public.default_user_id().
--      When login arrives this row is claimed by setting auth_user_id.
--   2. The six built-in life areas (user_id IS NULL => shared, is_system = true).
--      This list is FINAL for 0.1.x -- exactly six, no more, no fewer. Exercise
--      belongs to Health & Wellbeing; there is no separate movement area.
--      User-defined areas are a later release, and the mechanism for them is
--      already here: a row with a non-NULL user_id is that user's own.
--
--      The stored hex is the LIGHT-THEME colour and is single-valued on
--      purpose. The frontend derives the dark-theme colour from the slug, so
--      there is no second column here to keep in step and no way for the two
--      themes to disagree in the database.
--
-- Idempotent: fixed ids + ON CONFLICT DO NOTHING, so re-running never clobbers
-- edits made in the dashboard.
-- =============================================================================

insert into public.users (id, display_name, time_zone, week_starts_on, is_default)
values (
  '00000000-0000-4000-8000-000000000001',
  'Me',
  'UTC',            -- change to the owner's IANA zone, e.g. 'Europe/Madrid'
  1,                -- ISO Monday
  true
)
on conflict (id) do nothing;

insert into public.life_areas (id, user_id, slug, name, color, icon, sort_order) values
  ('10000000-0000-4000-8000-000000000001', null, 'health',        'Health & Wellbeing',   '#2e7d57', 'heart',     10),
  ('10000000-0000-4000-8000-000000000002', null, 'learning',      'Learning & Skills',    '#4f52c7', 'book',      20),
  ('10000000-0000-4000-8000-000000000003', null, 'money',         'Money & Finances',     '#8a6410', 'wallet',    30),
  ('10000000-0000-4000-8000-000000000004', null, 'relationships', 'Relationships',        '#a6416b', 'users',     40),
  ('10000000-0000-4000-8000-000000000005', null, 'work',          'Work & Career',        '#14717f', 'briefcase', 50),
  ('10000000-0000-4000-8000-000000000006', null, 'creative',      'Creativity & Hobbies', '#7d4aa8', 'palette',   60)
on conflict (id) do nothing;
