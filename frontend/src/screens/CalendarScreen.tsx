/*
 * The calendar: one range at a time, in whichever of the three views is showing.
 *
 * The views draw days they are given and nothing else — no clock, no idea which day is today,
 * no notion of a month having edges. This file supplies all of that, asks the API for exactly
 * the range the current view shows, and hands each day its entries.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CalendarDay } from '../components/CalendarDay';
import { CalendarMonth } from '../components/CalendarMonth';
import { CalendarViewSwitcher, type CalendarView } from '../components/CalendarViewSwitcher';
import { CalendarWeek } from '../components/CalendarWeek';
import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
import { fetchCalendar } from '../lib/api';
import { useAppSession } from '../lib/sessionContext';
import { failureCopy, weekCopy } from '../lib/copy';
import {
  isSameMonth,
  isoDateIn,
  monthGridDates,
  nowLabelFor,
  parseIsoDate,
  periodLabel,
  rangeForView,
  shiftAnchor,
  startOfDay,
  startOfMonth,
  toIsoDate,
  weekDates,
  weekdayLabels,
} from '../lib/dates';
import { displayForToday, groupEntriesByDate } from '../lib/entries';
import { useApiResource } from '../lib/useApiResource';
import { StatusNote } from './StatusNote';
import type { CalendarEntry } from '../types/api';
import './CalendarScreen.css';

export interface CalendarScreenProps {
  /** The app's clock: which day is today, and where the now-line sits on it. */
  now: Date;
}

/**
 * One panel element, reused by all three tabs.
 *
 * Only the selected view is rendered, so giving each tab its own id would point `aria-controls`
 * at elements that are not there.
 */
const PANEL_ID = 'calendar-panel';

const PANEL_IDS: Readonly<Record<CalendarView, string>> = {
  day: PANEL_ID,
  week: PANEL_ID,
  month: PANEL_ID,
};

const NO_ENTRIES: readonly CalendarEntry[] = [];

export function CalendarScreen({ now }: CalendarScreenProps) {
  const { call, profile } = useAppSession();

  // The week is the view that shows a shape without asking anyone to scan a grid.
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => startOfDay(now));
  const [selected, setSelected] = useState<string | null>(null);

  // Both come from the profile now. The week start used to be a hardcoded Monday, which put a
  // weekly habit's period boundary in the wrong place for anyone whose week starts on Sunday.
  const weekStartsOn = profile.weekStartsOn;
  const todayIso = isoDateIn(now, profile.timeZone);
  const { from, to } = rangeForView(view, anchor, weekStartsOn);

  const loadCalendar = useCallback(
    (signal: AbortSignal) => call((options) => fetchCalendar(from, to, options), signal),
    [call, from, to],
  );
  const calendar = useApiResource(loadCalendar);

  const entries = calendar.state.kind === 'ok' ? calendar.state.data.entries : NO_ENTRIES;
  const byDate = useMemo(() => groupEntriesByDate(entries), [entries]);
  const displayFor = useMemo(() => displayForToday(todayIso, entries), [todayIso, entries]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);

  const entriesOn = useCallback(
    (date: string): readonly CalendarEntry[] => byDate.get(date) ?? NO_ENTRIES,
    [byDate],
  );

  const label = periodLabel(view, anchor, weekStartsOn);

  // Month navigation keeps its own selected day only while it is still in the month on screen.
  const monthDefault = isSameMonth(anchor, now) ? todayIso : toIsoDate(startOfMonth(anchor));
  const selectedDate = selected ?? monthDefault;

  function step(direction: -1 | 1) {
    setAnchor((current) => shiftAnchor(view, current, direction));
    setSelected(null);
  }

  function goToToday() {
    setAnchor(startOfDay(now));
    setSelected(null);
  }

  function changeView(next: CalendarView) {
    setView(next);
    setSelected(null);
  }

  /** "3 more" on a week row, and a day cell's own date, both open that day in the day view. */
  function openDay(date: string) {
    const parsed = parseIsoDate(date);
    if (parsed === null) return;
    setAnchor(parsed);
    setView('day');
    setSelected(null);
  }

  function renderPanel(): ReactNode {
    if (calendar.state.kind === 'loading') {
      // Drawing an empty week while the answer is in flight would say "nothing planned",
      // which is a different thing from "not here yet".
      return <StatusNote state="loading" title="Reading your calendar…" />;
    }

    if (calendar.state.kind !== 'ok') {
      const copy = failureCopy(calendar.state);
      return (
        <StatusNote state="failure" title={copy.title} body={copy.body} onRetry={calendar.reload} />
      );
    }

    switch (view) {
      case 'day': {
        const date = toIsoDate(anchor);
        return (
          <CalendarDay
            date={date}
            entries={entriesOn(date)}
            nowLabel={nowLabelFor(now, date)}
            displayFor={displayFor}
          />
        );
      }
      case 'week': {
        const days = weekDates(anchor, weekStartsOn).map((date) => ({
          date,
          entries: entriesOn(date),
          isToday: date === todayIso,
        }));
        const copy = weekCopy(label, calendar.state.data.entries);
        return (
          <CalendarWeek
            days={days}
            headline={copy.headline}
            summary={copy.summary}
            displayFor={displayFor}
            onShowMore={openDay}
          />
        );
      }
      case 'month': {
        const days = monthGridDates(anchor, weekStartsOn).map((day) => ({
          date: day.date,
          outside: day.outside,
          entries: entriesOn(day.date),
          isToday: day.date === todayIso,
        }));
        return (
          <CalendarMonth
            days={days}
            weekdayLabels={labels}
            selectedDate={selectedDate}
            detailEntries={entriesOn(selectedDate)}
            displayFor={displayFor}
            onSelectDay={setSelected}
          />
        );
      }
    }
  }

  return (
    <section className="calendar-screen" aria-label="Calendar">
      <header className="calendar-screen__head">
        <h2 className="calendar-screen__title">Calendar</h2>

        <div className="calendar-screen__controls">
          <CalendarViewSwitcher view={view} onChange={changeView} panelIds={PANEL_IDS} />

          <div className="calendar-screen__nav">
            <button
              className="calendar-screen__step"
              type="button"
              aria-label={`Previous ${view}`}
              onClick={() => {
                step(-1);
              }}
            >
              <ChevronLeftIcon className="calendar-screen__chevron" />
            </button>
            <p className="calendar-screen__period" aria-live="polite">
              {label}
            </p>
            <button
              className="calendar-screen__step"
              type="button"
              aria-label={`Next ${view}`}
              onClick={() => {
                step(1);
              }}
            >
              <ChevronRightIcon className="calendar-screen__chevron" />
            </button>
            <button className="calendar-screen__today" type="button" onClick={goToToday}>
              Today
            </button>
          </div>
        </div>
      </header>

      <div id={PANEL_ID} className="calendar-screen__panel" role="tabpanel" aria-label={view}>
        {renderPanel()}
      </div>
    </section>
  );
}
