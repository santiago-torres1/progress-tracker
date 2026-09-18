import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { goalById, jsonResponse, stubFetch } from '../test/fixtures';
import { forgetBrowserMemory, renderSignedIn } from '../test/harness';
import { ArchiveScreen } from './ArchiveScreen';

const shelved = [
  { ...goalById('goal-spanish'), status: 'completed' as const },
  { ...goalById('goal-bike'), status: 'archived' as const },
];

describe('ArchiveScreen — "My full glasses"', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('asks for exactly the finished and filed-away goals', async () => {
    const stub = stubFetch({
      goals: (statuses) =>
        statuses === 'completed,archived'
          ? jsonResponse({ goals: shelved })
          : jsonResponse({ goals: [] }),
    });

    renderSignedIn(<ArchiveScreen onBack={() => undefined} />);

    expect(await screen.findByText('Finish the Spanish course')).toBeInTheDocument();
    expect(screen.getByText('Save for a new bike')).toBeInTheDocument();

    const read = stub.seen.find((request) => request.path === '/api/goals');
    expect(read?.search).toBe('?status=completed,archived');
  });

  it('is a shelf, not a scoreboard', async () => {
    stubFetch({ goals: () => jsonResponse({ goals: shelved }) });
    renderSignedIn(<ArchiveScreen onBack={() => undefined} />);

    await screen.findByText('Finish the Spanish course');

    expect(document.body.textContent).toMatch(/not ranked and nothing here is counted/i);
    expect(document.body.textContent).not.toMatch(
      /trophy|badge|achievement|streak|points|level|congratulations|well done/i,
    );
  });

  it('says the shelf is empty without making that a disappointment', async () => {
    stubFetch({ goals: () => jsonResponse({ goals: [] }) });
    renderSignedIn(<ArchiveScreen onBack={() => undefined} />);

    expect(await screen.findByText(/Nothing on the shelf yet/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/you have not|none yet|empty-handed/i);
  });

  it('goes back to the board', async () => {
    stubFetch({ goals: () => jsonResponse({ goals: shelved }) });
    let back = false;
    renderSignedIn(
      <ArchiveScreen
        onBack={() => {
          back = true;
        }}
      />,
    );

    (await screen.findByRole('button', { name: 'Back to the board' })).click();
    expect(back).toBe(true);
  });
});
