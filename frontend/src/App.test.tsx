import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { goalById, jsonResponse, stubFetch } from './test/fixtures';
import { TEST_ZONE, forgetBrowserMemory, testAuthStore, workingTransport } from './test/harness';

/*
 * The page as a whole. Nothing here fixes the clock — App reads the real one — so these
 * assertions are the ones that hold on any day.
 */
function renderApp() {
  return render(<App authStore={testAuthStore(workingTransport())} browserTimeZone={TEST_ZONE} />);
}

describe('App', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('opens on the goals dashboard, with nobody asked to sign in', async () => {
    stubFetch();
    renderApp();

    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Progress Tracker');
    expect(screen.queryByLabelText(/password|email/i)).not.toBeInTheDocument();
  });

  it('keeps the calendar under the dashboard', async () => {
    stubFetch();
    renderApp();

    await screen.findByText('Run three times a week');

    const sections = screen.getAllByRole('region');
    const labels = sections.map((section) => section.getAttribute('aria-label'));
    expect(labels).toContain('Your goals');
    expect(labels).toContain('Calendar');
    expect(labels.indexOf('Your goals')).toBeLessThan(labels.indexOf('Calendar'));
  });

  it('swaps the board for the shelf, and back again', async () => {
    stubFetch({
      goals: (statuses) =>
        statuses === 'completed,archived'
          ? jsonResponse({ goals: [{ ...goalById('goal-spanish'), status: 'completed' }] })
          : jsonResponse({ goals: [goalById('goal-run')] }),
    });
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'My full glasses' }));

    expect(await screen.findByRole('heading', { name: 'My full glasses' })).toBeInTheDocument();
    expect(screen.queryByText('Run three times a week')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the board' }));
    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
  });

  it('still shows the deploy proof, demoted to the footer', async () => {
    stubFetch();
    renderApp();

    expect(await screen.findByText('Pass')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Alpha infra status' });
    expect(panel.closest('footer')).not.toBeNull();
  });
});
