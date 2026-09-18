/*
 * One goal, opened.
 *
 * Its glass, what has happened to it, and the four things a person can do with it: edit it, give
 * it target days, file it away full, or delete it.
 *
 * NO TROPHIES AND NO BADGES. The owner rejected gamification outright, so "My full glasses" is a
 * shelf rather than an achievement wall: archiving says where the goal went, not how well it was
 * done. Nothing on this panel scores anything, and the history below is a list of days, not a
 * streak — a gap in it is just a gap.
 */

import { useState } from 'react';
import { GoalForm } from './GoalForm';
import { GoalTile } from './GoalTile';
import { RecurrenceEditor } from './RecurrenceEditor';
import { formatCalendarDate, formatNumber } from './format';
import { fromGoal, toUpdateRequest, type GoalDraft, type DraftProblem } from '../lib/goalDraft';
import type { StatusCopy } from '../lib/copy';
import type {
  CalendarEntry,
  GoalSummary,
  LifeArea,
  RecurrenceInput,
  UpdateGoalRequest,
} from '../types/api';
import './GoalDetail.css';

export interface GoalDetailProps {
  goal: GoalSummary;
  areas: readonly LifeArea[];
  /** This goal's recent occurrences, newest last. Supplied by the screen, not fetched here. */
  entries: readonly CalendarEntry[];
  todayIso: string;
  busy: boolean;
  notice: StatusCopy | null;
  /** What the last repeat-rule change did, in plain words. */
  recurrenceMessage: string | null;
  /** A rule id discovered from this goal's occurrences, so it can be replaced rather than added. */
  existingRecurrenceId: string | null;
  onEdit: (patch: UpdateGoalRequest) => Promise<boolean>;
  onArchive: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onSaveRecurrence: (input: RecurrenceInput) => void;
  onRemoveRecurrence: () => void;
  onClose: () => void;
}

type Panel = 'overview' | 'edit' | 'repeat';

const ENTRY_STATE: Readonly<Record<CalendarEntry['status'], string>> = {
  completed: 'done',
  planned: 'planned',
  skipped: 'skipped',
  cancelled: 'cancelled',
};

/** The check-ins a measured goal carries with it. There is no route that lists the rest. */
function measuredHistory(goal: GoalSummary): { date: string; value: number }[] {
  if (goal.kind !== 'measured') return [];

  const rows: { date: string; value: number }[] = [];
  const { previousMeasuredOn, previousValue, lastMeasuredOn, currentValue } = goal.measured;
  if (previousMeasuredOn !== null && previousValue !== null) {
    rows.push({ date: previousMeasuredOn, value: previousValue });
  }
  if (lastMeasuredOn !== null) rows.push({ date: lastMeasuredOn, value: currentValue });
  return rows;
}

export function GoalDetail(props: GoalDetailProps) {
  const { goal, areas, entries, todayIso, busy, notice, recurrenceMessage } = props;
  const [panel, setPanel] = useState<Panel>('overview');
  const [draft, setDraft] = useState<GoalDraft>(() => fromGoal(goal));
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const unit =
    goal.kind === 'measured' && goal.measured.unit !== null ? ` ${goal.measured.unit}` : '';
  const checkIns = measuredHistory(goal);

  async function saveEdit(): Promise<void> {
    const result = toUpdateRequest(draft);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    const saved = await props.onEdit(result.body);
    if (saved) setPanel('overview');
  }

  return (
    <section className="goal-detail" aria-label={goal.title}>
      <header className="goal-detail__head">
        <h2 className="goal-detail__title">{goal.title}</h2>
        <button className="goal-detail__close" type="button" onClick={props.onClose}>
          Close
        </button>
      </header>

      {notice !== null && (
        <div className="goal-detail__notice" role="status">
          <p className="goal-detail__notice-title">{notice.title}</p>
          <p className="goal-detail__notice-body">{notice.body}</p>
        </div>
      )}

      <div className="goal-detail__glass">
        <GoalTile goal={goal} />
      </div>

      {goal.description !== null && <p className="goal-detail__body">{goal.description}</p>}

      <nav className="goal-detail__tabs" aria-label="What to do with this goal">
        <button
          className="goal-detail__tab"
          type="button"
          aria-pressed={panel === 'overview'}
          onClick={() => {
            setPanel('overview');
          }}
        >
          History
        </button>
        <button
          className="goal-detail__tab"
          type="button"
          aria-pressed={panel === 'edit'}
          onClick={() => {
            setDraft(fromGoal(goal));
            setPanel('edit');
          }}
        >
          Edit
        </button>
        <button
          className="goal-detail__tab"
          type="button"
          aria-pressed={panel === 'repeat'}
          onClick={() => {
            setPanel('repeat');
          }}
        >
          Target days
        </button>
      </nav>

      {panel === 'overview' && (
        <div className="goal-detail__history">
          {checkIns.length > 0 && (
            <>
              <h3 className="goal-detail__subtitle">Recent check-ins</h3>
              <ul className="goal-detail__list" role="list">
                {checkIns.map((row) => (
                  <li key={row.date} className="goal-detail__row">
                    <span className="goal-detail__when">
                      {formatCalendarDate(row.date, { day: 'numeric', month: 'long' })}
                    </span>
                    <span className="goal-detail__what">
                      {formatNumber(row.value)}
                      {unit}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="goal-detail__subtitle">On the calendar</h3>
          {entries.length === 0 ? (
            <p className="goal-detail__empty">
              Nothing on the calendar for this one yet. Target days would put some there.
            </p>
          ) : (
            <ul className="goal-detail__list" role="list">
              {entries.map((entry) => (
                <li key={entry.id} className="goal-detail__row">
                  <span className="goal-detail__when">
                    {formatCalendarDate(entry.date, { day: 'numeric', month: 'long' })}
                  </span>
                  <span className="goal-detail__what">{ENTRY_STATE[entry.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {panel === 'edit' && (
        <GoalForm
          draft={draft}
          onChange={setDraft}
          areas={areas}
          allowKindChange={false}
          busy={busy}
          submitLabel="Save the changes"
          problem={problem}
          onSubmit={() => {
            void saveEdit();
          }}
          onCancel={() => {
            setPanel('overview');
          }}
        />
      )}

      {panel === 'repeat' && (
        <>
          {recurrenceMessage !== null && (
            <p className="goal-detail__recurrence-note" role="status">
              {recurrenceMessage}
            </p>
          )}
          <RecurrenceEditor
            existingId={props.existingRecurrenceId}
            todayIso={todayIso}
            busy={busy}
            onSave={props.onSaveRecurrence}
            onRemove={props.onRemoveRecurrence}
          />
        </>
      )}

      <footer className="goal-detail__foot">
        {goal.status === 'active' && (
          <button
            className="goal-detail__done"
            type="button"
            disabled={busy}
            onClick={props.onComplete}
          >
            This one is finished
          </button>
        )}

        <button
          className="goal-detail__archive"
          type="button"
          disabled={busy}
          onClick={props.onArchive}
        >
          Put it on the shelf
        </button>

        {confirmingDelete ? (
          <span className="goal-detail__confirm">
            <span className="goal-detail__confirm-text">
              Deleting removes its history too. Shelving keeps everything.
            </span>
            <button
              className="goal-detail__delete"
              type="button"
              disabled={busy}
              onClick={props.onDelete}
            >
              Delete it anyway
            </button>
            <button
              className="goal-detail__keep"
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            className="goal-detail__delete"
            type="button"
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Delete
          </button>
        )}
      </footer>

      <p className="goal-detail__shelf-note">
        “Put it on the shelf” moves this to <b>My full glasses</b>, where finished goals live. It is
        a shelf, not a scoreboard — nothing there is ranked.
      </p>
    </section>
  );
}
