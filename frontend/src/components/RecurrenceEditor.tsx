/*
 * Target days and times for a goal.
 *
 * Two rules from the contract, both enforced here before a request goes out:
 *
 * 1. A weekly rule needs `byWeekday`. "Weekly" with no days is not a schedule, it is an intention,
 *    and the database refuses it — so the form refuses it first, with a sentence rather than a 400.
 * 2. `startTime` and `endTime` are a pair. One without the other is meaningless, so the form
 *    treats them as one field with two halves and sends both or neither.
 *
 * What a saved rule DID is said in plain words: "26 upcoming sessions were replaced" rather than
 * `{removed: 26, created: 26}`. Nothing that already happened is ever touched, and the copy says
 * so, because "replaced" would otherwise sound like history being rewritten.
 */

import { useId, useState, type SyntheticEvent } from 'react';
import type { RecurrenceFreq, RecurrenceInput } from '../types/api';

export interface RecurrenceEditorProps {
  /** The rule this goal already has, if one was found among its occurrences. */
  existingId: string | null;
  /** Today in the profile's zone: the default start date for a new rule. */
  todayIso: string;
  busy: boolean;
  onSave: (input: RecurrenceInput) => void;
  onRemove: () => void;
}

/** ISO weekdays, 1 = Monday, in the order a week is read. */
const WEEKDAYS: readonly { iso: number; label: string; short: string }[] = [
  { iso: 1, label: 'Monday', short: 'Mon' },
  { iso: 2, label: 'Tuesday', short: 'Tue' },
  { iso: 3, label: 'Wednesday', short: 'Wed' },
  { iso: 4, label: 'Thursday', short: 'Thu' },
  { iso: 5, label: 'Friday', short: 'Fri' },
  { iso: 6, label: 'Saturday', short: 'Sat' },
  { iso: 7, label: 'Sunday', short: 'Sun' },
];

const FREQ_COPY: Readonly<Record<RecurrenceFreq, string>> = {
  daily: 'Every day',
  weekly: 'On certain days each week',
  monthly: 'Once a month',
};

export function RecurrenceEditor({
  existingId,
  todayIso,
  busy,
  onSave,
  onRemove,
}: RecurrenceEditorProps) {
  const ids = useId();
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [byWeekday, setByWeekday] = useState<readonly number[]>([]);
  const [startDate, setStartDate] = useState(todayIso);
  const [untilDate, setUntilDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function toggleDay(iso: number): void {
    setByWeekday((current) =>
      current.includes(iso) ? current.filter((day) => day !== iso) : [...current, iso].sort(),
    );
  }

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();

    if (freq === 'weekly' && byWeekday.length === 0) {
      setProblem('Which days of the week? A weekly rule needs at least one.');
      return;
    }
    if (startDate === '') {
      setProblem('When does this start?');
      return;
    }
    // The pair rule, said as a sentence rather than sent and refused.
    if ((startTime === '') !== (endTime === '')) {
      setProblem(
        'A time needs both ends — when it starts and when it finishes. Or leave both blank.',
      );
      return;
    }

    setProblem(null);
    onSave({
      freq,
      interval: 1,
      byWeekday: freq === 'weekly' ? [...byWeekday] : null,
      startDate,
      untilDate: untilDate === '' ? null : untilDate,
      startTime: startTime === '' ? null : startTime,
      endTime: endTime === '' ? null : endTime,
      isActive: true,
    });
  }

  return (
    <form className="recurrence" onSubmit={handleSubmit} aria-label="Target days and times">
      <fieldset className="recurrence__group">
        <legend className="recurrence__legend">How often?</legend>
        {(Object.keys(FREQ_COPY) as RecurrenceFreq[]).map((option) => (
          <label className="recurrence__choice" key={option}>
            <input
              type="radio"
              name={`${ids}-freq`}
              value={option}
              checked={freq === option}
              onChange={() => {
                setFreq(option);
              }}
            />
            <span>{FREQ_COPY[option]}</span>
          </label>
        ))}
      </fieldset>

      {freq === 'weekly' && (
        <fieldset className="recurrence__group">
          <legend className="recurrence__legend">Which days?</legend>
          {WEEKDAYS.map((day) => (
            <label className="recurrence__day" key={day.iso}>
              <input
                type="checkbox"
                name="byWeekday"
                value={day.iso}
                checked={byWeekday.includes(day.iso)}
                onChange={() => {
                  toggleDay(day.iso);
                }}
              />
              <span aria-hidden="true">{day.short}</span>
              <span className="recurrence__day-name">{day.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="recurrence__row">
        <label className="recurrence__label" htmlFor={`${ids}-start`}>
          Starting
        </label>
        <input
          className="recurrence__input"
          id={`${ids}-start`}
          name="startDate"
          type="date"
          value={startDate}
          onChange={(event) => {
            setStartDate(event.target.value);
          }}
        />
      </div>

      <div className="recurrence__row">
        <label className="recurrence__label" htmlFor={`${ids}-until`}>
          Until (optional)
        </label>
        <input
          className="recurrence__input"
          id={`${ids}-until`}
          name="untilDate"
          type="date"
          value={untilDate}
          onChange={(event) => {
            setUntilDate(event.target.value);
          }}
        />
      </div>

      <fieldset className="recurrence__group">
        <legend className="recurrence__legend">At a time? (optional, both or neither)</legend>

        <div className="recurrence__row">
          <label className="recurrence__label" htmlFor={`${ids}-from`}>
            From
          </label>
          <input
            className="recurrence__input"
            id={`${ids}-from`}
            name="startTime"
            type="time"
            value={startTime}
            onChange={(event) => {
              setStartTime(event.target.value);
            }}
          />
        </div>

        <div className="recurrence__row">
          <label className="recurrence__label" htmlFor={`${ids}-to`}>
            To
          </label>
          <input
            className="recurrence__input"
            id={`${ids}-to`}
            name="endTime"
            type="time"
            value={endTime}
            onChange={(event) => {
              setEndTime(event.target.value);
            }}
          />
        </div>
      </fieldset>

      {problem !== null && (
        <p className="recurrence__problem" role="status">
          {problem}
        </p>
      )}

      <div className="recurrence__actions">
        <button className="recurrence__submit" type="submit" disabled={busy}>
          {existingId === null ? 'Set these days' : 'Replace the rule'}
        </button>
        {existingId !== null && (
          <button className="recurrence__remove" type="button" disabled={busy} onClick={onRemove}>
            Stop repeating
          </button>
        )}
      </div>
    </form>
  );
}
