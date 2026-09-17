import type { CalendarEntry } from '../types/api';
import type { StyleWithVars } from '../types/style';
import { EntryBar, type EntryDisplay } from './EntryBar';
import { formatCalendarDate } from './format';
import './CalendarWeek.css';

export interface CalendarWeekDay {
  /** `YYYY-MM-DD`. */
  date: string;
  entries: readonly CalendarEntry[];
  /** The caller owns the clock, so it says which day is today. */
  isToday?: boolean;
}

export interface CalendarWeekProps {
  /** Seven days, in the order the week starts for this user. */
  days: readonly CalendarWeekDay[];
  /** "A good pour this week." — a line no API field can write. */
  headline?: string;
  /** "14–20 September · twenty-one things planned, nine already done." */
  summary?: string;
  /** How many bars a day shows before it offers the rest. */
  maxBars?: number;
  /** Per-entry overrides; see EntryDisplay. */
  displayFor?: (entry: CalendarEntry) => EntryDisplay | undefined;
  onSelectEntry?: (entry: CalendarEntry) => void;
  onShowMore?: (date: string) => void;
}

/** Three things fills the little glass; past that a day is simply full. */
const STRIP_CAP = 3;

const MORE_CLASS = 'calendar-week__more';

interface MoreProps {
  count: number;
  date: string;
  onShowMore?: (date: string) => void;
}

function MoreRow({ count, date, onShowMore }: MoreProps) {
  const label = `${count} more`;

  function handleClick() {
    onShowMore?.(date);
  }

  if (onShowMore === undefined) {
    return <span className={MORE_CLASS}>{label}</span>;
  }

  return (
    <button className={MORE_CLASS} type="button" onClick={handleClick}>
      {label}
    </button>
  );
}

/** One line of copy, seven small glasses, seven roomy rows. No hour grid anywhere. */
export function CalendarWeek({
  days,
  headline,
  summary,
  maxBars = 3,
  displayFor,
  onSelectEntry,
  onShowMore,
}: CalendarWeekProps) {
  return (
    <section className="calendar-week" aria-label="Week">
      <div className="calendar-week__head">
        {headline !== undefined && <p className="calendar-week__headline">{headline}</p>}
        {summary !== undefined && <p className="calendar-week__summary">{summary}</p>}

        <ol className="calendar-week__strip">
          {days.map((day, index) => {
            const planned = day.entries.length;
            const done = day.entries.filter((entry) => entry.status === 'completed').length;
            const plannedLevel = Math.round((Math.min(planned, STRIP_CAP) / STRIP_CAP) * 100);
            const doneLevel = planned === 0 ? 0 : Math.round((plannedLevel * done) / planned);
            const isToday = day.isToday === true;

            const style: StyleWithVars = {
              '--planned': plannedLevel,
              '--done': doneLevel,
              '--i': index,
            };

            const when = formatCalendarDate(day.date, { weekday: 'long', day: 'numeric' });
            const spoken = `${when}${isToday ? ', today' : ''}, ${done} of ${planned} done`;
            const ratio = `${done}/${planned}`;

            return (
              <li key={day.date} style={style} data-today={isToday ? '1' : undefined}>
                <span className="calendar-week__glass" aria-hidden="true">
                  <span className="calendar-week__planned" />
                  <span className="calendar-week__done" />
                </span>
                <span className="calendar-week__day" aria-hidden="true">
                  {formatCalendarDate(day.date, { weekday: 'narrow' })}
                  <b>{formatCalendarDate(day.date, { day: 'numeric' })}</b>
                </span>
                <span className="calendar-week__n" aria-hidden="true">
                  {ratio}
                </span>
                <span className="visually-hidden">{spoken}</span>
              </li>
            );
          })}
        </ol>

        <p className="calendar-week__note">
          One small glass per day — filled is done, outlined is still ahead.
        </p>
      </div>

      <ol className="calendar-week__rows">
        {days.map((day, index) => {
          const shown = day.entries.slice(0, maxBars);
          const hidden = day.entries.length - shown.length;
          const style: StyleWithVars = { '--i': index };

          const classes = ['calendar-week__row'];
          if (day.isToday === true) {
            classes.push('calendar-week__row--today');
          }

          return (
            <li key={day.date} className={classes.join(' ')} style={style}>
              <p className="calendar-week__rail">
                {formatCalendarDate(day.date, { weekday: 'short' })}
                <b>{formatCalendarDate(day.date, { day: 'numeric' })}</b>
                {day.isToday === true && <span className="calendar-week__chip">Today</span>}
              </p>
              <div className="calendar-week__bars">
                {shown.map((entry) => {
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
                {hidden > 0 && <MoreRow count={hidden} date={day.date} onShowMore={onShowMore} />}
                {day.entries.length === 0 && (
                  <p className="calendar-week__empty">Nothing planned</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
