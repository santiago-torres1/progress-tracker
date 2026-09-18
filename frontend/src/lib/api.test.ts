import { describe, expect, it, vi } from 'vitest';
import { areasPayload, calendarPayload, goalsPayload, jsonResponse } from '../test/fixtures';
import { fetchAreas, fetchCalendar, fetchGoals, fetchRecurrences } from './api';

function respondWith(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, status));
}

describe('fetchGoals', () => {
  it('returns the board when the payload matches the contract', async () => {
    const fetchImpl = respondWith(goalsPayload());
    const result = await fetchGoals({ fetchImpl });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.goals).toHaveLength(5);
    expect(result.data.goals[0]?.title).toBe('Run three times a week');
    expect(fetchImpl).toHaveBeenCalledWith('/api/goals', expect.anything());
  });

  it('passes a null fraction through untouched — it is not zero', async () => {
    const result = await fetchGoals({ fetchImpl: respondWith(goalsPayload()) });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const openEnded = result.data.goals.find((goal) => goal.id === 'goal-friends');
    expect(openEnded?.progress).toEqual({ basis: 'none', fraction: null });
  });

  it('keeps minimumMet: false as it is, without inventing anything beside it', async () => {
    const result = await fetchGoals({ fetchImpl: respondWith(goalsPayload()) });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const habit = result.data.goals.find((goal) => goal.id === 'goal-pages');
    expect(habit?.kind).toBe('habit');
    if (habit?.kind !== 'habit') return;
    expect(habit.habit.minimumMet).toBe(false);
    expect(habit.habit.minimumCount).toBe(1);
  });

  it('reports a 503 with its reason, so the UI can say "not configured" not "broken"', async () => {
    const body = { error: 'unavailable', reason: 'missing_env', missing: ['SUPABASE_URL'] };
    const result = await fetchGoals({ fetchImpl: respondWith(body, 503) });

    expect(result).toEqual({
      kind: 'unavailable',
      reason: 'missing_env',
      missing: ['SUPABASE_URL'],
    });
  });

  it('falls back to a general reason when a 503 names none', async () => {
    const result = await fetchGoals({ fetchImpl: respondWith({ error: 'unavailable' }, 503) });

    expect(result).toEqual({ kind: 'unavailable', reason: 'upstream_error', missing: [] });
  });

  it('reports a network error without an exception', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await fetchGoals({ fetchImpl });

    expect(result).toEqual({ kind: 'failed', reason: 'network', status: null });
  });

  it('treats an unreadable 200 as malformed rather than rendering half a board', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<!doctype html>', { status: 200 }));
    const result = await fetchGoals({ fetchImpl });

    expect(result).toEqual({ kind: 'failed', reason: 'malformed', status: 200 });
  });

  it('rejects a payload whose goal does not match the contract', async () => {
    const payload = goalsPayload();
    const broken = {
      goals: payload.goals.map((goal) => ({ ...goal, progress: { basis: 'nonsense' } })),
    };
    const result = await fetchGoals({ fetchImpl: respondWith(broken) });

    expect(result).toEqual({ kind: 'failed', reason: 'malformed', status: 200 });
  });

  it('reports an unexpected status as a plain failure', async () => {
    const result = await fetchGoals({ fetchImpl: respondWith({ error: 'boom' }, 500) });

    expect(result).toEqual({ kind: 'failed', reason: 'http', status: 500 });
  });

  it('rethrows when the caller aborts, so React cleanup wins', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    await expect(fetchGoals({ fetchImpl, signal: controller.signal })).rejects.toThrow();
  });
});

describe('fetchCalendar', () => {
  it('asks for the inclusive range as query parameters', async () => {
    const fetchImpl = respondWith(calendarPayload('2026-09-14', '2026-09-20'));
    const result = await fetchCalendar('2026-09-14', '2026-09-20', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/calendar?from=2026-09-14&to=2026-09-20',
      expect.anything(),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.from).toBe('2026-09-14');
    expect(result.data.entries.map((entry) => entry.id)).toContain('entry-run-thu');
  });

  it('keeps the timed / untimed discriminant honest', async () => {
    const result = await fetchCalendar('2026-09-17', '2026-09-17', {
      fetchImpl: respondWith(calendarPayload('2026-09-17', '2026-09-17')),
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const untimed = result.data.entries.find((entry) => entry.id === 'entry-call-thu');
    expect(untimed?.timing).toBe('untimed');
    expect(untimed?.startAt).toBeNull();
  });

  it('rejects a timed entry with no times', async () => {
    const body = {
      from: '2026-09-17',
      to: '2026-09-17',
      entries: [
        {
          id: 'entry-broken',
          date: '2026-09-17',
          timing: 'timed',
          startAt: null,
          endAt: null,
          timeZone: 'UTC',
          title: null,
          notes: null,
          status: 'planned',
          completedAt: null,
          recurrenceId: null,
          goal: null,
        },
      ],
    };
    const result = await fetchCalendar('2026-09-17', '2026-09-17', {
      fetchImpl: respondWith(body),
    });

    expect(result).toEqual({ kind: 'failed', reason: 'malformed', status: 200 });
  });

  it('carries a 400 back with the message the API wrote for the caller', async () => {
    const body = { error: 'invalid_range', message: 'from must be on or before to.' };
    const result = await fetchCalendar('2026-09-20', '2026-09-14', {
      fetchImpl: respondWith(body, 400),
    });

    expect(result).toEqual({
      kind: 'rejected',
      error: 'invalid_range',
      message: 'from must be on or before to.',
      field: null,
    });
  });
});

describe('fetchAreas', () => {
  it('returns the six life areas in legend order', async () => {
    const result = await fetchAreas({ fetchImpl: respondWith(areasPayload()) });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.areas.map((area) => area.slug)).toEqual([
      'health',
      'learning',
      'money',
      'relationships',
      'work',
      'creative',
    ]);
  });

  it('rejects an area without its colour or sort order', async () => {
    const body = { areas: [{ id: 'a', slug: 'health', name: 'Health', icon: null }] };
    const result = await fetchAreas({ fetchImpl: respondWith(body) });

    expect(result).toEqual({ kind: 'failed', reason: 'malformed', status: 200 });
  });
});

describe('fetchRecurrences', () => {
  const rule = {
    id: 'r1',
    goalId: 'g1',
    freq: 'weekly',
    interval: 1,
    byWeekday: [2, 4],
    startDate: '2026-09-01',
    untilDate: null,
    startTime: '19:00:00',
    endTime: '20:00:00',
    timeZone: 'Europe/Madrid',
    generatedThrough: '2026-12-01',
    isActive: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  };

  it("returns a goal's rules", async () => {
    const fetchImpl = respondWith({ recurrences: [rule] });
    const result = await fetchRecurrences('g1', { fetchImpl });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.recurrences).toHaveLength(1);
    expect(result.data.recurrences[0]?.byWeekday).toEqual([2, 4]);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/api/goals/g1/recurrences');
  });

  it('reads an empty list as an answer, not a failure', async () => {
    // A goal with no rules and someone else's goal answer the same way, on purpose.
    const result = await fetchRecurrences('g1', { fetchImpl: respondWith({ recurrences: [] }) });

    expect(result).toEqual({ kind: 'ok', data: { recurrences: [] } });
  });

  it('rejects a rule missing its schedule', async () => {
    const body = { recurrences: [{ id: 'r1', goalId: 'g1', freq: 'weekly' }] };
    const result = await fetchRecurrences('g1', { fetchImpl: respondWith(body) });

    expect(result).toEqual({ kind: 'failed', reason: 'malformed', status: 200 });
  });
});
