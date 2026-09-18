/*
 * The form behind a goal, as data.
 *
 * A TEMPLATE IS A SOURCE OF DEFAULTS AND NOTHING ELSE. `fromTemplate` copies its suggestions into
 * a draft and then forgets where they came from: every field is an ordinary editable string
 * afterwards, nothing is locked because a template proposed it, and `toCreateRequest` sends plain
 * fields with no template named anywhere. "Something else" is `emptyDraft` — the same form with
 * nothing filled in — which is why the custom path needs no special case downstream.
 *
 * Every field is a string, including the numbers. That is deliberate: a blank number field has to
 * stay blank. "Reach a weight" genuinely does not know which weight, and a draft that turned that
 * into `0` would invent a target the person never chose and then quietly save it.
 */

import type {
  CreateGoalRequest,
  GoalKind,
  GoalSize,
  GoalSummary,
  GoalTemplate,
  HabitPeriod,
  UpdateGoalRequest,
} from '../types/api';

export interface GoalDraft {
  title: string;
  description: string;
  kind: GoalKind;
  size: GoalSize;
  /** Empty string means no area, which the tile renders as "No area". */
  lifeAreaId: string;
  startDate: string;
  targetDate: string;
  habit: { targetCount: string; minimumCount: string; period: HabitPeriod };
  measured: { unit: string; startValue: string; targetValue: string };
  scheduled: { targetSessions: string };
}

/** What a draft is before anybody touches it: blank, and encouraging by default. */
export function emptyDraft(kind: GoalKind, lifeAreaId: string, size: GoalSize): GoalDraft {
  return {
    title: '',
    description: '',
    kind,
    size,
    lifeAreaId,
    startDate: '',
    targetDate: '',
    // A minimum of 1 against a target of 3 is the product's core rule expressed as a default: a
    // brand-new habit encourages from its first day rather than starting out already short.
    habit: { targetCount: '3', minimumCount: '1', period: 'week' },
    measured: { unit: '', startValue: '', targetValue: '' },
    scheduled: { targetSessions: '' },
  };
}

function numberField(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** A template's suggestions, poured into a draft. Everything stays editable. */
export function fromTemplate(
  template: GoalTemplate,
  lifeAreaId: string,
  size: GoalSize,
): GoalDraft {
  const draft = emptyDraft(template.kind, lifeAreaId, size);
  draft.title = template.title;

  switch (template.kind) {
    case 'habit':
      return {
        ...draft,
        habit: {
          targetCount: String(template.habit.targetCount),
          minimumCount: String(template.habit.minimumCount),
          period: template.habit.period,
        },
      };
    case 'measured':
      return {
        ...draft,
        measured: {
          unit: template.measured.unit ?? '',
          startValue: numberField(template.measured.startValue),
          targetValue: numberField(template.measured.targetValue),
        },
      };
    case 'scheduled':
      return {
        ...draft,
        scheduled: { targetSessions: numberField(template.scheduled.targetSessions) },
      };
  }
}

/** An existing goal as a draft, for the edit form. */
export function fromGoal(goal: GoalSummary): GoalDraft {
  const draft = emptyDraft(goal.kind, goal.area?.id ?? '', goal.size);
  const base: GoalDraft = {
    ...draft,
    title: goal.title,
    description: goal.description ?? '',
    startDate: goal.startDate ?? '',
    targetDate: goal.targetDate ?? '',
  };

  switch (goal.kind) {
    case 'habit':
      return {
        ...base,
        habit: {
          targetCount: String(goal.habit.targetCount),
          minimumCount: String(goal.habit.minimumCount),
          period: goal.habit.period,
        },
      };
    case 'measured':
      return {
        ...base,
        measured: {
          unit: goal.measured.unit ?? '',
          startValue: String(goal.measured.startValue),
          targetValue: String(goal.measured.targetValue),
        },
      };
    case 'scheduled':
      return {
        ...base,
        scheduled: { targetSessions: numberField(goal.scheduled.targetSessions) },
      };
  }
}

/** A refusal names the field it is about, so the form can move focus to it. */
export interface DraftProblem {
  field: string;
  message: string;
}

export type DraftResult<T> = { ok: true; body: T } | { ok: false; problem: DraftProblem };

function readNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Checks the parts the API insists on, in the app's own voice.
 *
 * It is not a second copy of the backend's validation — the backend is still the authority, and a
 * rejection from it is rendered calmly. It exists so the obvious things are caught without a round
 * trip, and so the message is a sentence rather than a field name.
 */
function checkCore(draft: GoalDraft): DraftProblem | null {
  if (draft.title.trim() === '') {
    return { field: 'title', message: 'Give it a name — whatever you would call it yourself.' };
  }
  if (draft.title.trim().length > 200) {
    return {
      field: 'title',
      message:
        'That name is longer than the app can keep. A short one works better on a tile anyway.',
    };
  }
  return null;
}

function habitProblem(draft: GoalDraft): DraftProblem | null {
  const target = readNumber(draft.habit.targetCount);
  const minimum = readNumber(draft.habit.minimumCount);

  if (target === null || target < 1) {
    return { field: 'targetCount', message: 'How many times, in a period, are you aiming for?' };
  }
  if (minimum === null || minimum < 1) {
    return {
      field: 'minimumCount',
      message: 'The minimum is what still counts as keeping it going. One is a good answer.',
    };
  }
  if (minimum > target) {
    return {
      field: 'minimumCount',
      message: 'The minimum sits below the target — it is the floor, not the goal.',
    };
  }
  return null;
}

function measuredProblem(draft: GoalDraft): DraftProblem | null {
  const start = readNumber(draft.measured.startValue);
  const target = readNumber(draft.measured.targetValue);

  if (start === null) {
    return { field: 'startValue', message: 'Where are you starting from?' };
  }
  if (target === null) {
    return { field: 'targetValue', message: 'And where would you like to get to?' };
  }
  if (start === target) {
    return {
      field: 'targetValue',
      message: 'Those two are the same, so there would be nothing to fill. Try a different target.',
    };
  }
  return null;
}

function scheduledProblem(draft: GoalDraft): DraftProblem | null {
  const sessions = readNumber(draft.scheduled.targetSessions);
  if (draft.scheduled.targetSessions.trim() !== '' && (sessions === null || sessions < 1)) {
    return {
      field: 'targetSessions',
      message: 'Either a number of sessions, or leave it blank to keep it open-ended.',
    };
  }
  return null;
}

function coreFields(draft: GoalDraft) {
  return {
    title: draft.title.trim(),
    description: optionalText(draft.description),
    size: draft.size,
    lifeAreaId: draft.lifeAreaId === '' ? null : draft.lifeAreaId,
    startDate: optionalText(draft.startDate),
    targetDate: optionalText(draft.targetDate),
  };
}

/** The draft as `POST /api/goals` — plain fields, no template, no status, no user. */
export function toCreateRequest(draft: GoalDraft): DraftResult<CreateGoalRequest> {
  const core = checkCore(draft);
  if (core !== null) return { ok: false, problem: core };

  const fields = coreFields(draft);

  switch (draft.kind) {
    case 'habit': {
      const problem = habitProblem(draft);
      if (problem !== null) return { ok: false, problem };
      return {
        ok: true,
        body: {
          ...fields,
          kind: 'habit',
          habit: {
            targetCount: Number(draft.habit.targetCount),
            minimumCount: Number(draft.habit.minimumCount),
            period: draft.habit.period,
          },
        },
      };
    }
    case 'measured': {
      const problem = measuredProblem(draft);
      if (problem !== null) return { ok: false, problem };
      return {
        ok: true,
        body: {
          ...fields,
          kind: 'measured',
          measured: {
            unit: optionalText(draft.measured.unit),
            startValue: Number(draft.measured.startValue),
            targetValue: Number(draft.measured.targetValue),
          },
        },
      };
    }
    case 'scheduled': {
      const problem = scheduledProblem(draft);
      if (problem !== null) return { ok: false, problem };
      return {
        ok: true,
        body: {
          ...fields,
          kind: 'scheduled',
          scheduled: { targetSessions: readNumber(draft.scheduled.targetSessions) },
        },
      };
    }
  }
}

/** The draft as `PATCH /api/goals/:id`. `kind` is never sent — a goal cannot change kind. */
export function toUpdateRequest(draft: GoalDraft): DraftResult<UpdateGoalRequest> {
  const created = toCreateRequest(draft);
  if (!created.ok) return created;

  // Built field by field rather than by stripping `kind` off the create body. A goal cannot change
  // kind — PATCH refuses the field outright — so an edit that carried it would be a 400 every time.
  const built = created.body;
  const body: UpdateGoalRequest = {
    title: built.title,
    description: built.description,
    size: built.size,
    lifeAreaId: built.lifeAreaId,
    startDate: built.startDate,
    targetDate: built.targetDate,
  };

  switch (built.kind) {
    case 'habit':
      return { ok: true, body: { ...body, habit: built.habit } };
    case 'measured':
      return { ok: true, body: { ...body, measured: built.measured } };
    case 'scheduled':
      return { ok: true, body: { ...body, scheduled: built.scheduled } };
  }
}
