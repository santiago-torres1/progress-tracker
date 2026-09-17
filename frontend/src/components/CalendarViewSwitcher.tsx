import { useRef, type KeyboardEvent } from 'react';
import './CalendarViewSwitcher.css';

export type CalendarView = 'day' | 'week' | 'month';

export interface CalendarViewSwitcherProps {
  /** The view currently on screen. This component is controlled and keeps no state of its own. */
  view: CalendarView;
  onChange: (view: CalendarView) => void;
  /** Accessible name for the group. */
  label?: string;
  /** The id of the panel each tab controls, when the caller gives its panels ids. */
  panelIds?: Readonly<Record<CalendarView, string>>;
}

const VIEWS: readonly CalendarView[] = ['day', 'week', 'month'];

const VIEW_LABEL: Record<CalendarView, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

/** Day, week, month. A tablist with roving focus, so the keyboard behaves as the ear expects. */
export function CalendarViewSwitcher({
  view,
  onChange,
  label = 'Calendar view',
  panelIds,
}: CalendarViewSwitcherProps) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(index: number) {
    const bounded = (index + VIEWS.length) % VIEWS.length;
    const next = VIEWS[bounded];
    if (next === undefined) {
      return;
    }
    onChange(next);
    tabs.current[bounded]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = VIEWS.indexOf(view);
    let next = -1;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = current + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = current - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = VIEWS.length - 1;
    }

    if (next === -1) {
      return;
    }

    event.preventDefault();
    move(next);
  }

  return (
    <div
      className="calendar-view-switcher"
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {VIEWS.map((item, index) => (
        <button
          key={item}
          ref={(node) => {
            tabs.current[index] = node;
          }}
          className="calendar-view-switcher__tab"
          type="button"
          role="tab"
          aria-selected={item === view}
          aria-controls={panelIds?.[item]}
          tabIndex={item === view ? 0 : -1}
          onClick={() => {
            onChange(item);
          }}
        >
          {VIEW_LABEL[item]}
        </button>
      ))}
    </div>
  );
}
