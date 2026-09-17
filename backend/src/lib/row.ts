import { isIsoDate } from './dates.js';

/*
 * Typed readers for rows coming back from PostgREST.
 *
 * Without generated database types, supabase-js types `.select()` results as `any`, so every
 * field has to be narrowed before it is used — ESLint's no-unsafe-* rules insist on it, and
 * they are right to: the shape of a view is a runtime fact, not a compile-time one.
 *
 * These readers narrow and convert in one place. A field that is missing, null where the
 * schema says NOT NULL, or of the wrong type throws RowShapeError, which routes turn into a
 * 503 with an opaque reason code. That is deliberate: if a view stops matching the contract in
 * src/types/database.ts, the API should say "unavailable" rather than quietly serve a shape
 * the frontend's exhaustive switches cannot handle.
 */

/** The API's view of a row before it is read: keys of unknown type. */
export type UnknownRow = Record<string, unknown>;

export class RowShapeError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`Unexpected value for "${field}": ${detail}`);
    this.name = 'RowShapeError';
    this.field = field;
  }
}

/** Narrows a PostgREST payload to an array of rows. */
export function asRows(data: unknown): UnknownRow[] {
  if (!Array.isArray(data)) {
    throw new RowShapeError('<result>', `expected an array, got ${typeof data}`);
  }
  return data.map((row, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new RowShapeError(`<result>[${index}]`, 'expected an object');
    }
    return row as UnknownRow;
  });
}

function present(row: UnknownRow, field: string): unknown {
  if (!(field in row)) throw new RowShapeError(field, 'missing from the row');
  return row[field];
}

function nullable<T>(
  row: UnknownRow,
  field: string,
  read: (row: UnknownRow, field: string) => T,
): T | null {
  return present(row, field) === null ? null : read(row, field);
}

export function readString(row: UnknownRow, field: string): string {
  const value = present(row, field);
  if (typeof value !== 'string') throw new RowShapeError(field, `expected a string`);
  return value;
}

export function readOptionalString(row: UnknownRow, field: string): string | null {
  return nullable(row, field, readString);
}

export function readBoolean(row: UnknownRow, field: string): boolean {
  const value = present(row, field);
  if (typeof value !== 'boolean') throw new RowShapeError(field, 'expected a boolean');
  return value;
}

export function readOptionalBoolean(row: UnknownRow, field: string): boolean | null {
  return nullable(row, field, readBoolean);
}

export function readInteger(row: UnknownRow, field: string): number {
  const value = present(row, field);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RowShapeError(field, 'expected an integer');
  }
  return value;
}

export function readOptionalInteger(row: UnknownRow, field: string): number | null {
  return nullable(row, field, readInteger);
}

/** A PostgreSQL `date`, passed through unchanged as `YYYY-MM-DD`. */
export function readDate(row: UnknownRow, field: string): string {
  const value = readString(row, field);
  if (!isIsoDate(value)) throw new RowShapeError(field, 'expected a YYYY-MM-DD date');
  return value;
}

export function readOptionalDate(row: UnknownRow, field: string): string | null {
  return nullable(row, field, readDate);
}

/**
 * A PostgreSQL `timestamptz`, normalised to `…Z`.
 *
 * PostgREST renders instants with a numeric offset (`2026-09-16T17:00:00+00:00`). That is valid
 * ISO-8601, but normalising here means every instant this API emits has exactly one shape, so
 * clients can compare strings and snapshot tests do not depend on the server's offset rendering.
 */
export function readInstant(row: UnknownRow, field: string): string {
  const value = readString(row, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RowShapeError(field, 'expected an ISO-8601 timestamp');
  }
  return parsed.toISOString();
}

export function readOptionalInstant(row: UnknownRow, field: string): string | null {
  return nullable(row, field, readInstant);
}

const DECIMAL_PATTERN = /^[+-]?(\d+)(\.(\d+))?$/;

/** Strips a sign, leading zeros and trailing fractional zeros so two decimals can be compared. */
function normaliseDecimal(value: string): string | undefined {
  const match = DECIMAL_PATTERN.exec(value);
  if (match === null) return undefined;

  const negative = value.startsWith('-');
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const digits = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative && /[1-9]/.test(digits) ? `-${digits}` : digits;
}

/**
 * A PostgreSQL `numeric`, converted to a JavaScript number — deliberately, and checked.
 *
 * Depending on the PostgREST version and how the column is produced, a `numeric` reaches us as
 * either a JSON number or a JSON string (`"84.0000"`), so both are accepted. Neither can be
 * trusted blindly:
 *
 * - Every `numeric` this API reads is either `numeric(14,4)` (goals' values) or a `round(…, 4)`
 *   fraction in [0,1]. Both hold at most 14 significant decimal digits, and an IEEE-754 double
 *   round-trips any decimal of 15 significant digits or fewer, so the conversion is exact for
 *   the schema as it stands.
 * - It would stop being exact the moment someone widens a column. So the conversion is verified
 *   rather than assumed: the parsed number is formatted back and compared with the input. A
 *   mismatch throws instead of silently shaving digits off somebody's savings balance.
 */
export function readNumeric(row: UnknownRow, field: string): number {
  const value = present(row, field);

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RowShapeError(field, 'expected a finite number');
    return value;
  }
  if (typeof value !== 'string') {
    throw new RowShapeError(field, 'expected a number or a numeric string');
  }

  const expected = normaliseDecimal(value.trim());
  if (expected === undefined) throw new RowShapeError(field, 'expected a decimal string');

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RowShapeError(field, 'expected a finite number');
  if (normaliseDecimal(parsed.toString()) !== expected) {
    throw new RowShapeError(field, 'loses precision when converted to a JavaScript number');
  }
  return parsed;
}

export function readOptionalNumeric(row: UnknownRow, field: string): number | null {
  return nullable(row, field, readNumeric);
}

/** Reads a column whose value must be one of a closed set (a PostgreSQL enum, or a view's CASE). */
export function readEnum<T extends string>(
  row: UnknownRow,
  field: string,
  allowed: readonly T[],
): T {
  const value = readString(row, field);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new RowShapeError(field, `expected one of ${allowed.join(', ')}`);
  }
  return match;
}

export function readOptionalEnum<T extends string>(
  row: UnknownRow,
  field: string,
  allowed: readonly T[],
): T | null {
  return present(row, field) === null ? null : readEnum(row, field, allowed);
}
