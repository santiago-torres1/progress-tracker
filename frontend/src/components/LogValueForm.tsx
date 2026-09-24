/*
 * The number a measured goal takes instead of a tick.
 *
 * Pre-filled with where the goal stands, because most check-ins are a small move from the last
 * one and retyping a weight from scratch is busywork. The day defaults to today — today in the
 * profile's zone, which the caller resolves and passes in, not the browser's.
 */

import { useId, useState, type SyntheticEvent } from 'react';
import { formatNumber } from './format';
import type { GoalSummary } from '../types/api';
import './LogValueForm.css';

export interface LogValueFormProps {
  goal: Extract<GoalSummary, { kind: 'measured' }>;
  /** Today in the profile's time zone. The day a check-in lands on is not a cosmetic detail. */
  todayIso: string;
  busy: boolean;
  onSubmit: (value: number, occurredOn: string) => void;
  onCancel: () => void;
}

export function LogValueForm({ goal, todayIso, busy, onSubmit, onCancel }: LogValueFormProps) {
  const ids = useId();
  const [value, setValue] = useState(String(goal.measured.currentValue));
  const [occurredOn, setOccurredOn] = useState(todayIso);
  const [problem, setProblem] = useState<string | null>(null);

  const unit = goal.measured.unit === null ? '' : ` ${goal.measured.unit}`;

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();

    const parsed = Number(value.trim());
    if (value.trim() === '' || !Number.isFinite(parsed)) {
      setProblem('A number is all this needs — whatever the scale or the statement says.');
      return;
    }
    setProblem(null);
    onSubmit(parsed, occurredOn);
  }

  return (
    <form
      className="log-value"
      data-area={goal.area?.slug}
      onSubmit={handleSubmit}
      aria-label={`Log a value for ${goal.title}`}
    >
      <p className="log-value__standing">
        Currently {formatNumber(goal.measured.currentValue)}
        {unit}, heading for {formatNumber(goal.measured.targetValue)}
        {unit}.
      </p>

      <div className="log-value__row">
        <label className="log-value__label" htmlFor={`${ids}-value`}>
          Where is it now?
        </label>
        <input
          className="log-value__input"
          id={`${ids}-value`}
          name="value"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </div>

      <div className="log-value__row">
        <label className="log-value__label" htmlFor={`${ids}-date`}>
          On
        </label>
        <input
          className="log-value__input"
          id={`${ids}-date`}
          name="occurredOn"
          type="date"
          value={occurredOn}
          onChange={(event) => {
            setOccurredOn(event.target.value);
          }}
        />
      </div>

      {problem !== null && (
        <p className="log-value__problem" role="status">
          {problem}
        </p>
      )}

      <div className="log-value__actions">
        <button className="log-value__submit" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Log it'}
        </button>
        <button className="log-value__cancel" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
