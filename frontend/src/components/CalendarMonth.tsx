import type { CalendarEntry } from '../types/api';
import { EntryBar, type EntryDisplay } from './EntryBar';
import { formatCalendarDate, formatTime } from './format';
import './CalendarMonth.css';

export interface CalendarMonthDay {
  /** `YYYY-MM-DD`. */
  date: string;
  entries: readonly CalendarEntry[];
  /** A day from the month either side: quiet, and not a target. */
  outside?: boolean;
  /** The caller owns the clock. */
  isToday?: boolean;
}

export interface CalendarMonthProps {
  /** Whole weeks in reading order — usually 35 or 42 cells. */
  days: readonly CalendarMonthDay[];
  /** Seven column headings. The caller owns where the week starts. */
  weekdayLabels: readonly string[];
  /** The day the panel under the grid is spelling out, `YYYY-MM-DD`. */
  selectedDate?: string;
  /** That day's entries, in full. */
  detailEntries?: readonly CalendarEntry[];
  /** Marks a cell shows before it says "+N more". */
  maxMarks?: number;
  /** Per-entry overrides; see EntryDisplay. */
  displayFor?: (entry: CalendarEntry) => EntryDisplay | undefined;
  onSelectDay?: (date: string) => void;
  onSelectEntry?: (entry: CalendarEntry) => void;
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
};

/** One entry as a mark: a bar with its text on a roomy screen, a dash of colour on a narrow one. */
function markFor(entry: CalendarEntry) {
  const timed = entry.timing === 'timed' ? entry : null;
  const kind = timed === null ? 'calendar-month__mark--any' : 'calendar-month__mark--at';
  const title = entry.title ?? entry.goal?.title ?? 'Untitled';
  const areaName = entry.goal?.area?.name;

  return (
    <span
      key={entry.id}
      className={`calendar-month__mark ${kind}`}
      data-area={entry.goal?.area?.slug}
    >
      {timed !== null && <i className="calendar-month__dot" aria-hidden="true" />}
      {timed !== null && (
        <time dateTime={timed.startAt}>{formatTime(timed.startAt, timed.timeZone)}</time>
      )}
      <span className="calendar-month__mark-text">{title}</span>
      {areaName !== undefined && <span className="visually-hidden">{areaName}</span>}
    </span>
  );
}

interface CellProps {
  day: CalendarMonthDay;
  selected: boolean;
  maxMarks: number;
  onSelectDay?: (date: string) => void;
}

function MonthCell({ day, selected, maxMarks, onSelectDay }: CellProps) {
  const shown = day.entries.slice(0, maxMarks);
  const hidden = day.entries.length - shown.length;
  const number = formatCalendarDate(day.date, { day: 'numeric' });

  const classes = ['calendar-month__cell'];
  if (day.outside === true) {
    classes.push('calendar-month__cell--out');
  }
  if (day.isToday === true) {
    classes.push('calendar-month__cell--today');
  }
  if (selected) {
    classes.push('calendar-month__cell--selected');
  }

  function handleClick() {
    onSelectDay?.(day.date);
  }

  const content = (
    <>
      <span className="visually-hidden">{formatCalendarDate(day.date, LONG_DATE)}</span>
      <span className="calendar-month__n" aria-hidden="true">
        {number}
      </span>
      {selected && <span className="visually-hidden">selected</span>}
      {shown.map((entry) => markFor(entry))}
      {hidden > 0 && (
        <span className="calendar-month__mark calendar-month__mark--more">{`+${hidden} more`}</span>
      )}
    </>
  );

  const className = classes.join(' ');

  // A day outside the month is shown for shape only, and a grid with no handler is a picture.
  if (day.outside === true || onSelectDay === undefined) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      className={className}
      type="button"
      aria-current={day.isToday === true ? 'date' : undefined}
      onClick={handleClick}
    >
      {content}
    </button>
  );
}

/** Month view: the same grammar as the other two, shrunk to fit a cell. */
export function CalendarMonth({
  days,
  weekdayLabels,
  selectedDate,
  detailEntries = [],
  maxMarks = 2,
  displayFor,
  onSelectDay,
  onSelectEntry,
}: CalendarMonthProps) {
  const emptyDetail = detailEntries.length === 0;

  return (
    <section className="calendar-month" aria-label="Month">
      <div className="calendar-month__grid">
        {/* Keyed by column, not by label: narrow English weekdays are "M T W T F S S", and two
            pairs of those would collide. */}
        {weekdayLabels.map((label, column) => (
          <div key={column} className="calendar-month__dow">
            {label}
          </div>
        ))}
        {days.map((day) => (
          <MonthCell
            key={day.date}
            day={day}
            selected={day.date === selectedDate}
            maxMarks={maxMarks}
            onSelectDay={onSelectDay}
          />
        ))}
      </div>

      {selectedDate !== undefined && (
        <div className="calendar-month__detail">
          <h3>{formatCalendarDate(selectedDate, LONG_DATE)}</h3>
          <div className="calendar-month__detail-list">
            {detailEntries.map((entry) => {
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
            {emptyDetail && <p className="calendar-month__empty">Nothing planned</p>}
          </div>
        </div>
      )}
    </section>
  );
}
