/*
 * Copy the API cannot write, derived from what it returned.
 *
 * The rule for everything here: it may describe, it may encourage, it may never grade. There is
 * no sentence below that a person could read as "you are behind", including the ones about
 * things going wrong — a failed request is the app's problem, and the words say so.
 */

import { plural } from '../components/format';
import type { ApiFailure, ApiFailureReason } from './api';
import type { AuthFailureReason } from './supabaseAuth';
import type {
  CalendarEntry,
  ConflictReason,
  GoalSummary,
  OccurrenceChange,
  UnavailableReason,
} from '../types/api';

export interface Headline {
  title: string;
  detail: string;
}

/** 0–1, or null when nothing on the board has a denominator yet. */
function averageFill(goals: readonly GoalSummary[]): number | null {
  // `fraction: null` is "no denominator yet", not zero: counting it as zero would invent a
  // half-empty board out of goals that are simply open-ended.
  const fractions = goals
    .map((goal) => goal.progress.fraction)
    .filter((fraction): fraction is number => fraction !== null)
    .map((fraction) => Math.min(Math.max(fraction, 0), 1));

  if (fractions.length === 0) return null;
  return fractions.reduce((total, fraction) => total + fraction, 0) / fractions.length;
}

/**
 * Where the water sits, said in words, at every level between empty and full.
 *
 * The app is called Half Full, so the one sentence this must never produce is "your glass is half
 * full": inside the interface that is an advertisement rather than a reading. Each line describes
 * the water and nothing else — no line is a verdict, and none of them can be reached by doing
 * badly, because there is no doing badly here.
 */
function fillTitle(average: number | null): string {
  if (average === null) return 'Nothing here counts down. It only fills.';
  if (average === 0) return 'Empty so far. Every full glass starts here.';
  if (average < 0.25) return 'There is water in the glass.';
  if (average < 0.45) return 'The water is climbing.';
  if (average < 0.55) return 'Level with the middle of the glass.';
  if (average < 0.85) return 'Past the middle, and still rising.';
  if (average < 1) return 'Close to the brim.';
  return 'Filled to the top.';
}

function goalsDetail(goals: readonly GoalSummary[]): string {
  const count = goals.length;
  const goalWord = plural(count, 'goal', 'goals');
  const areas = new Set(goals.map((goal) => goal.area?.id).filter((id) => id !== undefined));

  if (areas.size === 0) {
    return `${count} ${goalWord} on the board.`;
  }
  return `${count} ${goalWord} across ${areas.size} ${plural(areas.size, 'area', 'areas')} of your life.`;
}

/**
 * The heading over the canvas: how full the glasses are on average, and what is on the board.
 *
 * An average is the honest summary of "a board of glasses" — it moves when any one of them
 * moves, and it cannot produce a sentence about falling behind because it has no target.
 */
export function dashboardHeadline(goals: readonly GoalSummary[]): Headline {
  if (goals.length === 0) {
    return { title: 'Every board starts empty.', detail: 'Nothing on the board yet.' };
  }
  return { title: fillTitle(averageFill(goals)), detail: goalsDetail(goals) };
}

export interface WeekCopy {
  /** Only when the week has something worth naming; CalendarWeek is happy without one. */
  headline: string | undefined;
  summary: string;
}

/** The two lines above the week: a headline for the two ends of the range, and the plain count. */
export function weekCopy(periodLabel: string, entries: readonly CalendarEntry[]): WeekCopy {
  const total = entries.length;
  const done = entries.filter((entry) => entry.status === 'completed').length;

  if (total === 0) {
    return { headline: 'A clear week.', summary: `${periodLabel} · nothing planned` };
  }

  const things = plural(total, 'thing', 'things');
  const summary = `${periodLabel} · ${total} ${things} planned, ${done} already done`;
  const headline = done === total ? 'Every glass this week is filled.' : undefined;
  return { headline, summary };
}

export interface StatusCopy {
  title: string;
  body: string;
}

const SLOW: StatusCopy = {
  title: 'The server is taking its time.',
  body: 'It did not answer quickly enough. That usually sorts itself out in a moment.',
};

/** The API's own 503, which always names a short reason. */
function unavailableCopy(reason: UnavailableReason): StatusCopy {
  switch (reason) {
    case 'missing_env':
    case 'invalid_config':
      return {
        title: 'Nothing is connected to this page yet.',
        body: 'The app itself is running fine — it has nowhere to read from at the moment.',
      };
    case 'timeout':
      return SLOW;
    case 'upstream_error':
      return {
        title: 'Nothing to show just now.',
        body: 'The server could not reach its own database. That usually comes back on its own.',
      };
  }
}

/** No usable answer arrived at all. */
function failedCopy(reason: ApiFailureReason): StatusCopy {
  switch (reason) {
    case 'network':
      return {
        title: 'Cannot reach the server from here.',
        body: 'That is usually the connection rather than anything you did.',
      };
    case 'timeout':
      return SLOW;
    case 'http':
      return {
        title: 'The server answered in a way this page did not expect.',
        body: 'Nothing at your end did that. Another look in a moment usually works.',
      };
    case 'malformed':
      return {
        title: 'This page could not read the answer it was given.',
        body: 'The answer did not match what this version of the app knows how to read. Ours to fix.',
      };
  }
}

/**
 * A cap, said as the good news it is.
 *
 * `409 limit_reached` is the only place in the app where someone is told they cannot add
 * something, and it is not a failure: it means they have filled the board. The words never
 * apologise on the reader's behalf and never suggest they did something wrong.
 */
function cappedCopy(limit: string | null): StatusCopy {
  switch (limit) {
    case 'goals_per_user':
      return {
        title: 'That is a full board.',
        body: 'This alpha holds this many goals at once. Finish one or put it on the shelf, and the room comes back.',
      };
    case 'recurrences_per_goal':
      return {
        title: 'This goal holds all the repeat rules it can.',
        body: 'Edit one of the rules it already has and it will cover the new days too.',
      };
    case 'progress_entries_per_goal':
    case 'calendar_entries_per_goal':
      return {
        title: 'That is a long history for one goal.',
        body: 'It holds as many entries as one goal can in this alpha. Everything already logged stays exactly where it is.',
      };
    default:
      return {
        title: 'That is as far as this alpha goes.',
        body: 'A limit built into this version, not a judgement about anything. Nothing you have already made is touched.',
      };
  }
}

/** The state that produced a 409, in the app's own voice. */
export function conflictCopy(
  error: string,
  reason: ConflictReason | null,
  limit: string | null,
): StatusCopy {
  if (error === 'limit_reached') return cappedCopy(limit);

  switch (reason) {
    case 'wrong_goal_kind':
      return {
        title: 'That is not the way this goal records progress.',
        body: 'A habit is ticked and a measured goal is given a number. This one takes the other.',
      };
    case 'duplicate':
      return {
        title: 'That day already has a number on it.',
        body: 'Open the day and change the number that is there, rather than adding a second one.',
      };
    /*
     * Not a refusal — the app is holding on to something the person did. Undo is the way back and
     * the copy says so, because a dead end here would read as the app deciding it knows better.
     */
    case 'entry_completed':
      return {
        title: 'That day is already done.',
        body: 'It is the record of something you did, so it stays. Take the tick back and the day comes off like any other.',
      };
    case null:
      return {
        title: 'That did not fit with what is already saved.',
        body: 'Nothing has changed, and nothing is lost. The values are worth one more look before saving.',
      };
  }
}

/**
 * What to say when a read or a write did not work.
 *
 * Every one of these is about the app or the server. None of them asks the reader to do
 * anything, and none of them is red: a page that cannot load is not a person's mistake.
 */
export function failureCopy(failure: ApiFailure): StatusCopy {
  switch (failure.kind) {
    case 'unavailable':
      return unavailableCopy(failure.reason);
    case 'unauthenticated':
      return {
        title: 'This session needs picking up again.',
        body: 'Every goal is where you left it. The app only has to say hello to the server once more.',
      };
    case 'throttled':
      return {
        title: 'That is a lot of changes in a short while.',
        body: 'Everything saved so far is saved. A few seconds and the next one will go through.',
      };
    case 'missing':
      return {
        title: 'That one is already gone.',
        body: 'It is not on the board any more. Everything else is exactly where it was.',
      };
    case 'conflict':
      return conflictCopy(failure.error, failure.reason, failure.limit);
    case 'rejected':
      return {
        title: 'This page asked for something the server could not read.',
        body:
          failure.message ?? 'That is the app’s doing, not yours. Nothing was saved either way.',
      };
    case 'failed':
      return failedCopy(failure.reason);
  }
}

/**
 * Why the app could not get a session, in words that never blame the reader.
 *
 * All four of these are the app's or the project's doing. `rate_limited` in particular is
 * frequently somebody else on the same network, and it says so rather than implying anything
 * about the person reading it.
 */
export function signInFailureCopy(reason: AuthFailureReason): StatusCopy {
  switch (reason) {
    case 'not_configured':
      return {
        title: 'This build has nowhere to keep your goals yet.',
        body: 'It went out without its database settings. That is ours to fix, and nothing at your end caused it.',
      };
    case 'disabled':
      return {
        title: 'New visitors are not being let in just now.',
        body: 'Anonymous accounts are switched off on this project at the moment. That is a setting here, not anything to do with you.',
      };
    case 'rate_limited':
      return {
        title: 'A lot of people have arrived at once.',
        body: 'New accounts are being handed out slowly from this network. A minute or two and there will be one for you.',
      };
    case 'network':
      return {
        title: 'Cannot reach the sign-in service from here.',
        body: 'That is usually the connection rather than anything you did.',
      };
    case 'upstream':
      return {
        title: 'The sign-in service answered in a way this page did not expect.',
        body: 'Nothing at your end did that. Another go in a moment usually works.',
      };
  }
}

/**
 * How long a session's goals stick around, said once and calmly.
 *
 * Two things this must not do: imply there is a way to sign in (there is not, in this release) and
 * imply there is a way to export (there is not either). It says what is true and stops.
 */
export function expiryNote(expiresAt: string | null): string | null {
  if (expiresAt === null) return null;

  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;

  const date = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(when);

  return `Your board lives in this browser. 90 days without a visit and it is deleted — ${date}, if today were the last time. Every visit pushes that date back.`;
}

/**
 * What a repeat-rule change did to the timeline, in a sentence.
 *
 * `{removed: 26, created: 26}` is the API's answer and it is not a thing to put on screen. The
 * wording also has to carry the part that is easy to fear: nothing already done is touched. A rule
 * change only ever moves occurrences that had not happened yet.
 */
export function occurrenceSummary(change: OccurrenceChange): string {
  const { removed, created } = change;

  if (removed === 0 && created === 0) return 'Saved. Nothing on your calendar needed to move.';
  if (removed === 0) {
    const sessions = plural(created, 'session', 'sessions');
    return `Saved. ${created} upcoming ${sessions} added to your calendar.`;
  }
  if (created === 0) {
    const were = plural(removed, 'session was', 'sessions were');
    return `Saved. ${removed} upcoming ${were} taken off your calendar. Days you have already lived are untouched.`;
  }
  const were = plural(removed, 'session was', 'sessions were');
  return `Saved. ${removed} upcoming ${were} replaced with ${created}. Days you have already lived are untouched.`;
}
