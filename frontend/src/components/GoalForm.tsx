/*
 * One form, used to make a goal and to edit one.
 *
 * Everything a template suggested is an ordinary field here. Nothing is read-only because of where
 * its value came from, and the custom path — "Something else" — is this same form with nothing
 * filled in. That is the whole difference between the two, and it is a difference in the draft
 * rather than in the markup.
 *
 * The numbers are text inputs with `inputMode="decimal"` rather than `type="number"`: a number
 * input silently discards what it cannot parse, which turns "I typed 7O instead of 70" into a
 * blank field and no explanation.
 */

import { useId, useState, type SyntheticEvent } from 'react';
import type { GoalDraft } from '../lib/goalDraft';
import type { GoalKind, GoalSize, HabitPeriod, LifeArea } from '../types/api';
import './GoalForm.css';

export interface GoalFormProps {
  draft: GoalDraft;
  onChange: (draft: GoalDraft) => void;
  areas: readonly LifeArea[];
  /** Create shows the kind chooser; an edit does not, because a goal cannot change kind. */
  allowKindChange: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  /** What the last attempt objected to, if anything. Never phrased as the person's mistake. */
  problem?: { field: string; message: string } | null;
}

const KIND_COPY: Readonly<Record<GoalKind, { label: string; hint: string }>> = {
  habit: { label: 'A habit', hint: 'Something repeated in a period — four runs a week.' },
  measured: { label: 'A number', hint: 'A value moving towards a target — a weight, a balance.' },
  scheduled: { label: 'Sessions', hint: 'Occasions that happen — twelve classes, a weekly call.' },
};

const SIZE_COPY: Readonly<Record<GoalSize, string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

const PERIOD_COPY: Readonly<Record<HabitPeriod, string>> = {
  day: 'a day',
  week: 'a week',
  month: 'a month',
};

export function GoalForm({
  draft,
  onChange,
  areas,
  allowKindChange,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  problem = null,
}: GoalFormProps) {
  const ids = useId();
  const [touched, setTouched] = useState(false);

  function field(name: string): string {
    return `${ids}-${name}`;
  }

  function set(patch: Partial<GoalDraft>): void {
    onChange({ ...draft, ...patch });
  }

  function handleSubmit(event: SyntheticEvent): void {
    event.preventDefault();
    setTouched(true);
    onSubmit();
  }

  const problemId = `${ids}-problem`;
  const describedBy = problem === null ? undefined : problemId;

  return (
    <form className="goal-form" onSubmit={handleSubmit}>
      <div className="goal-form__row">
        <label className="goal-form__label" htmlFor={field('title')}>
          What would you like more of?
        </label>
        <input
          className="goal-form__input"
          id={field('title')}
          name="title"
          type="text"
          value={draft.title}
          autoComplete="off"
          aria-describedby={problem?.field === 'title' ? describedBy : undefined}
          onChange={(event) => {
            set({ title: event.target.value });
          }}
        />
      </div>

      {allowKindChange && (
        <fieldset className="goal-form__group">
          <legend className="goal-form__legend">How does it move?</legend>
          {(Object.keys(KIND_COPY) as GoalKind[]).map((kind) => (
            <label className="goal-form__choice" key={kind}>
              <input
                type="radio"
                name={`${ids}-kind`}
                value={kind}
                checked={draft.kind === kind}
                onChange={() => {
                  set({ kind });
                }}
              />
              <span className="goal-form__choice-label">{KIND_COPY[kind].label}</span>
              <span className="goal-form__choice-hint">{KIND_COPY[kind].hint}</span>
            </label>
          ))}
        </fieldset>
      )}

      {draft.kind === 'habit' && (
        <fieldset className="goal-form__group">
          <legend className="goal-form__legend">How often?</legend>

          <div className="goal-form__row">
            <label className="goal-form__label" htmlFor={field('targetCount')}>
              Aiming for
            </label>
            <input
              className="goal-form__input goal-form__input--number"
              id={field('targetCount')}
              name="targetCount"
              type="text"
              inputMode="numeric"
              value={draft.habit.targetCount}
              aria-describedby={problem?.field === 'targetCount' ? describedBy : undefined}
              onChange={(event) => {
                set({ habit: { ...draft.habit, targetCount: event.target.value } });
              }}
            />
          </div>

          <div className="goal-form__row">
            <label className="goal-form__label" htmlFor={field('period')}>
              times in
            </label>
            <select
              className="goal-form__input"
              id={field('period')}
              name="period"
              value={draft.habit.period}
              onChange={(event) => {
                const period = event.target.value as HabitPeriod;
                set({ habit: { ...draft.habit, period } });
              }}
            >
              {(Object.keys(PERIOD_COPY) as HabitPeriod[]).map((period) => (
                <option key={period} value={period}>
                  {PERIOD_COPY[period]}
                </option>
              ))}
            </select>
          </div>

          <div className="goal-form__row">
            <label className="goal-form__label" htmlFor={field('minimumCount')}>
              And it still counts at
            </label>
            <input
              className="goal-form__input goal-form__input--number"
              id={field('minimumCount')}
              name="minimumCount"
              type="text"
              inputMode="numeric"
              value={draft.habit.minimumCount}
              aria-describedby={problem?.field === 'minimumCount' ? describedBy : undefined}
              onChange={(event) => {
                set({ habit: { ...draft.habit, minimumCount: event.target.value } });
              }}
            />
          </div>

          <p className="goal-form__note">
            The minimum is the floor that keeps this going. While you are above it the app is on
            your side; above the target is simply a full glass.
          </p>
        </fieldset>
      )}

      {draft.kind === 'measured' && (
        <fieldset className="goal-form__group">
          <legend className="goal-form__legend">From where to where?</legend>

          <div className="goal-form__row">
            <label className="goal-form__label" htmlFor={field('startValue')}>
              Starting at
            </label>
            <input
              className="goal-form__input goal-form__input--number"
              id={field('startValue')}
              name="startValue"
              type="text"
              inputMode="decimal"
              value={draft.measured.startValue}
              aria-describedby={problem?.field === 'startValue' ? describedBy : undefined}
              onChange={(event) => {
                set({ measured: { ...draft.measured, startValue: event.target.value } });
              }}
            />
          </div>

          <div className="goal-form__row">
            <label className="goal-form__label" htmlFor={field('targetValue')}>
              Heading for
            </label>
            <input
              className="goal-form__input goal-form__input--number"
              id={field('targetValue')}
              name="targetValue"
              type="text"
              inputMode="decimal"
              value={draft.measured.targetValue}
              aria-describedby={problem?.field === 'targetValue' ? describedBy : undefined}
              onChange={(event) => {
                set({ measured: { ...draft.measured, targetValue: event.target.value } });
              }}
            />
          </div>

          <div className="goal-form__row">
            <label className="goal-form__label" htmlFor={field('unit')}>
              Measured in (optional)
            </label>
            <input
              className="goal-form__input"
              id={field('unit')}
              name="unit"
              type="text"
              value={draft.measured.unit}
              placeholder="kg, EUR, pages"
              onChange={(event) => {
                set({ measured: { ...draft.measured, unit: event.target.value } });
              }}
            />
          </div>
        </fieldset>
      )}

      {draft.kind === 'scheduled' && (
        <div className="goal-form__row">
          <label className="goal-form__label" htmlFor={field('targetSessions')}>
            How many sessions? (leave blank for open-ended)
          </label>
          <input
            className="goal-form__input goal-form__input--number"
            id={field('targetSessions')}
            name="targetSessions"
            type="text"
            inputMode="numeric"
            value={draft.scheduled.targetSessions}
            aria-describedby={problem?.field === 'targetSessions' ? describedBy : undefined}
            onChange={(event) => {
              set({ scheduled: { targetSessions: event.target.value } });
            }}
          />
        </div>
      )}

      <div className="goal-form__row">
        <label className="goal-form__label" htmlFor={field('area')}>
          Part of life
        </label>
        <select
          className="goal-form__input"
          id={field('area')}
          name="lifeAreaId"
          value={draft.lifeAreaId}
          onChange={(event) => {
            set({ lifeAreaId: event.target.value });
          }}
        >
          <option value="">No area</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="goal-form__group">
        <legend className="goal-form__legend">How big on the board?</legend>
        <p className="goal-form__note">
          Size is how much this one matters to you. Nothing else sets it.
        </p>
        {(Object.keys(SIZE_COPY) as GoalSize[]).map((size) => (
          <label className="goal-form__choice" key={size}>
            <input
              type="radio"
              name={`${ids}-size`}
              value={size}
              checked={draft.size === size}
              onChange={() => {
                set({ size });
              }}
            />
            <span className="goal-form__choice-label">{SIZE_COPY[size]}</span>
          </label>
        ))}
      </fieldset>

      <div className="goal-form__row">
        <label className="goal-form__label" htmlFor={field('description')}>
          Anything worth remembering (optional)
        </label>
        <textarea
          className="goal-form__input goal-form__input--text"
          id={field('description')}
          name="description"
          rows={2}
          value={draft.description}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
        />
      </div>

      <div className="goal-form__row">
        <label className="goal-form__label" htmlFor={field('targetDate')}>
          By when (optional)
        </label>
        <input
          className="goal-form__input"
          id={field('targetDate')}
          name="targetDate"
          type="date"
          value={draft.targetDate}
          onChange={(event) => {
            set({ targetDate: event.target.value });
          }}
        />
      </div>

      {problem !== null && touched && (
        <p className="goal-form__problem" id={problemId} role="status">
          {problem.message}
        </p>
      )}

      <div className="goal-form__actions">
        <button className="goal-form__submit" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button className="goal-form__cancel" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
