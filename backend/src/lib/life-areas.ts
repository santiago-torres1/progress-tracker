import { runQuery } from './read.js';
import {
  readBoolean,
  readInteger,
  readOptionalString,
  readString,
  type UnknownRow,
} from './row.js';
import type { SupabaseUserClient } from './supabase.js';
import type { LifeArea } from '../types/api.js';

/*
 * Reads of public.life_areas — the dashboard's key/legend.
 *
 * Built-in areas (user_id IS NULL) are shared by everyone; a row with an owner belongs to that
 * user. There is no owner filter here because the life_areas_select policy already IS that
 * filter — `user_id is null or user_id = current_user_id()` — and writing it twice would mean
 * two copies of one rule, with only one of them tested.
 *
 * This route still needs a session. The policy is scoped `to authenticated`, so an anonymous
 * client sees nothing; serving it any other way would mean putting the service-role key back on
 * a request path for six rows. It is also not reference data for long: user-defined areas are a
 * planned release, and this response becomes per-caller the day they land.
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
export async function fetchLifeAreas(
  client: SupabaseUserClient,
  timeoutMs?: number,
): Promise<LifeArea[]> {
  const rows = await runQuery(
    (signal) =>
      client
        .from('life_areas')
        .select(LIFE_AREA_COLUMNS)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .abortSignal(signal),
    '[api/areas]',
    timeoutMs,
  );

  return rows.map(toLifeArea);
}
