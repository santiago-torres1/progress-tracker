import { isIsoDate } from './dates.js';

/*
 * Validation at the boundary, for bodies that arrived over the wire.
 *
 * The project rule is `no as casts on anything that arrived over the wire`, and express.json()
 * hands a handler `unknown`-shaped data however it is typed. So every field a write route uses
 * is read through one of the functions below, each of which narrows one value and throws
 * InvalidRequestError if it is not what the contract says. Nothing downstream ever sees a value
 * this module has not looked at.
 *
 * THREE STATES, NOT TWO. A PATCH distinguishes "absent" (leave it alone) from `null` (clear it)
 * from a value. `readOptional` returns `undefined` for the first, and `readNullable` keeps all
 * three apart, so a route can build an update payload that touches only the fields it was sent.
 *
 * WHAT THIS IS NOT. It is not where the limits live. Lengths, counts and shapes are enforced by
 * constraints in the database (supabase/migrations/20260917100200) precisely so a forgotten
 * check here cannot bypass them; the bounds repeated below are the generous outer edge, to turn
 * an obvious mistake into a helpful 400 instead of an opaque one. If the two ever disagree, the
 * database wins and the caller gets a 409 rather than a wrong answer.
 */

/** A body, once it is known to be a JSON object. Values are still unknown. */
export type UnknownRecord = Record<string, unknown>;

/**
 * A request this API will not act on. `message` describes the REQUEST — which the caller can
 * fix — and never anything about the database, another account, or an upstream error.
 */
export class InvalidRequestError extends Error {
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'InvalidRequestError';
    this.field = field;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Narrows a parsed JSON body to an object. An array, a string or `null` is not a body. */
export function asBody(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidRequestError('The request body must be a JSON object.');
  }
  return { ...value };
}

/** True when the caller sent the key at all — `null` counts, `undefined` does not. */
export function hasField(body: UnknownRecord, field: string): boolean {
  return field in body && body[field] !== undefined;
}

type Reader<T> = (value: unknown, field: string) => T;

/** The value, or `undefined` when the caller left the field out entirely. */
export function readOptional<T>(
  body: UnknownRecord,
  field: string,
  read: Reader<T>,
): T | undefined {
  if (!hasField(body, field)) return undefined;
  return read(body[field], field);
}

/** Absent stays `undefined`, an explicit `null` stays `null`, anything else is validated. */
export function readNullable<T>(
  body: UnknownRecord,
  field: string,
  read: Reader<T>,
): T | null | undefined {
  if (!hasField(body, field)) return undefined;
  if (body[field] === null) return null;
  return read(body[field], field);
}

/** The value, or a 400 naming the field. */
export function readRequired<T>(body: UnknownRecord, field: string, read: Reader<T>): T {
  if (!hasField(body, field)) {
    throw new InvalidRequestError(`${field} is required.`, field);
  }
  return read(body[field], field);
}

// --- Readers ----------------------------------------------------------------------------------

/** Non-blank text, trimmed, with a generous ceiling that mirrors the column's CHECK. */
export function text(max: number): Reader<string> {
  return (value, field) => {
    if (typeof value !== 'string') {
      throw new InvalidRequestError(`${field} must be a string.`, field);
    }
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new InvalidRequestError(`${field} must not be blank.`, field);
    }
    if (trimmed.length > max) {
      throw new InvalidRequestError(`${field} must be at most ${max} characters.`, field);
    }
    return trimmed;
  };
}

/** Text that is allowed to be empty once trimmed — an emptied note means "no note". */
export function optionalText(max: number): Reader<string | null> {
  return (value, field) => {
    if (typeof value !== 'string') {
      throw new InvalidRequestError(`${field} must be a string.`, field);
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      throw new InvalidRequestError(`${field} must be at most ${max} characters.`, field);
    }
    return trimmed === '' ? null : trimmed;
  };
}

export const boolean: Reader<boolean> = (value, field) => {
  if (typeof value !== 'boolean') {
    throw new InvalidRequestError(`${field} must be true or false.`, field);
  }
  return value;
};

/**
 * A finite JSON number.
 *
 * `numeric(14,4)` in the database, so four decimal places and fourteen digits is the honest
 * ceiling; anything wider would be silently rounded on the way in, which is not something to do
 * to somebody's savings balance.
 */
export const number: Reader<number> = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidRequestError(`${field} must be a number.`, field);
  }
  if (Math.abs(value) >= 1e10) {
    throw new InvalidRequestError(`${field} is out of range.`, field);
  }
  return value;
};

export function integer(min: number, max: number): Reader<number> {
  return (value, field) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new InvalidRequestError(`${field} must be a whole number.`, field);
    }
    if (value < min || value > max) {
      throw new InvalidRequestError(`${field} must be between ${min} and ${max}.`, field);
    }
    return value;
  };
}

/** One of a closed set. The message lists them, because the caller can act on that. */
export function oneOf<T extends string>(allowed: readonly T[]): Reader<T> {
  return (value, field) => {
    const match = allowed.find((candidate): boolean => candidate === value);
    if (match === undefined) {
      throw new InvalidRequestError(`${field} must be one of: ${allowed.join(', ')}.`, field);
    }
    return match;
  };
}

/** A real calendar day, `YYYY-MM-DD`. 2026-02-30 is not one. */
export const date: Reader<string> = (value, field) => {
  if (typeof value !== 'string' || !isIsoDate(value)) {
    throw new InvalidRequestError(`${field} must be a date written as YYYY-MM-DD.`, field);
  }
  return value;
};

/** Local wall clock, `HH:MM` or `HH:MM:SS`. Normalised so the database sees one shape. */
export const time: Reader<string> = (value, field) => {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new InvalidRequestError(`${field} must be a time written as HH:MM.`, field);
  }
  return value.length === 5 ? `${value}:00` : value;
};

export const uuid: Reader<string> = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvalidRequestError(`${field} must be an id.`, field);
  }
  return value;
};

export const hexColor: Reader<string> = (value, field) => {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    throw new InvalidRequestError(`${field} must be a colour written as #RRGGBB.`, field);
  }
  return value;
};

/**
 * An IANA zone name, checked for shape only.
 *
 * Whether the name exists is the database's question — public.validate_time_zone() looks it up
 * in pg_timezone_names, which is the only list that matters, and a second copy here would drift
 * with every tzdata release.
 */
export const timeZone: Reader<string> = (value, field) => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+._-]+){0,2}$/.test(value)
  ) {
    throw new InvalidRequestError(`${field} must be an IANA time zone name.`, field);
  }
  return value;
};

/** ISO weekdays, 1 = Monday. Deduplicated and sorted so two equivalent rules look equivalent. */
export const weekdays: Reader<number[]> = (value, field) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 7) {
    throw new InvalidRequestError(`${field} must list between 1 and 7 weekdays.`, field);
  }
  const days = value.map((day) => integer(1, 7)(day, field));
  return [...new Set(days)].sort((left, right) => left - right);
};

/** A list, with a ceiling: an unbounded batch is an unbounded statement. */
export function arrayOf<T>(read: Reader<T>, max: number): Reader<T[]> {
  return (value, field) => {
    if (!Array.isArray(value)) {
      throw new InvalidRequestError(`${field} must be an array.`, field);
    }
    if (value.length === 0) {
      throw new InvalidRequestError(`${field} must not be empty.`, field);
    }
    if (value.length > max) {
      throw new InvalidRequestError(`${field} may hold at most ${max} items.`, field);
    }
    return value.map((item, index) => read(item, `${field}[${index}]`));
  };
}

/** A nested object, e.g. the kind block on a goal. */
export const object: Reader<UnknownRecord> = (value, field) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidRequestError(`${field} must be an object.`, field);
  }
  return { ...value };
};

/** A path parameter. Rejected here so a non-id never reaches PostgREST as a malformed uuid. */
export function pathId(value: string | undefined, name: string): string {
  if (value === undefined || !UUID_PATTERN.test(value)) {
    throw new InvalidRequestError(`${name} must be an id.`, name);
  }
  return value;
}
