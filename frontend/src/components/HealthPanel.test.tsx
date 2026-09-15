import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HealthPanel } from './HealthPanel';

describe('HealthPanel', () => {
  it('shows Pass with the API version and commit when /health responds ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ok',
            version: '0.1.0-alpha',
            commit: '0123456789abcdef0123456789abcdef01234567',
            timestamp: '2026-09-14T12:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );

    render(<HealthPanel />);

    expect(await screen.findByText('Pass')).toBeInTheDocument();
    expect(screen.getByText('0.1.0-alpha')).toBeInTheDocument();
    expect(screen.getByText('0123456')).toBeInTheDocument();
  });

  it('shows Fail with a reason when /health is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    render(<HealthPanel />);

    expect(await screen.findByText('Fail')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });
});
