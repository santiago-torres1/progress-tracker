import type { CalendarEntry } from '../types/api';
import { formatTime } from './format';
import './TodayStrip.css';

export interface TodayStripProps {
  /** What is still to come, in the order it should read. The caller decides what "still" means. */
  entries: readonly CalendarEntry[];
  label?: string;
  /** The quiet half of the label. */
  detail?: string;
  /** An empty evening is a good outcome, not a gap. */
  emptyText?: string;
}

/** A single line under the canvas: what is left of today, and nothing about what was missed. */
export function TodayStrip({
  entries,
  label = 'Still to come',
  detail = '· today',
  emptyText = 'Nothing else planned — the rest of the day is yours.',
}: TodayStripProps) {
  return (
    <div className="today-strip">
      <p className="eyebrow">
        {label}
        <span>{detail}</span>
      </p>

      {entries.length === 0 && <p className="today-strip__empty">{emptyText}</p>}

      {entries.length > 0 && (
        <ul className="today-strip__list" role="list">
          {entries.map((entry) => {
            const timed = entry.timing === 'timed' ? entry : null;
            const title = entry.title ?? entry.goal?.title ?? 'Untitled';
            const areaName = entry.goal?.area?.name;

            return (
              <li key={entry.id} className="today-strip__pill" data-area={entry.goal?.area?.slug}>
                <i className="today-strip__dot" aria-hidden="true" />
                {timed !== null && (
                  <time dateTime={timed.startAt}>{formatTime(timed.startAt, timed.timeZone)}</time>
                )}
                <span className="today-strip__name">{title}</span>
                {areaName !== undefined && <span className="visually-hidden">{areaName}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
