/**
 * The API's public type surface.
 *
 * `./api.js` is the contract the frontend will import once v0.1.1-alpha's UI is built, so it
 * is re-exported first and unqualified. `./database.js` is an implementation detail of this
 * package (and is destined to be replaced by generated types) — it is re-exported only for the
 * enum unions and their runtime value lists, which the mappers and tests share.
 */
export * from './api.js';
export {
  ENTRY_STATUSES,
  GOAL_KINDS,
  GOAL_SIZES,
  GOAL_STATUSES,
  HABIT_PERIODS,
  PROGRESS_BASES,
} from './database.js';
export type {
  CalendarEntryRow,
  GoalDashboardRow,
  LifeAreaRow,
  SessionOverviewRow,
} from './database.js';
