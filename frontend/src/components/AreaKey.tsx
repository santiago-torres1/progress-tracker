import type { LifeArea } from '../types/api';
import './AreaKey.css';

/** Only the three fields the key shows; a whole `LifeArea` satisfies it. */
export type AreaKeyItem = Pick<LifeArea, 'id' | 'slug' | 'name'>;

export interface AreaKeyProps {
  areas: readonly AreaKeyItem[];
  /** An accessible name for the list. */
  label?: string;
}

/**
 * Names every colour in use.
 *
 * The dots take their hue from the slug, exactly as the tiles and bars do, so the key can never
 * drift from what it is explaining.
 */
export function AreaKey({ areas, label = 'Life areas' }: AreaKeyProps) {
  return (
    <ul className="area-key" role="list" aria-label={label}>
      {areas.map((area) => (
        <li key={area.id} data-area={area.slug}>
          <i className="area-key__dot" aria-hidden="true" />
          {area.name}
        </li>
      ))}
    </ul>
  );
}
