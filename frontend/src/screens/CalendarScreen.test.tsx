import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from '../components/format';
import { NOW, calendarRanges, jsonResponse, stubFetch } from '../test/fixtures';
import { CalendarScreen } from './CalendarScreen';

/** The cell label CalendarMonth hides for screen readers, in whatever locale the runner uses. */
function dayLabel(date: string): string {
  return formatCalendarDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
}

function clickTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

/**
 * The grid cell for a day. The selected day's long date is also the detail panel's heading, so
 * the cell is the one that is a hidden span rather than an <h3>.
 */
async function monthCell(date: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(dayLabel(date));
  const cell = matches.find((element) => element.tagName === 'SPAN');
  if (cell === undefined) throw new Error(`No month cell for ${date}`);
  return cell;
}

describe('CalendarScreen', () => {
  it('opens on the week containing today and asks for exactly that week', async () => {
    const fetchImpl = stubFetch();
    render(<CalendarScreen now={NOW} />);

    await waitFor(() => {
      expect(calendarRanges(fetchImpl)).toEqual(['from=2026-09-14&to=2026-09-20']);
    });
    expect(await screen.findByText(/8 things planned, 2 already done/)).toBeInTheDocument();
  });

  it('asks for a single day in the day view, and puts the now-line on it', async () => {
    const fetchImpl = stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    clickTab('Day');

    await waitFor(() => {
      expect(calendarRanges(fetchImpl)).toContain('from=2026-09-17&to=2026-09-17');
    });
    expect(await screen.findByText('now')).toBeInTheDocument();
    // 09:30, between the run that happened and the class this evening.
    expect(screen.getByText('09:30')).toBeInTheDocument();
    expect(screen.getByText('Call Mum')).toBeInTheDocument();
  });

  it('asks for the whole month grid, padding included, in the month view', async () => {
    const fetchImpl = stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    clickTab('Month');

    await waitFor(() => {
      expect(calendarRanges(fetchImpl)).toContain('from=2026-08-31&to=2026-10-04');
    });
    // Entries on the padded days are fetched and drawn, rather than left looking like empty days.
    expect(await screen.findByText('Long run')).toBeInTheDocument();
    expect(screen.getByText('New term starts')).toBeInTheDocument();
  });

  it('marks today and makes the days either side of the month quiet', async () => {
    stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    clickTab('Month');

    const today = await monthCell('2026-09-17');
    expect(today.closest('button')).toHaveAttribute('aria-current', 'date');

    // A day from August is shown for shape only: not a target, and not marked as today.
    const padding = await monthCell('2026-08-31');
    expect(padding.closest('button')).toBeNull();

    const ordinaryDay = await monthCell('2026-09-18');
    expect(ordinaryDay.closest('button')).not.toBeNull();
    expect(ordinaryDay.closest('button')).not.toHaveAttribute('aria-current');
  });

  it('steps a period at a time, and comes back to today', async () => {
    const fetchImpl = stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => {
      expect(calendarRanges(fetchImpl)).toContain('from=2026-09-21&to=2026-09-27');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() => {
      expect(calendarRanges(fetchImpl)).toContain('from=2026-09-07&to=2026-09-13');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => {
      expect(calendarRanges(fetchImpl).at(-1)).toBe('from=2026-09-14&to=2026-09-20');
    });
  });

  it('steps by month, clamping to a day the next month has', async () => {
    const fetchImpl = stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    clickTab('Month');
    await monthCell('2026-09-17');

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    await waitFor(() => {
      // October 2026 starts on a Thursday and ends on a Saturday.
      expect(calendarRanges(fetchImpl)).toContain('from=2026-09-28&to=2026-11-01');
    });
  });

  it('opens a day from a week row that has more than it can show', async () => {
    const fetchImpl = stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    // Four things on the Thursday: three bars and one "1 more".
    fireEvent.click(screen.getByRole('button', { name: '1 more' }));

    await waitFor(() => {
      expect(calendarRanges(fetchImpl)).toContain('from=2026-09-17&to=2026-09-17');
    });
    expect(await screen.findByRole('tab', { name: 'Day', selected: true })).toBeInTheDocument();
  });

  it('tags a completed entry that was never planned, and it still counts', async () => {
    stubFetch();
    render(<CalendarScreen now={NOW} />);

    expect(await screen.findByText('logged, not planned')).toBeInTheDocument();
  });

  it('says a planned entry on a day gone by did not happen, and nothing more', async () => {
    stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    // The only thing said about it, and it is said to screen readers rather than shouted.
    expect(screen.getByText(', did not happen')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/overdue|behind|missed/i);
  });

  it('never marks anything planned for today as gone', async () => {
    stubFetch();
    render(<CalendarScreen now={NOW} />);
    await screen.findByText(/8 things planned/);

    clickTab('Day');
    await screen.findByText('now');

    expect(screen.queryByText(', did not happen')).not.toBeInTheDocument();
  });

  it('says so calmly when the calendar cannot be read', async () => {
    stubFetch({
      calendar: () => jsonResponse({ error: 'unavailable', reason: 'missing_env' }, 503),
    });
    render(<CalendarScreen now={NOW} />);

    expect(
      await screen.findByText('This demo is not connected to any data yet.'),
    ).toBeInTheDocument();
  });

  it('does not claim a week is empty while it is still loading', () => {
    stubFetch();
    render(<CalendarScreen now={NOW} />);

    expect(screen.getByText('Reading your calendar…')).toBeInTheDocument();
    expect(screen.queryByText('Nothing planned')).not.toBeInTheDocument();
  });
});
