import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { stubFetch } from './test/fixtures';

/*
 * The page as a whole. Nothing here fixes the clock — App reads the real one — so these
 * assertions are the ones that hold on any day.
 */
describe('App', () => {
  it('opens on the goals dashboard', async () => {
    stubFetch();
    render(<App />);

    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Progress Tracker');
  });

  it('keeps the calendar under the dashboard', async () => {
    stubFetch();
    render(<App />);

    await screen.findByText('Run three times a week');

    const sections = screen.getAllByRole('region');
    const labels = sections.map((section) => section.getAttribute('aria-label'));
    expect(labels).toContain('Your goals');
    expect(labels).toContain('Calendar');
    expect(labels.indexOf('Your goals')).toBeLessThan(labels.indexOf('Calendar'));
  });

  it('still shows the deploy proof, demoted to the footer', async () => {
    stubFetch();
    render(<App />);

    expect(await screen.findByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('0.1.1-alpha')).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Alpha infra status' });
    expect(panel.closest('footer')).not.toBeNull();
  });
});
