/*
 * Copy the API cannot write, derived from what it returned.
 *
 * The rule for everything here: it may describe, it may encourage, it may never grade. There is
 * no sentence below that a person could read as "you are behind", including the ones about
 * things going wrong — a failed request is the app's problem, and the words say so.
 */

import { plural } from '../components/format';
import type { ApiFailure, ApiFailureReason } from './api';
import type { CalendarEntry, GoalSummary, UnavailableReason } from '../types/api';

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
 * What to say when a read did not work.
 *
 * Every one of these is about the app or the server. None of them asks the reader to do
 * anything, and none of them is red: a page that cannot load is not a person's mistake.
 */
export function failureCopy(failure: ApiFailure): StatusCopy {
  switch (failure.kind) {
    case 'unavailable':
      return unavailableCopy(failure.reason);
    case 'rejected':
      return {
        title: 'This page asked for something the server could not read.',
        body: failure.message ?? 'That is a fault in the app, not in anything you did.',
      };
    case 'failed':
      return failedCopy(failure.reason);
  }
}
