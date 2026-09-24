import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { NAV_SECTIONS } from './lib/navigation';
import { goalById, jsonResponse, sessionPayload, stubFetch } from './test/fixtures';
import { TEST_ZONE, forgetBrowserMemory, testAuthStore, workingTransport } from './test/harness';

/*
 * The app as a whole: which URL renders which screen, and what the frame says about where you are.
 *
 * `AppRoutes` rather than `App` because a test has to start at a URL, which is what `MemoryRouter`
 * is for. Nothing else differs — `App` is the same tree with a browser history under it.
 *
 * Nothing here fixes the clock, so every assertion below holds on any day.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes authStore={testAuthStore(workingTransport())} browserTimeZone={TEST_ZONE} />
    </MemoryRouter>,
  );
}

/** A navigation link, found by the start of its name: the counts are part of it. */
function navLink(label: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(`^${label}`) });
}

/**
 * One row per section: its URL, what it is called in the column, and the region only that screen
 * renders. The last test in this file holds it against `NAV_SECTIONS`, so a section added to the
 * navigation without a route here fails the suite rather than 404ing in a browser.
 */
const SECTIONS = [
  { path: '/', label: 'Board', region: 'Your goals' },
  { path: '/calendar', label: 'Calendar', region: 'Calendar' },
  { path: '/glasses', label: 'My full glasses', region: 'My full glasses' },
  { path: '/profile', label: 'Profile', region: 'Profile' },
] as const;

describe('the route table', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it.each(SECTIONS)('serves $region at $path, and marks it as the page you are on', async (row) => {
    stubFetch();
    renderAt(row.path);

    expect(await screen.findByRole('region', { name: row.region })).toBeInTheDocument();
    expect(navLink(row.label)).toHaveAttribute('aria-current', 'page');
  });

  it('gives every section its own page rather than stacking two on one', async () => {
    stubFetch();
    renderAt('/');

    await screen.findByRole('region', { name: 'Your goals' });
    expect(screen.queryByRole('region', { name: 'Calendar' })).not.toBeInTheDocument();
  });

  it('heads each page with the section it is, so focus has somewhere to land', async () => {
    stubFetch();
    renderAt('/calendar');

    await screen.findByRole('region', { name: 'Calendar' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Calendar');
  });

  it('walks from the board to the calendar by following the link', async () => {
    stubFetch();
    renderAt('/');

    await screen.findByRole('region', { name: 'Your goals' });
    fireEvent.click(navLink('Calendar'));

    expect(await screen.findByRole('region', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your goals' })).not.toBeInTheDocument();
  });

  it('still opens the shelf from the board’s own button, and comes back', async () => {
    stubFetch({
      goals: (statuses) =>
        statuses === 'completed,archived'
          ? jsonResponse({ goals: [{ ...goalById('goal-spanish'), status: 'completed' }] })
          : jsonResponse({ goals: [goalById('goal-run')] }),
    });
    renderAt('/');

    fireEvent.click(await screen.findByRole('button', { name: 'My full glasses' }));

    expect(await screen.findByRole('region', { name: 'My full glasses' })).toBeInTheDocument();
    expect(screen.queryByText('Run three times a week')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));
    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
  });

  it('treats a trailing slash as the same page', async () => {
    stubFetch();
    renderAt('/calendar/');

    expect(await screen.findByRole('region', { name: 'Calendar' })).toBeInTheDocument();
    expect(navLink('Calendar')).toHaveAttribute('aria-current', 'page');
  });

  it('answers an address it does not have with a way back, not a blank page', async () => {
    stubFetch();
    renderAt('/tasks');

    expect(await screen.findByRole('region', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(screen.getByRole('link', { name: 'Back to your board' })).toBeInTheDocument();
  });

  it('counts the board and the shelf beside their sections, from the profile', async () => {
    stubFetch({
      session: () => jsonResponse(sessionPayload()),
    });
    renderAt('/');

    await screen.findByRole('region', { name: 'Your goals' });
    // sessionPayload: five goals on the board, seven glasses filled.
    expect(navLink('Board')).toHaveAccessibleName('Board, 5 on the board');
    expect(navLink('My full glasses')).toHaveAccessibleName('My full glasses, 7 filled');
  });

  it('keeps the deploy proof, demoted to the footer of whichever page you are on', async () => {
    stubFetch();
    renderAt('/profile');

    expect(await screen.findByText('Pass')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Alpha infra status' });
    expect(panel.closest('footer')).not.toBeNull();
  });

  it('asks nobody to sign in, on any of its pages', async () => {
    stubFetch();
    renderAt('/profile');

    await screen.findByRole('region', { name: 'Profile' });
    expect(screen.queryByLabelText(/password|email/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /sign up|sign in|log in/i }),
    ).not.toBeInTheDocument();
  });

  it('has a route for every section the navigation offers', () => {
    expect(SECTIONS.map((section) => section.path)).toEqual(
      NAV_SECTIONS.map((section) => section.path),
    );
  });
});
