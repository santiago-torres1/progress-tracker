import {
  arrayOf,
  asBody,
  boolean,
  date,
  hasField,
  hexColor,
  integer,
  InvalidRequestError,
  number,
  object,
  oneOf,
  optionalText,
  readNullable,
  readOptional,
  readRequired,
  text,
  time,
  timeZone,
  uuid,
  weekdays,
  type UnknownRecord,
} from './validate.js';
import {
  GOAL_KINDS,
  GOAL_SIZES,
  GOAL_STATUSES,
  HABIT_PERIODS,
  RECURRENCE_FREQS,
} from '../types/database.js';
import type {
  CompleteOccurrenceRequest,
  GoalLayoutInput,
  LogMeasurementRequest,
  RecurrenceInput,
} from '../types/api.js';

/*
 * Every request body this API accepts, turned from `unknown` into the types in types/api.ts.
 *
 * One module rather than a parser hidden in each route, because these ARE the write contract:
 * reading them next to each other is how the frontend's mirror of types/api.ts stays honest, and
 * it keeps the routes to "who is calling, what did they ask for, answer them".
 *
 * The ceilings below (200 characters of title, 2000 of description) are the column CHECKs from
 * 20260917100200 restated. The database is still the enforcer — see lib/validate.ts — these are
 * here so the common mistake comes back as a 400 that names the field.
 *
 * Some parsers return the request type from types/api.ts and some return COLUMNS. The split is
 * deliberate: a body that is handed to an RPC keeps its shape, while a body that becomes an
 * INSERT or UPDATE is translated here, once, so no route holds a half-camelCase object and no
 * column name is spelled in two places.
 */

/** Longest batch PATCH /api/goals/layout will take: the goals-per-account cap. */
export const MAX_LAYOUT_TILES = 100;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const NOTE_MAX = 1000;
const UNIT_MAX = 40;

/** The fields shared by create and update, read from whichever of them is present. */
function readCoreGoalFields(body: UnknownRecord): UnknownRecord {
  const fields: UnknownRecord = {};
  const set = (column: string, value: unknown): void => {
    if (value !== undefined) fields[column] = value;
  };

  set('description', readNullable(body, 'description', optionalText(DESCRIPTION_MAX)));
  set('size', readOptional(body, 'size', oneOf(GOAL_SIZES)));
  set('life_area_id', readNullable(body, 'lifeAreaId', uuid));
  set('color_override', readNullable(body, 'colorOverride', hexColor));
  set('start_date', readNullable(body, 'startDate', date));
  set('target_date', readNullable(body, 'targetDate', date));
  set('sort_order', readOptional(body, 'sortOrder', integer(-100_000, 100_000)));

  return fields;
}

/** At most one kind block may be present: a goal is one kind, and its fields are its own. */
function readKindBlock(body: UnknownRecord): { kind: string; block: UnknownRecord } | undefined {
  const present = (['habit', 'measured', 'scheduled'] as const).filter((kind) =>
    hasField(body, kind),
  );
  if (present.length > 1) {
    throw new InvalidRequestError('Send at most one of habit, measured or scheduled.');
  }
  const kind = present[0];
  if (kind === undefined) return undefined;
  return { kind, block: object(body[kind], kind) };
}

/** The habit columns. `minimumCount` is left to the database, which defaults it to 1. */
function habitColumns(block: UnknownRecord, required: boolean): UnknownRecord {
  const targetCount = required
    ? readRequired(block, 'targetCount', integer(1, 1000))
    : readOptional(block, 'targetCount', integer(1, 1000));
  const period = required
    ? readRequired(block, 'period', oneOf(HABIT_PERIODS))
    : readOptional(block, 'period', oneOf(HABIT_PERIODS));
  const minimumCount = readOptional(block, 'minimumCount', integer(1, 1000));

  const columns: UnknownRecord = {};
  if (targetCount !== undefined) columns.target_count = targetCount;
  if (minimumCount !== undefined) columns.minimum_count = minimumCount;
  if (period !== undefined) columns.habit_period = period;
  return columns;
}

function measuredColumns(block: UnknownRecord, required: boolean): UnknownRecord {
  const startValue = required
    ? readRequired(block, 'startValue', number)
    : readOptional(block, 'startValue', number);
  const targetValue = required
    ? readRequired(block, 'targetValue', number)
    : readOptional(block, 'targetValue', number);
  const unit = readNullable(block, 'unit', optionalText(UNIT_MAX));

  // Direction is derived from the two, so equal bounds have no direction and no denominator.
  // The database says so too (goals_kind_fields); saying it here names the field.
  if (startValue !== undefined && targetValue !== undefined && startValue === targetValue) {
    throw new InvalidRequestError(
      'startValue and targetValue must differ: they are what give the goal its direction.',
      'targetValue',
    );
  }

  const columns: UnknownRecord = {};
  if (startValue !== undefined) columns.start_value = startValue;
  if (targetValue !== undefined) columns.target_value = targetValue;
  if (unit !== undefined) columns.measurement_unit = unit;
  return columns;
}

function scheduledColumns(block: UnknownRecord): UnknownRecord {
  const targetSessions = readNullable(block, 'targetSessions', integer(1, 10_000));
  return targetSessions === undefined ? {} : { target_sessions: targetSessions };
}

/**
 * POST /api/goals.
 *
 * Returns COLUMNS, not the request type: the only thing a caller's body decides is the shape of
 * the row, and `user_id` is added by the route from the session. There is deliberately no path
 * through here that reads an owner, a status or a template from the body.
 */
export function parseCreateGoal(raw: unknown): UnknownRecord {
  const body = asBody(raw);
  const kind = readRequired(body, 'kind', oneOf(GOAL_KINDS));
  const block = readKindBlock(body);

  if (block === undefined) {
    throw new InvalidRequestError(`A ${kind} goal needs its ${kind} block.`, kind);
  }
  if (block.kind !== kind) {
    throw new InvalidRequestError(`A ${kind} goal cannot carry ${block.kind} fields.`, block.kind);
  }

  const columns: UnknownRecord = {
    ...readCoreGoalFields(body),
    title: readRequired(body, 'title', text(TITLE_MAX)),
    kind,
  };

  switch (block.kind) {
    case 'habit':
      return { ...columns, ...habitColumns(block.block, true) };
    case 'measured':
      return { ...columns, ...measuredColumns(block.block, true) };
    default:
      return { ...columns, ...scheduledColumns(block.block) };
  }
}

/**
 * PATCH /api/goals/:goalId.
 *
 * `kind` is not accepted at all: it decides which columns a goal may hold, and changing it would
 * orphan the history hanging off the goal. A kind block is still allowed — that is how a target
 * moves from 3 a week to 4 — and if it is the wrong kind for the stored goal, goals_kind_fields
 * refuses it and the caller gets a 400.
 */
export function parseUpdateGoal(raw: unknown): UnknownRecord {
  const body = asBody(raw);

  if (hasField(body, 'kind')) {
    throw new InvalidRequestError('A goal cannot change kind. Create a new goal instead.', 'kind');
  }

  const columns: UnknownRecord = readCoreGoalFields(body);

  const title = readOptional(body, 'title', text(TITLE_MAX));
  if (title !== undefined) columns.title = title;

  const status = readOptional(body, 'status', oneOf(GOAL_STATUSES));
  if (status !== undefined) columns.status = status;

  const block = readKindBlock(body);
  if (block !== undefined) {
    switch (block.kind) {
      case 'habit':
        Object.assign(columns, habitColumns(block.block, false));
        break;
      case 'measured':
        Object.assign(columns, measuredColumns(block.block, false));
        break;
      default:
        Object.assign(columns, scheduledColumns(block.block));
    }
  }

  if (Object.keys(columns).length === 0) {
    throw new InvalidRequestError('The request changed nothing.');
  }
  return columns;
}

/** PATCH /api/goals/layout. Duplicates are refused here and again in SQL. */
export function parseLayout(raw: unknown): GoalLayoutInput[] {
  const body = asBody(raw);
  const tiles = readRequired(
    body,
    'tiles',
    arrayOf((item, field): GoalLayoutInput => {
      const tile = object(item, field);
      const parsed: GoalLayoutInput = { id: readRequired(tile, 'id', uuid) };
      const sortOrder = readOptional(tile, 'sortOrder', integer(-100_000, 100_000));
      const size = readOptional(tile, 'size', oneOf(GOAL_SIZES));
      if (sortOrder !== undefined) parsed.sortOrder = sortOrder;
      if (size !== undefined) parsed.size = size;
      if (sortOrder === undefined && size === undefined) {
        throw new InvalidRequestError(`${field} must set sortOrder, size, or both.`, field);
      }
      return parsed;
    }, MAX_LAYOUT_TILES),
  );

  const ids = new Set(tiles.map((tile) => tile.id));
  if (ids.size !== tiles.length) {
    throw new InvalidRequestError('tiles may name each goal only once.', 'tiles');
  }
  return tiles;
}

/**
 * POST /api/goals/:goalId/completions.
 *
 * `raw ?? {}` because "I did it" is a POST with nothing to say, and Express 5 leaves req.body
 * undefined when a request carries no JSON body at all. An empty body means today.
 */
export function parseCompleteOccurrence(raw: unknown): CompleteOccurrenceRequest {
  const body = asBody(raw ?? {});
  const parsed: CompleteOccurrenceRequest = {};
  const day = readOptional(body, 'date', date);
  const entryId = readOptional(body, 'entryId', uuid);
  if (day !== undefined) parsed.date = day;
  if (entryId !== undefined) parsed.entryId = entryId;
  return parsed;
}

/** POST /api/goals/:goalId/measurements. */
export function parseLogMeasurement(raw: unknown): LogMeasurementRequest {
  const body = asBody(raw);
  const parsed: LogMeasurementRequest = { value: readRequired(body, 'value', number) };
  const occurredOn = readOptional(body, 'occurredOn', date);
  const note = readNullable(body, 'note', optionalText(NOTE_MAX));
  if (occurredOn !== undefined) parsed.occurredOn = occurredOn;
  if (note !== undefined) parsed.note = note;
  return parsed;
}

/** PATCH /api/goals/:goalId/measurements/:measurementId, as columns. */
export function parseUpdateMeasurement(raw: unknown): UnknownRecord {
  const body = asBody(raw);
  const columns: UnknownRecord = {};

  const value = readOptional(body, 'value', number);
  if (value !== undefined) columns.value = value;
  const occurredOn = readOptional(body, 'occurredOn', date);
  if (occurredOn !== undefined) columns.occurred_on = occurredOn;
  const note = readNullable(body, 'note', optionalText(NOTE_MAX));
  if (note !== undefined) columns.note = note;

  if (Object.keys(columns).length === 0) {
    throw new InvalidRequestError('The request changed nothing.');
  }
  return columns;
}

/**
 * A repeat rule, for create and for replace.
 *
 * The two shape rules the schema enforces are checked here so they come back naming the field:
 * a weekly rule needs its weekdays (without them "weekly" says nothing), and any other frequency
 * must not carry them. Times are paired for the same reason — an occurrence is timed or it is
 * not, never half of each.
 */
export function parseRecurrence(raw: unknown): RecurrenceInput {
  const body = asBody(raw);

  const freq = readRequired(body, 'freq', oneOf(RECURRENCE_FREQS));
  const byWeekday = readNullable(body, 'byWeekday', weekdays);
  if (freq === 'weekly' && (byWeekday === undefined || byWeekday === null)) {
    throw new InvalidRequestError('A weekly rule must say which weekdays.', 'byWeekday');
  }
  if (freq !== 'weekly' && byWeekday !== undefined && byWeekday !== null) {
    throw new InvalidRequestError(`byWeekday only applies to a weekly rule.`, 'byWeekday');
  }

  const startTime = readNullable(body, 'startTime', time);
  const endTime = readNullable(body, 'endTime', time);
  const timed = startTime !== undefined && startTime !== null;
  const ends = endTime !== undefined && endTime !== null;
  if (timed !== ends) {
    throw new InvalidRequestError(
      'startTime and endTime go together: send both, or neither.',
      timed ? 'endTime' : 'startTime',
    );
  }
  if (timed && ends && endTime <= startTime) {
    // Overnight sessions are not expressible yet (recurrences_times_ordered).
    throw new InvalidRequestError('endTime must be later in the day than startTime.', 'endTime');
  }

  const startDate = readRequired(body, 'startDate', date);
  const untilDate = readNullable(body, 'untilDate', date);
  if (untilDate !== undefined && untilDate !== null && untilDate < startDate) {
    throw new InvalidRequestError('untilDate must not be before startDate.', 'untilDate');
  }

  const parsed: RecurrenceInput = { freq, startDate };
  const interval = readOptional(body, 'interval', integer(1, 52));
  const zone = readNullable(body, 'timeZone', timeZone);
  const isActive = readOptional(body, 'isActive', boolean);
  if (interval !== undefined) parsed.interval = interval;
  if (byWeekday !== undefined) parsed.byWeekday = byWeekday;
  if (untilDate !== undefined) parsed.untilDate = untilDate;
  if (startTime !== undefined) parsed.startTime = startTime;
  if (endTime !== undefined) parsed.endTime = endTime;
  if (zone !== undefined) parsed.timeZone = zone;
  if (isActive !== undefined) parsed.isActive = isActive;
  return parsed;
}
