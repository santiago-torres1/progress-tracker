import { getReadClient, runQuery } from './read.js';
import {
  readBoolean,
  readInteger,
  readOptionalString,
  readString,
  type UnknownRow,
} from './row.js';
import { getDefaultUserId } from './user.js';
import type { LifeArea } from '../types/api.js';

/*
 * Reads of public.life_areas — the dashboard's key/legend.
 *
 * Built-in areas (user_id IS NULL) are shared by everyone; a row with an owner belongs to that
 * user. For 0.1.x the six built-ins are the whole list, but the filter matches the life_areas
 * RLS policy exactly, so user-defined areas need no change here when they arrive.
 */

/** `user_id` is absent: `is_system` already says what the client needs to know about ownership. */
export const LIFE_AREA_COLUMNS = [
  'id',
  'slug',
  'name',
  'color',
  'icon',
  'sort_order',
  'is_system',
].join(',');

export function toLifeArea(row: UnknownRow): LifeArea {
  return {
    id: readString(row, 'id'),
    slug: readString(row, 'slug'),
    name: readString(row, 'name'),
    color: readString(row, 'color'),
    icon: readOptionalString(row, 'icon'),
    sortOrder: readInteger(row, 'sort_order'),
    isSystem: readBoolean(row, 'is_system'),
  };
}

/** The areas this user can see, in legend order (`sort_order`, then name as a stable tiebreak). */
export async function fetchLifeAreas(timeoutMs?: number): Promise<LifeArea[]> {
  const userId = getDefaultUserId();
  const client = getReadClient();

  const rows = await runQuery(
    (signal) =>
      client
        .from('life_areas')
        .select(LIFE_AREA_COLUMNS)
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .abortSignal(signal),
    '[api/areas]',
    timeoutMs,
  );

  return rows.map(toLifeArea);
}
