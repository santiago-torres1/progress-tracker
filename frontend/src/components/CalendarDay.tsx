import type { ReactNode } from 'react';
import type { CalendarEntry, TimedEntry, UntimedEntry } from '../types/api';
import { EntryBar, type EntryDisplay } from './EntryBar';
import { formatCalendarDate, formatTime, plural } from './format';
import './CalendarDay.css';

export interface CalendarDayProps {
  /** The day on show, `YYYY-MM-DD`. */
  date: string;
  /** Everything on that day. Untimed entries come first; timed ones are put in clock order. */
  entries: readonly CalendarEntry[];
  /** `15:42`, and only when the day on show is today. This component has no clock of its own. */
  nowLabel?: string;
  /** A closing line: "Nothing after seven. The rest of the evening is yours." */
  note?: string;
  /** Per-entry overrides; see EntryDisplay. */
  displayFor?: (entry: CalendarEntry) => EntryDisplay | undefined;
  onSelectEntry?: (entry: CalendarEntry) => void;
}

function nowRow(label: string) {
  return (
    <li key="now" className="calendar-day__now">
      <span className="calendar-day__now-time">{label}</span>
      <span className="calendar-day__now-line">now</span>
    </li>
  );
}

/** The calmest screen in the app: two lists, an hour spine, and no grid of empty hours. */
export function CalendarDay({
  date,
  entries,
  nowLabel,
  note,
  displayFor,
  onSelectEntry,
}: CalendarDayProps) {
  const timed: TimedEntry[] = [];
  const untimed: UntimedEntry[] = [];
  for (const entry of entries) {
    if (entry.timing === 'timed') {
      timed.push(entry);
    } else {
      untimed.push(entry);
    }
  }
  // Display order only. Instants are UTC, so they sort chronologically as plain strings.
  timed.sort((a, b) => a.startAt.localeCompare(b.startAt));

  const weekday = formatCalendarDate(date, { weekday: 'long' });
  const longDate = formatCalendarDate(date, { day: 'numeric', month: 'long', year: 'numeric' });

  const total = entries.length;
  const done = entries.filter((entry) => entry.status === 'completed').length;
  const remaining = total - done;

  const things = plural(total, 'thing', 'things');
  const countLine = total === 0 ? 'Nothing planned' : `${total} ${things}`;

  let countDetail: string;
  if (total === 0) {
    countDetail = 'The day is yours';
  } else if (remaining === 0) {
    countDetail = 'All done';
  } else if (done === 0) {
    countDetail = `${remaining} to come`;
  } else {
    countDetail = `${done} done · ${remaining} to come`;
  }

  // The spine carries hours only where something happens, with "now" slotted in by the label
  // the caller passed. Both are zero-padded 24-hour strings, so they compare directly.
  const rows: ReactNode[] = [];
  let nowPlaced = nowLabel === undefined;
  for (const entry of timed) {
    const startLabel = formatTime(entry.startAt, entry.timeZone);
    if (!nowPlaced && nowLabel !== undefined && startLabel > nowLabel) {
      rows.push(nowRow(nowLabel));
      nowPlaced = true;
    }

    const display = displayFor?.(entry);
    rows.push(
      <li key={entry.id} className="calendar-day__slot" data-area={entry.goal?.area?.slug}>
        <span className="calendar-day__slot-time">{startLabel}</span>
        <EntryBar
          entry={entry}
          timeDisplay="range"
          tone={display?.tone}
          unplanned={display?.unplanned}
          onSelect={onSelectEntry}
        />
      </li>,
    );
  }
  if (!nowPlaced && nowLabel !== undefined) {
    rows.push(nowRow(nowLabel));
  }

  return (
    <section className="calendar-day" aria-label={`${weekday} ${longDate}`}>
      <header className="calendar-day__head">
        <div>
          <p className="calendar-day__dow">{weekday}</p>
          <p className="calendar-day__date">{longDate}</p>
        </div>
        <p className="calendar-day__count">
          {countLine}
          <span>{countDetail}</span>
        </p>
      </header>

      {untimed.length > 0 && (
        <section className="calendar-day__section">
          <h3 className="eyebrow">
            Yours to place
            <span>· anytime</span>
          </h3>
          <div className="calendar-day__anytime">
            {untimed.map((entry) => {
              const display = displayFor?.(entry);
              return (
                <EntryBar
                  key={entry.id}
                  entry={entry}
                  tone={display?.tone}
                  unplanned={display?.unplanned}
                  onSelect={onSelectEntry}
                />
              );
            })}
          </div>
        </section>
      )}

      {timed.length > 0 && (
        <section className="calendar-day__section">
          <h3 className="eyebrow">In clock order</h3>
          <ol className="calendar-day__timed">{rows}</ol>
        </section>
      )}

      {note !== undefined && <p className="calendar-day__foot">{note}</p>}
    </section>
  );
}
