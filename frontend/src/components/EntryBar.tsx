import type { CalendarEntry, EntryStatus } from '../types/api';
import { formatTime, formatTimeRange } from './format';
import { CheckIcon } from './icons';
import './EntryBar.css';

/**
 * How a bar reads. 'missed' is as far as it ever goes: faded, dashed, and nothing else is said
 * about it. There is no "behind" and no red anywhere in this app.
 */
export type EntryBarTone = 'planned' | 'done' | 'missed';

/**
 * How one bar should read when its status is not the whole story.
 *
 * The calendar views take a `displayFor` callback returning this, because both cases need
 * something no entry carries: "planned, didn't happen" needs today's date, and "logged, not
 * planned" is a judgement about how the entry came to exist.
 */
export interface EntryDisplay {
  tone?: EntryBarTone;
  unplanned?: boolean;
}

export interface EntryBarProps {
  entry: CalendarEntry;
  /**
   * Overrides the tone taken from `entry.status`. The caller owns "planned, didn't happen",
   * because deciding that a day is over needs today's date and this component has no clock.
   */
  tone?: EntryBarTone;
  /** Completed but never planned: a dashed rail and a quiet tag. It still counts. */
  unplanned?: boolean;
  /** `range` reads 09:30–10:10, `start` reads 09:30. An untimed entry shows no time at all. */
  timeDisplay?: 'range' | 'start';
  /** Omit for a plain, non-interactive bar. */
  onSelect?: (entry: CalendarEntry) => void;
}

const TONE_BY_STATUS: Record<EntryStatus, EntryBarTone> = {
  planned: 'planned',
  completed: 'done',
  skipped: 'missed',
  cancelled: 'missed',
};

/**
 * One calendar entry, with its text inside it.
 *
 * Untimed bars span the full width and carry a colour rail on the leading edge, because they
 * belong to the whole day. Timed bars are inset and carry their hour. Every bar names its life
 * area, so the colour is never the only thing that says which part of a life this is.
 */
export function EntryBar({
  entry,
  tone,
  unplanned = false,
  timeDisplay = 'start',
  onSelect,
}: EntryBarProps) {
  const timed = entry.timing === 'timed' ? entry : null;
  const shown = tone ?? TONE_BY_STATUS[entry.status];
  const title = entry.title ?? entry.goal?.title ?? 'Untitled';
  const areaName = entry.goal?.area?.name;

  const classes = ['entry-bar', timed === null ? 'entry-bar--any' : 'entry-bar--at'];
  if (shown === 'done') {
    classes.push('entry-bar--done');
  }
  if (shown === 'missed') {
    classes.push('entry-bar--missed');
  }
  if (unplanned) {
    classes.push('entry-bar--unplanned');
  }

  let timeLabel: string | null = null;
  if (timed !== null) {
    timeLabel =
      timeDisplay === 'range'
        ? formatTimeRange(timed.startAt, timed.endAt, timed.timeZone)
        : formatTime(timed.startAt, timed.timeZone);
  }

  // Said once, for a screen reader, in the order the eye reads the bar.
  const spoken: string[] = [];
  if (shown === 'done') {
    spoken.push('done');
  }
  if (shown === 'missed') {
    spoken.push('did not happen');
  }
  if (timed === null) {
    spoken.push('anytime');
  }

  function handleClick() {
    onSelect?.(entry);
  }

  const content = (
    <>
      {shown === 'done' && <CheckIcon className="entry-bar__tick" />}
      {timed !== null && timeLabel !== null && (
        <time className="entry-bar__time" dateTime={timed.startAt}>
          {timeLabel}
        </time>
      )}
      <span className="entry-bar__name">{title}</span>
      {unplanned && <span className="entry-bar__tag">logged, not planned</span>}
      {areaName !== undefined && <span className="entry-bar__area">{areaName}</span>}
      {spoken.length > 0 && <span className="visually-hidden">{`, ${spoken.join(', ')}`}</span>}
    </>
  );

  const className = classes.join(' ');
  const areaSlug = entry.goal?.area?.slug;

  if (onSelect === undefined) {
    return (
      <div className={className} data-area={areaSlug}>
        {content}
      </div>
    );
  }

  return (
    <button className={className} type="button" data-area={areaSlug} onClick={handleClick}>
      {content}
    </button>
  );
}
