/*
 * Making a goal: pick a part of life, pick a starting point, edit it, save.
 *
 * The middle step is the catalogue, and "Something else" sits in it as an ordinary card rather
 * than as an escape hatch tucked underneath. That is not decoration: `POST /api/goals` takes plain
 * fields and knows nothing about templates, so a custom goal really is the same request with an
 * empty draft, and treating it as a special case in the UI would be inventing a distinction the
 * API deliberately does not have.
 *
 * Colour means area, and never on its own — every coloured card also says its area in words.
 */

import { useState } from 'react';
import { GoalForm } from './GoalForm';
import {
  emptyDraft,
  fromTemplate,
  toCreateRequest,
  type GoalDraft,
  type DraftProblem,
} from '../lib/goalDraft';
import type { StatusCopy } from '../lib/copy';
import type {
  CreateGoalRequest,
  GoalTemplate,
  GoalTemplateGroup,
  GoalTemplatesResponse,
} from '../types/api';

export interface GoalComposerProps {
  catalogue: GoalTemplatesResponse;
  busy: boolean;
  /** A refusal from the server, already turned into calm words by `failureCopy`. */
  notice: StatusCopy | null;
  onCreate: (body: CreateGoalRequest) => void;
  onCancel: () => void;
}

type Step =
  | { name: 'area' }
  | { name: 'template'; group: GoalTemplateGroup }
  | { name: 'form'; group: GoalTemplateGroup | null; draft: GoalDraft };

/** "3 times a week, minimum 1" — what a template would fill in, said before it is chosen. */
function suggestionLine(template: GoalTemplate): string {
  switch (template.kind) {
    case 'habit': {
      const period = template.habit.period === 'day' ? 'a day' : `a ${template.habit.period}`;
      return `${template.habit.targetCount} times ${period}, minimum ${template.habit.minimumCount}`;
    }
    case 'measured': {
      const unit = template.measured.unit === null ? '' : ` ${template.measured.unit}`;
      if (template.measured.startValue === null || template.measured.targetValue === null) {
        return `A number you choose${unit}`;
      }
      return `${template.measured.startValue} → ${template.measured.targetValue}${unit}`;
    }
    case 'scheduled':
      return template.scheduled.targetSessions === null
        ? 'As many sessions as it takes'
        : `${template.scheduled.targetSessions} sessions`;
  }
}

export function GoalComposer({ catalogue, busy, notice, onCreate, onCancel }: GoalComposerProps) {
  const [step, setStep] = useState<Step>({ name: 'area' });
  const [problem, setProblem] = useState<DraftProblem | null>(null);

  const areas = catalogue.areas.map((group) => group.area);
  const defaultSize = catalogue.custom.defaultSize;
  const customKind = catalogue.custom.kinds[0] ?? 'habit';

  function openForm(group: GoalTemplateGroup | null, draft: GoalDraft): void {
    setProblem(null);
    setStep({ name: 'form', group, draft });
  }

  function submit(draft: GoalDraft): void {
    const result = toCreateRequest(draft);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    onCreate(result.body);
  }

  if (step.name === 'area') {
    return (
      <div className="composer" aria-label="Add a goal">
        <h2 className="composer__title">Which part of life is this?</h2>
        <p className="composer__body">
          Six to choose from. It only decides the colour and where it sits in the key — you can
          change it later, or leave it off entirely.
        </p>

        <ul className="composer__areas" role="list">
          {catalogue.areas.map((group) => (
            <li key={group.area.id}>
              <button
                className="composer__area"
                type="button"
                data-area={group.area.slug}
                onClick={() => {
                  setStep({ name: 'template', group });
                }}
              >
                <span className="composer__area-name">{group.area.name}</span>
                <span className="composer__area-count">
                  {group.templates.length} starting points
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button className="composer__cancel" type="button" onClick={onCancel}>
          Not now
        </button>
      </div>
    );
  }

  if (step.name === 'template') {
    const { group } = step;
    return (
      <div className="composer" aria-label={`Starting points in ${group.area.name}`}>
        <h2 className="composer__title">{group.area.name}</h2>
        <p className="composer__body">
          Pick something near what you have in mind. Every part of it stays yours to change.
        </p>

        <ul className="composer__templates" role="list">
          {group.templates.map((template) => (
            <li key={template.id}>
              <button
                className="composer__template"
                type="button"
                data-area={group.area.slug}
                onClick={() => {
                  openForm(group, fromTemplate(template, group.area.id, defaultSize));
                }}
              >
                <span className="composer__template-title">{template.title}</span>
                <span className="composer__template-hint">{suggestionLine(template)}</span>
              </button>
            </li>
          ))}

          <li>
            <button
              className="composer__template composer__template--custom"
              type="button"
              onClick={() => {
                openForm(group, emptyDraft(customKind, group.area.id, defaultSize));
              }}
            >
              <span className="composer__template-title">Something else</span>
              <span className="composer__template-hint">A blank form, in {group.area.name}</span>
            </button>
          </li>
        </ul>

        <button
          className="composer__back"
          type="button"
          onClick={() => {
            setStep({ name: 'area' });
          }}
        >
          Back to the areas
        </button>
      </div>
    );
  }

  const { draft, group } = step;
  return (
    <div className="composer" aria-label="Your new goal">
      <h2 className="composer__title">Make it yours</h2>
      <p className="composer__body">
        Everything here is a suggestion. Change any of it — nothing is fixed because of where it
        came from.
      </p>

      {notice !== null && (
        <div className="composer__notice" role="status">
          <p className="composer__notice-title">{notice.title}</p>
          <p className="composer__notice-body">{notice.body}</p>
        </div>
      )}

      <GoalForm
        draft={draft}
        onChange={(next) => {
          setStep({ name: 'form', group, draft: next });
        }}
        areas={areas}
        allowKindChange
        busy={busy}
        submitLabel="Add it to the board"
        problem={problem}
        onSubmit={() => {
          submit(draft);
        }}
        onCancel={() => {
          if (group === null) onCancel();
          else setStep({ name: 'template', group });
        }}
      />
    </div>
  );
}
