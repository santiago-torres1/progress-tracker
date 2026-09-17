/*
 * The dashboard: the board of glasses, what is left of today, and a key to the colours.
 *
 * It owns three reads and no presentation. Everything visible here is a design component; what
 * this file decides is which of them to show, and with what — including the two things the API
 * does not carry: today's date, and a heading in the product's voice.
 */

import { useCallback } from 'react';
import { AreaKey } from '../components/AreaKey';
import { EmptyState } from '../components/EmptyState';
import { GoalCanvas } from '../components/GoalCanvas';
import { TodayStrip } from '../components/TodayStrip';
import { fetchAreas, fetchCalendar, fetchGoals } from '../lib/api';
import { areasInUse } from '../lib/areas';
import { dashboardHeadline, failureCopy } from '../lib/copy';
import { toIsoDate } from '../lib/dates';
import { stillToCome } from '../lib/entries';
import { useApiResource } from '../lib/useApiResource';
import { StatusNote } from './StatusNote';
import './Dashboard.css';

export interface DashboardProps {
  /** The app's clock: a day for "today", an instant for "still to come". */
  now: Date;
}

const SECTION_LABEL = 'Your goals';

export function Dashboard({ now }: DashboardProps) {
  const todayIso = toIsoDate(now);

  const loadGoals = useCallback((signal: AbortSignal) => fetchGoals({ signal }), []);
  const loadAreas = useCallback((signal: AbortSignal) => fetchAreas({ signal }), []);
  const loadToday = useCallback(
    (signal: AbortSignal) => fetchCalendar(todayIso, todayIso, { signal }),
    [todayIso],
  );

  const goals = useApiResource(loadGoals);
  const areas = useApiResource(loadAreas);
  const today = useApiResource(loadToday);

  const goalsState = goals.state;

  if (goalsState.kind === 'loading') {
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <StatusNote state="loading" title="Reading where everything stands…" />
      </section>
    );
  }

  if (goalsState.kind !== 'ok') {
    const copy = failureCopy(goalsState);
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <StatusNote state="failure" title={copy.title} body={copy.body} onRetry={goals.reload} />
      </section>
    );
  }

  const board = goalsState.data.goals;

  // No goals is not an error and not an empty canvas: it is room, and EmptyState says so.
  if (board.length === 0) {
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <EmptyState />
      </section>
    );
  }

  const headline = dashboardHeadline(board);
  const key = areas.state.kind === 'ok' ? areasInUse(areas.state.data.areas, board) : [];
  const todayState = today.state;

  return (
    <section className="dashboard" aria-label={SECTION_LABEL}>
      <header className="dashboard__head">
        <h2 className="dashboard__headline">{headline.title}</h2>
        <p className="dashboard__detail">{headline.detail}</p>
      </header>

      <GoalCanvas goals={board} />

      {todayState.kind === 'ok' && (
        <TodayStrip entries={stillToCome(todayState.data.entries, todayIso, now)} />
      )}

      {/* The strip is the smaller half of this screen; if it cannot load, it says so quietly
          and the glasses stay where they are. */}
      {todayState.kind !== 'ok' && todayState.kind !== 'loading' && (
        <StatusNote
          state="failure"
          variant="line"
          title="Today’s plan is not loading just now."
          body={failureCopy(todayState).body}
          onRetry={today.reload}
        />
      )}

      {key.length > 0 && <AreaKey areas={key} />}
    </section>
  );
}
