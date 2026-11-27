/*
 * A board and a week, for the gallery only.
 *
 * Deliberately NOT `src/test/fixtures.ts`: that module imports `vitest`, which has no business in
 * anything a browser loads. The cost is a little duplication; the benefit is that the gallery is
 * an ordinary page with no test framework behind it.
 */

import type { CalendarEntry, GoalArea, GoalSummary, SessionProfile } from '../types/api';

const AREAS: Record<string, GoalArea> = {
  health: { id: 'a-health', slug: 'health', name: 'Health & Wellbeing', icon: null },
  learning: { id: 'a-learning', slug: 'learning', name: 'Learning & Skills', icon: null },
  money: { id: 'a-money', slug: 'money', name: 'Money & Finances', icon: null },
  relationships: {
    id: 'a-relationships',
    slug: 'relationships',
    name: 'Relationships',
    icon: null,
  },
  work: { id: 'a-work', slug: 'work', name: 'Work & Career', icon: null },
  creative: { id: 'a-creative', slug: 'creative', name: 'Creativity & Hobbies', icon: null },
};

function area(slug: keyof typeof AREAS): GoalArea {
  const found = AREAS[slug];
  if (found === undefined) throw new Error(`No such area: ${slug}`);
  return found;
}

const BASE = {
  description: null,
  status: 'active' as const,
  sortOrder: 0,
  color: '#2e7d57',
  startDate: null,
  targetDate: null,
  lastProgressOn: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-09-17T09:00:00.000Z',
};

/** Every size, six areas, and the three kinds — so one screenshot covers the whole tile surface. */
export const GOALS: readonly GoalSummary[] = [
  {
    ...BASE,
    id: 'g-move',
    title: 'Move your body',
    size: 'medium',
    area: area('health'),
    kind: 'habit',
    progress: { basis: 'period_completion', fraction: 1 / 3 },
    habit: {
      period: 'week',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      completedCount: 1,
      targetCount: 3,
      minimumCount: 1,
      minimumFraction: 1,
      minimumMet: true,
    },
  },
  {
    ...BASE,
    id: 'g-read',
    title: 'Read regularly',
    size: 'medium',
    area: area('learning'),
    kind: 'habit',
    progress: { basis: 'period_completion', fraction: 0 },
    habit: {
      period: 'week',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      completedCount: 0,
      targetCount: 4,
      minimumCount: 1,
      minimumFraction: 0,
      minimumMet: false,
    },
  },
  {
    ...BASE,
    id: 'g-save',
    title: 'Put something aside each month',
    size: 'large',
    area: area('money'),
    kind: 'measured',
    progress: { basis: 'measured_value', fraction: 0.62 },
    measured: {
      unit: 'EUR',
      startValue: 0,
      targetValue: 2000,
      currentValue: 1240,
      lastMeasuredOn: '2026-09-15',
      previousValue: 1310,
      previousMeasuredOn: '2026-09-03',
    },
  },
  {
    ...BASE,
    id: 'g-call',
    title: 'Call home',
    size: 'small',
    area: area('relationships'),
    kind: 'habit',
    progress: { basis: 'period_completion', fraction: 1 },
    habit: {
      period: 'week',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      completedCount: 1,
      targetCount: 1,
      minimumCount: 1,
      minimumFraction: 1,
      minimumMet: true,
    },
  },
  {
    ...BASE,
    id: 'g-course',
    title: 'Finish the data course',
    size: 'medium',
    area: area('work'),
    kind: 'scheduled',
    progress: { basis: 'session_target', fraction: 0.9 },
    scheduled: { targetSessions: 10, plannedCount: 10, completedCount: 9, dueCount: 9 },
  },
  {
    ...BASE,
    id: 'g-guitar',
    title: 'Guitar, twenty minutes',
    size: 'small',
    area: area('creative'),
    kind: 'habit',
    progress: { basis: 'period_completion', fraction: 2 / 5 },
    habit: {
      period: 'week',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      completedCount: 2,
      targetCount: 5,
      minimumCount: 2,
      minimumFraction: 1,
      minimumMet: true,
    },
  },
];

/*
 * The glass study's board: the six above plus four more, so that one board carries every fill level
 * the study is asked to show — 0% (Read regularly, Ship a project), 4% (Reach a weight), 34% (Learn
 * a language, and Move your body at a third), 62% (Put something aside), 100% (Call home, Practise
 * a craft) — at every size and in every kind. The four titles are templates from
 * `docs/goal-catalogue.md`, so no word here is new.
 *
 * Interleaved by size rather than grouped, because the Meadow is unsorted and a study that grouped
 * them would be showing a layout nobody will ever see.
 */
const STUDY_EXTRA: readonly GoalSummary[] = [
  {
    ...BASE,
    id: 'g-weight',
    title: 'Reach a weight',
    size: 'small',
    area: area('health'),
    kind: 'measured',
    progress: { basis: 'measured_value', fraction: 0.04 },
    measured: {
      unit: 'kg',
      startValue: 84,
      targetValue: 74,
      currentValue: 83.6,
      lastMeasuredOn: '2026-09-16',
      previousValue: null,
      previousMeasuredOn: null,
    },
  },
  {
    ...BASE,
    id: 'g-language',
    title: 'Learn a language',
    size: 'large',
    area: area('learning'),
    kind: 'scheduled',
    progress: { basis: 'session_target', fraction: 0.34 },
    scheduled: { targetSessions: 50, plannedCount: 50, completedCount: 17, dueCount: 20 },
  },
  {
    ...BASE,
    id: 'g-ship',
    title: 'Ship a project',
    size: 'large',
    area: area('work'),
    kind: 'measured',
    progress: { basis: 'measured_value', fraction: 0 },
    measured: {
      unit: 'milestones',
      startValue: 0,
      targetValue: 6,
      currentValue: 0,
      lastMeasuredOn: null,
      previousValue: null,
      previousMeasuredOn: null,
    },
  },
  {
    ...BASE,
    id: 'g-craft',
    title: 'Practise a craft',
    size: 'medium',
    area: area('creative'),
    kind: 'habit',
    progress: { basis: 'period_completion', fraction: 1 },
    habit: {
      period: 'week',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      completedCount: 2,
      targetCount: 2,
      minimumCount: 1,
      minimumFraction: 1,
      minimumMet: true,
    },
  },
];

function byId(goals: readonly GoalSummary[], id: string): GoalSummary {
  const found = goals.find((goal) => goal.id === id);
  if (found === undefined) throw new Error(`gallery fixtures have no ${id}`);
  return found;
}

const STUDY_ORDER = [
  'g-save',
  'g-move',
  'g-call',
  'g-read',
  'g-language',
  'g-guitar',
  'g-course',
  'g-weight',
  'g-ship',
  'g-craft',
];

export const STUDY_GOALS: readonly GoalSummary[] = STUDY_ORDER.map((id) =>
  byId([...GOALS, ...STUDY_EXTRA], id),
);

function entry(
  id: string,
  date: string,
  goal: GoalSummary,
  status: 'planned' | 'completed',
): CalendarEntry {
  return {
    id,
    date,
    timeZone: 'Europe/Madrid',
    timing: 'untimed',
    startAt: null,
    endAt: null,
    status,
    completedAt: status === 'completed' ? `${date}T18:20:00.000Z` : null,
    title: goal.title,
    notes: null,
    recurrenceId: null,
    goal: {
      id: goal.id,
      title: goal.title,
      kind: goal.kind,
      color: goal.color,
      area: goal.area,
    },
  };
}

const move = GOALS[0];
const course = GOALS[4];
if (move === undefined || course === undefined) throw new Error('gallery fixtures are wrong');

/** Seven days with today in the middle — the row whose alignment is worth looking at. */
export const WEEK = [
  { date: '2026-09-21', entries: [] },
  { date: '2026-09-22', entries: [] },
  { date: '2026-09-23', entries: [entry('e-1', '2026-09-23', move, 'completed')], isToday: true },
  { date: '2026-09-24', entries: [] },
  { date: '2026-09-25', entries: [entry('e-2', '2026-09-25', course, 'planned')] },
  { date: '2026-09-26', entries: [] },
  { date: '2026-09-27', entries: [] },
];

/**
 * One anonymous session, for the frame's counts and the profile page.
 *
 * The numbers are plain counts, exactly as `GET /api/session` reports them — there is nothing to
 * win on that page and nothing here pretends otherwise.
 */
export const PROFILE: SessionProfile = {
  timeZone: 'Europe/Madrid',
  weekStartsOn: 1,
  isAnonymous: true,
  expiresAt: '2026-12-22T09:30:00.000Z',
  createdAt: '2026-08-14T08:12:00.000Z',
  stats: {
    goalsOnBoard: 6,
    glassesFilled: 7,
    completionsRecorded: 128,
    measurementsRecorded: 19,
    daysSinceStart: 40,
  },
};

/** The clock the gallery renders against, so a screenshot is the same picture every day. */
export const GALLERY_NOW = new Date('2026-09-23T09:30:00.000Z');
