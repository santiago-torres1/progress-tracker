/*
 * The dashboard: the board of glasses, and everything a person can do to it.
 *
 * It owns the reads, the board state and which panel is open; it owns no presentation and no
 * arithmetic. Every progress figure on screen came out of `goal_dashboard` — either from the
 * initial GET or from the recomputed goal a write returned — and nothing here recalculates one.
 *
 * "Today" is today in the PROFILE'S time zone, not the browser's. The backend resolves a
 * completion against the profile, so a UI working from the browser would disagree with it for
 * anybody whose two zones differ, and would do so worst in the evening, which is when people tick
 * things off.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AreaKey } from '../components/AreaKey';
import { EmptyState } from '../components/EmptyState';
import { GoalAction } from '../components/GoalAction';
import { GoalCanvas } from '../components/GoalCanvas';
import { GoalComposer } from '../components/GoalComposer';
import { GoalDetail } from '../components/GoalDetail';
import { LogValueForm } from '../components/LogValueForm';
import { TodayStrip } from '../components/TodayStrip';
import {
  createGoal,
  createRecurrence,
  deleteRecurrence,
  fetchAreas,
  fetchCalendar,
  fetchGoalTemplates,
  fetchGoals,
  fetchRecurrences,
  replaceRecurrence,
  type ApiResult,
} from '../lib/api';
import { areasInUse } from '../lib/areas';
import {
  dashboardHeadline,
  expiryNote,
  failureCopy,
  occurrenceSummary,
  type StatusCopy,
} from '../lib/copy';
import { addDays, isoDateIn, toIsoDate } from '../lib/dates';
import { stillToCome } from '../lib/entries';
import { useAppSession } from '../lib/sessionContext';
import { useApiResource } from '../lib/useApiResource';
import { useArrange } from '../lib/useArrange';
import { useGoalBoard } from '../lib/useGoalBoard';
import type { RecurrencesResponse } from '../types/api';
import { StatusNote } from './StatusNote';
import type { CalendarEntry, CreateGoalRequest, GoalSummary, RecurrenceInput } from '../types/api';
import './Dashboard.css';

export interface DashboardProps {
  /** The app's clock: an instant. Which day that is depends on the profile's zone. */
  now: Date;
  /** Opens "My full glasses" — the shelf of finished goals. */
  onOpenArchive: () => void;
}

const SECTION_LABEL = 'Your goals';

/** How far either side of today the detail panel's history reaches. One request covers both. */
const HISTORY_DAYS = 30;

type Overlay =
  | { kind: 'none' }
  | { kind: 'compose' }
  | { kind: 'detail'; goalId: string }
  | { kind: 'log'; goalId: string };

const NO_ENTRIES: readonly CalendarEntry[] = [];

export function Dashboard({ now, onOpenArchive }: DashboardProps) {
  const { call, profile } = useAppSession();
  const todayIso = isoDateIn(now, profile.timeZone);

  const board = useGoalBoard(call);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [composerNotice, setComposerNotice] = useState<StatusCopy | null>(null);
  const [recurrenceMessage, setRecurrenceMessage] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const from = toIsoDate(addDays(now, -HISTORY_DAYS));
  const to = toIsoDate(addDays(now, HISTORY_DAYS));

  const loadGoals = useCallback(
    (signal: AbortSignal) => call((o) => fetchGoals(o), signal),
    [call],
  );
  const loadAreas = useCallback(
    (signal: AbortSignal) => call((o) => fetchAreas(o), signal),
    [call],
  );
  const loadWindow = useCallback(
    (signal: AbortSignal) => call((o) => fetchCalendar(from, to, o), signal),
    [call, from, to],
  );
  const loadTemplates = useCallback(
    (signal: AbortSignal) => call((o) => fetchGoalTemplates(o), signal),
    [call],
  );

  const goals = useApiResource(loadGoals);
  const areas = useApiResource(loadAreas);
  const timeline = useApiResource(loadWindow);
  const templates = useApiResource(loadTemplates);

  const goalsState = goals.state;
  const { reset } = board;

  // The read fills the board once; from then on the board is changed by the writes' own responses.
  useEffect(() => {
    if (goalsState.kind === 'ok') reset(goalsState.data.goals);
  }, [goalsState, reset]);

  const entries = timeline.state.kind === 'ok' ? timeline.state.data.entries : NO_ENTRIES;

  const arrange = useArrange({
    goals: board.goals,
    applyLocal: board.applyLocalLayout,
    commit: board.commitLayout,
  });

  const openGoal = board.goals.find(
    (goal) => overlay.kind !== 'none' && 'goalId' in overlay && goal.id === overlay.goalId,
  );

  const goalEntries = useMemo(
    () => (openGoal === undefined ? [] : entries.filter((entry) => entry.goal?.id === openGoal.id)),
    [entries, openGoal],
  );

  const openGoalId = openGoal?.id ?? null;

  // The goal's own rules, rather than whichever occurrence happened to fall inside the window the
  // board fetched: a rule whose occurrences all sit outside it would otherwise look like no rule at
  // all, and the editor would quietly offer to create a second one. Asks for nothing while no goal
  // is open.
  const loadRecurrences = useCallback(
    (signal: AbortSignal): Promise<ApiResult<RecurrencesResponse>> =>
      openGoalId === null
        ? Promise.resolve({ kind: 'ok', data: { recurrences: [] } })
        : call((o) => fetchRecurrences(openGoalId, o), signal),
    [call, openGoalId],
  );
  const recurrences = useApiResource(loadRecurrences);

  // While that read is in flight, the old scan is still the best guess available; once it lands it
  // is authoritative, including when it says there is no rule.
  const scannedRecurrenceId =
    goalEntries.find((entry) => entry.recurrenceId !== null)?.recurrenceId ?? null;
  const existingRecurrenceId =
    recurrences.state.kind === 'ok'
      ? (recurrences.state.data.recurrences[0]?.id ?? null)
      : scannedRecurrenceId;

  // A plain function, not a memoized one: nothing depends on its identity, and wrapping it would
  // only be a promise about stability that the React Compiler would have to verify.
  function close(): void {
    setOverlay({ kind: 'none' });
    setComposerNotice(null);
    setRecurrenceMessage(null);
    board.dismissNotice();
  }

  async function handleCreate(body: CreateGoalRequest): Promise<void> {
    setComposing(true);
    setComposerNotice(null);
    const result = await call((options) => createGoal(body, options));
    setComposing(false);

    if (result.kind !== 'ok') {
      // A cap is a full board, not a failure; `failureCopy` already says it that way.
      setComposerNotice(failureCopy(result));
      return;
    }
    board.add(result.data.goal);
    setOverlay({ kind: 'detail', goalId: result.data.goal.id });
  }

  async function handleRecurrence(goal: GoalSummary, input: RecurrenceInput): Promise<void> {
    const result = await call((options) =>
      existingRecurrenceId === null
        ? createRecurrence(goal.id, input, options)
        : replaceRecurrence(goal.id, existingRecurrenceId, input, options),
    );

    if (result.kind !== 'ok') {
      setRecurrenceMessage(failureCopy(result).title);
      return;
    }
    setRecurrenceMessage(occurrenceSummary(result.data.occurrences));
    timeline.reload();
  }

  async function handleRemoveRecurrence(goal: GoalSummary): Promise<void> {
    if (existingRecurrenceId === null) return;

    const result = await call((options) =>
      deleteRecurrence(goal.id, existingRecurrenceId, options),
    );
    if (result.kind !== 'ok' && result.kind !== 'missing') {
      setRecurrenceMessage(failureCopy(result).title);
      return;
    }
    setRecurrenceMessage('These days will not repeat any more. Everything already done stays.');
    timeline.reload();
  }

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

  if (overlay.kind === 'compose') {
    if (templates.state.kind === 'loading') {
      return (
        <section className="dashboard" aria-label={SECTION_LABEL}>
          <StatusNote state="loading" title="Fetching some starting points…" />
        </section>
      );
    }
    if (templates.state.kind !== 'ok') {
      const copy = failureCopy(templates.state);
      return (
        <section className="dashboard" aria-label={SECTION_LABEL}>
          <StatusNote
            state="failure"
            title={copy.title}
            body={copy.body}
            onRetry={templates.reload}
          />
        </section>
      );
    }
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <GoalComposer
          catalogue={templates.state.data}
          busy={composing}
          notice={composerNotice}
          onCreate={(body) => {
            void handleCreate(body);
          }}
          onCancel={close}
        />
      </section>
    );
  }

  if (overlay.kind === 'detail' && openGoal !== undefined) {
    const goal = openGoal;
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <GoalDetail
          goal={goal}
          areas={areas.state.kind === 'ok' ? areas.state.data.areas : []}
          entries={goalEntries}
          todayIso={todayIso}
          busy={board.pending.has(goal.id)}
          notice={board.notice?.goalId === goal.id ? board.notice.copy : null}
          recurrenceMessage={recurrenceMessage}
          existingRecurrenceId={existingRecurrenceId}
          onEdit={(patch) => board.edit(goal, patch)}
          onComplete={() => {
            void board.setStatus(goal, 'completed').then((done) => {
              if (done) close();
            });
          }}
          onArchive={() => {
            void board.setStatus(goal, 'archived').then((done) => {
              if (done) close();
            });
          }}
          onDelete={() => {
            void board.remove(goal).then((done) => {
              if (done) close();
            });
          }}
          onSaveRecurrence={(input) => {
            void handleRecurrence(goal, input);
          }}
          onRemoveRecurrence={() => {
            void handleRemoveRecurrence(goal);
          }}
          onClose={close}
        />
      </section>
    );
  }

  if (overlay.kind === 'log' && openGoal?.kind === 'measured') {
    const goal = openGoal;
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <LogValueForm
          goal={goal}
          todayIso={todayIso}
          busy={board.pending.has(goal.id)}
          onSubmit={(value, occurredOn) => {
            void board.logValue(goal, value, occurredOn).then(close);
          }}
          onCancel={close}
        />
      </section>
    );
  }

  const expiry = expiryNote(profile.expiresAt);

  // No goals is not an error and not an empty canvas: it is room, and EmptyState says so.
  if (board.goals.length === 0) {
    return (
      <section className="dashboard" aria-label={SECTION_LABEL}>
        <EmptyState
          onAction={() => {
            setOverlay({ kind: 'compose' });
          }}
        />
        {expiry !== null && <p className="dashboard__expiry">{expiry}</p>}
      </section>
    );
  }

  const headline = dashboardHeadline(board.goals);
  const key = areas.state.kind === 'ok' ? areasInUse(areas.state.data.areas, board.goals) : [];
  const todayEntries = stillToCome(entries, todayIso, now);

  return (
    <section className="dashboard" aria-label={SECTION_LABEL}>
      <header className="dashboard__head">
        <h2 className="dashboard__headline">{headline.title}</h2>
        <p className="dashboard__detail">{headline.detail}</p>

        <div className="dashboard__controls">
          <button
            className="dashboard__add"
            type="button"
            onClick={() => {
              setOverlay({ kind: 'compose' });
            }}
          >
            Add a goal
          </button>
          <button className="dashboard__shelf" type="button" onClick={onOpenArchive}>
            My full glasses
          </button>
        </div>
      </header>

      {board.notice !== null && (
        <StatusNote
          state="failure"
          variant="line"
          title={board.notice.copy.title}
          body={board.notice.copy.body}
          onRetry={board.dismissNotice}
        />
      )}

      <GoalCanvas
        goals={board.goals}
        leaving={board.leaving}
        arrange={arrange}
        onSelectGoal={(goal) => {
          setOverlay({ kind: 'detail', goalId: goal.id });
        }}
        actionFor={(goal) => (
          <GoalAction
            goal={goal}
            busy={board.pending.has(goal.id)}
            undoable={board.undoable.has(goal.id)}
            onComplete={(target) => {
              void board.complete(target, todayIso);
            }}
            onUndo={(target) => {
              void board.undo(target);
            }}
            onLogValue={(target) => {
              setOverlay({ kind: 'log', goalId: target.id });
            }}
          />
        )}
      />

      {todayEntries.length > 0 && <TodayStrip entries={todayEntries} />}

      {timeline.state.kind !== 'ok' && timeline.state.kind !== 'loading' && (
        <StatusNote
          state="failure"
          variant="line"
          title="Today’s plan is not loading just now."
          body={failureCopy(timeline.state).body}
          onRetry={timeline.reload}
        />
      )}

      {key.length > 0 && <AreaKey areas={key} />}

      {expiry !== null && <p className="dashboard__expiry">{expiry}</p>}
    </section>
  );
}
