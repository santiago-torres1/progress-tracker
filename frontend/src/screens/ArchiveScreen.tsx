/*
 * "My full glasses" — where a goal goes when it is finished.
 *
 * A shelf, not a trophy cabinet. The owner rejected gamification outright, so there is nothing
 * here that scores, ranks or congratulates: the tiles are the same tiles, still holding whatever
 * they held, in the order they were put down. No badges, no totals, no "personal best".
 *
 * It is `GET /api/goals?status=completed,archived` and nothing else.
 */

import { useCallback } from 'react';
import { GoalCanvas } from '../components/GoalCanvas';
import { fetchGoals } from '../lib/api';
import { failureCopy } from '../lib/copy';
import { useAppSession } from '../lib/sessionContext';
import { useApiResource } from '../lib/useApiResource';
import { StatusNote } from './StatusNote';
import type { GoalStatus } from '../types/api';

export interface ArchiveScreenProps {
  onBack: () => void;
}

const SHELVED: readonly GoalStatus[] = ['completed', 'archived'];

const SECTION_LABEL = 'My full glasses';

export function ArchiveScreen({ onBack }: ArchiveScreenProps) {
  const { call } = useAppSession();

  const load = useCallback(
    (signal: AbortSignal) => call((options) => fetchGoals(options, SHELVED), signal),
    [call],
  );
  const shelf = useApiResource(load);

  return (
    <section className="archive" aria-label={SECTION_LABEL}>
      <header className="archive__head">
        <h2 className="archive__title">My full glasses</h2>
        <button className="archive__back" type="button" onClick={onBack}>
          Back to the board
        </button>
      </header>

      {shelf.state.kind === 'loading' && (
        <StatusNote state="loading" title="Looking on the shelf…" />
      )}

      {shelf.state.kind !== 'loading' && shelf.state.kind !== 'ok' && (
        <StatusNote
          state="failure"
          title={failureCopy(shelf.state).title}
          body={failureCopy(shelf.state).body}
          onRetry={shelf.reload}
        />
      )}

      {shelf.state.kind === 'ok' && shelf.state.data.goals.length === 0 && (
        <p className="archive__empty">
          Nothing on the shelf yet. When a goal is done you can put it here, and it keeps whatever
          it had in it.
        </p>
      )}

      {shelf.state.kind === 'ok' && shelf.state.data.goals.length > 0 && (
        <>
          <p className="archive__body">
            Goals you have finished or put away. They are not ranked and nothing here is counted.
          </p>
          <GoalCanvas goals={shelf.state.data.goals} />
        </>
      )}
    </section>
  );
}
