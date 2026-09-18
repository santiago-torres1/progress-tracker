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

/** "Your glass is half full." — the mockup's line, said only when the numbers actually say it. */
function fillTitle(average: number | null): string {
  if (average === null) return 'Everything here is under way.';
  if (average === 0) return 'Your glass is waiting for its first pour.';
  if (average < 0.25) return 'Your glass has started to fill.';
  if (average < 0.45) return 'Your glass is filling.';
  if (average < 0.55) return 'Your glass is half full.';
  if (average < 0.85) return 'Your glass is more than half full.';
  if (average < 1) return 'Your glass is nearly full.';
  return 'Your glass is full.';
}

function goalsDetail(goals: readonly GoalSummary[]): string {
  const count = goals.length;
  const goalWord = plural(count, 'goal', 'goals');
  const areas = new Set(goals.map((goal) => goal.area?.id).filter((id) => id !== undefined));

  if (areas.size === 0) {
    return `${count} ${goalWord} on the board.`;
  }
  return `${count} ${goalWord} across ${areas.size} ${plural(areas.size, 'area', 'areas')}.`;
}

/**
 * The heading over the canvas: how full the glasses are on average, and what is on the board.
 *
 * An average is the honest summary of "a board of glasses" — it moves when any one of them
 * moves, and it cannot produce a sentence about falling behind because it has no target.
 */
export function dashboardHeadline(goals: readonly GoalSummary[]): Headline {
  if (goals.length === 0) {
    return { title: 'Nothing here yet. That is just room.', detail: 'No goals on the board.' };
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
  const headline = done === total ? 'Every glass on this week is filled.' : undefined;
  return { headline, summary };
}

export interface StatusCopy {
  title: string;
  body: string;
}

const SLOW: StatusCopy = {
  title: 'The data is taking its time.',
  body: 'The server did not answer quickly enough. It usually settles on its own.',
};

/** The API's own 503, which always names a short reason. */
function unavailableCopy(reason: UnavailableReason): StatusCopy {
  switch (reason) {
    case 'missing_env':
    case 'invalid_config':
      return {
        title: 'This demo is not connected to any data yet.',
        body: 'The app itself is running fine — it just has nowhere to read from at the moment.',
      };
    case 'timeout':
      return SLOW;
    case 'upstream_error':
      return {
        title: 'Nothing to show just now.',
        body: 'The server could not reach its database. It should come back by itself.',
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
        body: 'Nothing is wrong on your side. It is worth another look in a moment.',
      };
    case 'malformed':
      return {
        title: 'This page could not read the answer it was given.',
        body: 'The response did not match what this version of the app expects.',
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
        body: 'You have as many goals as this alpha holds. Finish one and it makes room again.',
      };
    case 'recurrences_per_goal':
      return {
        title: 'This goal has all the repeat rules it can hold.',
        body: 'Change one of the rules it already has, and it will cover the new days too.',
      };
    case 'progress_entries_per_goal':
    case 'calendar_entries_per_goal':
      return {
        title: 'This goal has a long history behind it.',
        body: 'It has as many entries as one goal holds in this alpha. Everything already logged stays.',
      };
    default:
      return {
        title: 'That is as far as this alpha goes.',
        body: 'You have reached one of its built-in limits. Nothing you have already made is affected.',
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
        title: 'There is already a note on that day.',
        body: 'Open the day and change the number that is there, rather than adding a second one.',
      };
    case null:
      return {
        title: 'That did not fit with what is already saved.',
        body: 'Nothing has changed. It is worth another look at the values before saving again.',
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
        body: 'Your goals are safe. The app just has to say hello to the server once more.',
      };
    case 'throttled':
      return {
        title: 'That is a lot of changes in a short while.',
        body: 'Everything saved so far is saved. Give it a few seconds and carry on.',
      };
    case 'missing':
      return {
        title: 'That is not here any more.',
        body: 'It may have been removed already. The rest of the board is untouched.',
      };
    case 'conflict':
      return conflictCopy(failure.error, failure.reason, failure.limit);
    case 'rejected':
      return {
        title: 'This page asked for something the server could not read.',
        body: failure.message ?? 'That is a fault in the app, not in anything you did.',
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
        body: 'It was put together without its database settings. Nothing is wrong at your end.',
      };
    case 'disabled':
      return {
        title: 'New visitors are not being let in just now.',
        body: 'Anonymous accounts are turned off on this project at the moment. That is a setting here, not anything to do with you.',
      };
    case 'rate_limited':
      return {
        title: 'A lot of people have arrived at once.',
        body: 'New accounts are being handed out slowly from this network. Trying again shortly usually works.',
      };
    case 'network':
      return {
        title: 'Cannot reach the sign-in service from here.',
        body: 'That is usually the connection rather than anything you did.',
      };
    case 'upstream':
      return {
        title: 'The sign-in service answered in a way this page did not expect.',
        body: 'Nothing is wrong on your side. It is worth another go in a moment.',
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

  return `Your goals live in this browser for 90 days from your last visit — until ${date} if you stopped now. Each visit moves that forward.`;
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
    return `Saved. ${removed} upcoming ${were} taken off your calendar. Anything already done stays.`;
  }
  const were = plural(removed, 'session was', 'sessions were');
  return `Saved. ${removed} upcoming ${were} replaced with ${created}. Anything already done stays.`;
}
