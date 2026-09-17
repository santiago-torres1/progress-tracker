import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NOW, jsonResponse, stubFetch } from '../test/fixtures';
import { Dashboard } from './Dashboard';

describe('Dashboard', () => {
  it('renders the board from a real payload', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
    expect(screen.getByText('Save for a new bike')).toBeInTheDocument();
    expect(screen.getByText('Finish the Spanish course')).toBeInTheDocument();
    expect(screen.getByText('See friends more often')).toBeInTheDocument();
    expect(screen.getByText('Morning pages')).toBeInTheDocument();
  });

  it('heads the canvas with how full the glasses actually are', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('Your glass is half full.')).toBeInTheDocument();
    expect(screen.getByText('5 goals across 5 areas.')).toBeInTheDocument();
  });

  it('shows an open-ended goal its session count, never a 0% glass', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    // `progress.fraction` is null for this one: there is no denominator, so there is no percentage.
    expect(await screen.findByText('3 done · 2 planned')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('reads a habit under its minimum as encouragement, not as a failure', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('One is still enough this week')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 this week · minimum is 1')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/behind|missed|broken streak/i);
  });

  it('says one quiet line about a goal that has gone backwards, and nothing more', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText(/a little lower than it was on/)).toBeInTheDocument();
  });

  it('lists what is still to come today, and leaves out what is already done', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('Still to come')).toBeInTheDocument();
    expect(screen.getByText('Call Mum')).toBeInTheDocument();
    expect(screen.getByText('Spanish class')).toBeInTheDocument();
    // The run was done at 07:00; the strip is about what is left, not what was.
    expect(screen.queryByText('Morning run')).not.toBeInTheDocument();
  });

  it('names only the life areas the board actually uses', async () => {
    stubFetch();
    render(<Dashboard now={NOW} />);

    const key = await screen.findByRole('list', { name: 'Life areas' });
    const names = Array.from(key.querySelectorAll('li')).map((item) => item.textContent);

    expect(names).toEqual([
      'Health & Wellbeing',
      'Learning & Skills',
      'Money & Finances',
      'Relationships',
      'Creativity & Hobbies',
    ]);
  });

  it('offers room rather than an empty canvas when there are no goals', async () => {
    stubFetch({ goals: () => jsonResponse({ goals: [] }) });
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('Nothing here yet. That is just room.')).toBeInTheDocument();
    // There is no create flow yet, so the empty state must not offer a button that lies.
    expect(screen.queryByRole('button', { name: 'Add your first goal' })).not.toBeInTheDocument();
  });

  it('says the demo is not connected when the API reports missing configuration', async () => {
    const unavailable = { error: 'unavailable', reason: 'missing_env', missing: ['SUPABASE_URL'] };
    stubFetch({ goals: () => jsonResponse(unavailable, 503) });
    render(<Dashboard now={NOW} />);

    expect(
      await screen.findByText('This demo is not connected to any data yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/running fine/)).toBeInTheDocument();
  });

  it('blames the connection, never the reader, when the request does not arrive', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('boom')));
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('Cannot reach the server from here.')).toBeInTheDocument();
    expect(screen.getByText(/rather than anything you did/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/error|failed|invalid/i);
  });

  it('offers a single retry rather than asking again on its own', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('boom'));
    vi.stubGlobal('fetch', fetchImpl);
    render(<Dashboard now={NOW} />);

    await screen.findByText('Cannot reach the server from here.');
    const before = fetchImpl.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchImpl.mock.calls.length).toBe(before);
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('keeps the glasses on screen when only today’s plan fails to load', async () => {
    stubFetch({ calendar: () => jsonResponse({ error: 'unavailable', reason: 'timeout' }, 503) });
    render(<Dashboard now={NOW} />);

    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
    expect(await screen.findByText('Today’s plan is not loading just now.')).toBeInTheDocument();
  });
});
