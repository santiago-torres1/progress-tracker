import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOW,
  completionEntry,
  goalById,
  goalsPayload,
  habitAfterTick,
  jsonResponse,
  stubFetch,
  type SeenRequest,
} from '../test/fixtures';
import { forgetBrowserMemory, renderSignedIn } from '../test/harness';
import { Dashboard } from './Dashboard';

function board(onOpenArchive: () => void = () => undefined) {
  return <Dashboard now={NOW} onOpenArchive={onOpenArchive} />;
}

describe('Dashboard — reading the board', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('renders the board from a real payload', async () => {
    stubFetch();
    renderSignedIn(board());

    expect(await screen.findByText('Run three times a week')).toBeInTheDocument();
    expect(screen.getByText('Save for a new bike')).toBeInTheDocument();
    expect(screen.getByText('Finish the Spanish course')).toBeInTheDocument();
  });

  it('heads the canvas with how full the glasses actually are', async () => {
    stubFetch();
    renderSignedIn(board());

    expect(await screen.findByText('Your glass is half full.')).toBeInTheDocument();
    expect(screen.getByText('5 goals across 5 areas.')).toBeInTheDocument();
  });

  it('shows an open-ended goal its session count, never a 0% glass', async () => {
    stubFetch();
    renderSignedIn(board());

    expect(await screen.findByText('3 done · 2 planned')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('reads a habit under its minimum as encouragement, not as a failure', async () => {
    stubFetch();
    renderSignedIn(board());

    expect(await screen.findByText('One is still enough this week')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/behind|missed|broken streak/i);
  });

  it('says plainly how long a session lasts, without implying a sign-in or an export', async () => {
    stubFetch();
    renderSignedIn(board());

    await screen.findByText(/90 days from your last visit/);

    const note = screen.getByText(/90 days from your last visit/);
    expect(note.textContent).toMatch(/December/);
    expect(note.textContent).toMatch(/2026/);
    expect(document.body.textContent).not.toMatch(/export|download your data|sign in to keep/i);
  });
});

describe('Dashboard — making a goal', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('gives an empty board something to press', async () => {
    stubFetch({ goals: () => jsonResponse({ goals: [] }) });
    renderSignedIn(board());

    const add = await screen.findByRole('button', { name: 'Add your first goal' });
    expect(add).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet. That is just room.')).toBeInTheDocument();
  });

  it('creates a goal from a template, with every suggestion still editable', async () => {
    const created = { ...goalById('goal-run'), id: 'goal-new', title: 'Move my body' };
    let posted: SeenRequest | undefined;
    stubFetch({
      goals: () => jsonResponse({ goals: [] }),
      write: (request) => {
        if (request.path === '/api/goals' && request.method === 'POST') {
          posted = request;
          return jsonResponse({ goal: created }, 201);
        }
        return undefined;
      },
    });

    renderSignedIn(board());
    fireEvent.click(await screen.findByRole('button', { name: 'Add your first goal' }));

    fireEvent.click(await screen.findByRole('button', { name: /Health & Wellbeing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Move your body/ }));

    // The template filled the form in; nothing about it is fixed.
    const title = await screen.findByLabelText('What would you like more of?');
    expect(title).toHaveValue('Move your body');
    expect(screen.getByLabelText('Aiming for')).toHaveValue('3');
    expect(screen.getByLabelText('And it still counts at')).toHaveValue('1');

    fireEvent.change(screen.getByLabelText('Aiming for'), { target: { value: '4' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Add it to the board' }));

    await waitFor(() => {
      expect(posted).toBeDefined();
    });
    expect(posted?.body).toMatchObject({
      kind: 'habit',
      title: 'Move your body',
      habit: { targetCount: 4, minimumCount: 1, period: 'week' },
    });
    // A template is a source of defaults and is never named in the request.
    expect(JSON.stringify(posted?.body)).not.toMatch(/template/i);
  });

  it('offers "Something else" as an ordinary choice, with nothing pre-filled', async () => {
    stubFetch({ goals: () => jsonResponse({ goals: [] }) });
    renderSignedIn(board());

    fireEvent.click(await screen.findByRole('button', { name: 'Add your first goal' }));
    fireEvent.click(await screen.findByRole('button', { name: /Health & Wellbeing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Something else/ }));

    expect(await screen.findByLabelText('What would you like more of?')).toHaveValue('');
    // The kind chooser is there, because a custom goal may be any of the three.
    expect(screen.getByRole('radio', { name: /A habit/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /A number/ })).toBeInTheDocument();
  });

  it('reads a cap as a full board rather than as a failure', async () => {
    stubFetch({
      goals: () => jsonResponse({ goals: [] }),
      write: (request) =>
        request.path === '/api/goals' && request.method === 'POST'
          ? jsonResponse({ error: 'limit_reached', limit: 'goals_per_user' }, 409)
          : undefined,
    });

    renderSignedIn(board());
    fireEvent.click(await screen.findByRole('button', { name: 'Add your first goal' }));
    fireEvent.click(await screen.findByRole('button', { name: /Health & Wellbeing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Move your body/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add it to the board' }));

    expect(await screen.findByText('That is a full board.')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Finish one and it makes room again/);
    expect(document.body.textContent).not.toMatch(/error|failed|sorry|cannot/i);
  });
});

describe('Dashboard — using a goal', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('ticks a habit and refills the glass from the response, without refetching the board', async () => {
    const ticked = habitAfterTick('goal-run');
    const stub = stubFetch({
      write: (request) =>
        request.path === '/api/goals/goal-run/completions' && request.method === 'POST'
          ? jsonResponse({ created: true, entry: completionEntry('goal-run'), goal: ticked })
          : undefined,
    });

    renderSignedIn(board());
    await screen.findByText('Run three times a week');

    const before = stub.seen.filter((r) => r.path === '/api/goals' && r.method === 'GET').length;
    fireEvent.click(
      await screen.findByRole('button', { name: /Add one to Run three times a week this week/ }),
    );

    // 2 of 4 became 3 of 4, and it came out of the write's own response.
    expect(await screen.findByText(/3 of 4 this week/)).toBeInTheDocument();

    const after = stub.seen.filter((r) => r.path === '/api/goals' && r.method === 'GET').length;
    expect(after).toBe(before);
  });

  it('completes against today in the profile’s zone, not the browser’s', async () => {
    let posted: SeenRequest | undefined;
    stubFetch({
      write: (request) => {
        if (request.path === '/api/goals/goal-run/completions') {
          posted = request;
          return jsonResponse({
            created: true,
            entry: completionEntry('goal-run'),
            goal: habitAfterTick('goal-run'),
          });
        }
        return undefined;
      },
    });

    renderSignedIn(board());
    await screen.findByText('Run three times a week');
    fireEvent.click(
      await screen.findByRole('button', { name: /Add one to Run three times a week this week/ }),
    );

    await waitFor(() => {
      expect(posted).toBeDefined();
    });
    // The fixture profile is Europe/Madrid, and NOW is 09:30 local on the 17th.
    expect(posted?.body).toEqual({ date: '2026-09-17' });
  });

  it('takes a tick back in one tap and puts the glass where it was', async () => {
    const original = goalById('goal-run');
    stubFetch({
      write: (request) => {
        if (request.method === 'POST' && request.path.endsWith('/completions')) {
          return jsonResponse({
            created: true,
            entry: completionEntry('goal-run'),
            goal: habitAfterTick('goal-run'),
          });
        }
        if (request.method === 'DELETE' && request.path.includes('/completions/')) {
          return jsonResponse({
            action: 'deleted',
            entry: completionEntry('goal-run'),
            goal: original,
          });
        }
        return undefined;
      },
    });

    renderSignedIn(board());
    await screen.findByText('Run three times a week');
    fireEvent.click(
      await screen.findByRole('button', { name: /Add one to Run three times a week this week/ }),
    );
    await screen.findByText(/3 of 4 this week/);

    // One tap, no confirmation dialog in between.
    const undo = await screen.findByRole('button', {
      name: 'Undo the last change to Run three times a week',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(undo);

    expect(await screen.findByText(/2 of 4 this week/)).toBeInTheDocument();
  });

  it('treats a 404 on an undo as "already gone", not as a failure', async () => {
    stubFetch({
      write: (request) => {
        if (request.method === 'POST' && request.path.endsWith('/completions')) {
          return jsonResponse({
            created: true,
            entry: completionEntry('goal-run'),
            goal: habitAfterTick('goal-run'),
          });
        }
        if (request.method === 'DELETE') {
          return jsonResponse({ error: 'not_found', reason: 'entry' }, 404);
        }
        return undefined;
      },
    });

    renderSignedIn(board());
    await screen.findByText('Run three times a week');
    fireEvent.click(
      await screen.findByRole('button', { name: /Add one to Run three times a week this week/ }),
    );

    const undo = await screen.findByRole('button', {
      name: 'Undo the last change to Run three times a week',
    });
    fireEvent.click(undo);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', {
          name: 'Undo the last change to Run three times a week',
        }),
      ).not.toBeInTheDocument();
    });
    expect(document.body.textContent).not.toMatch(/not here any more/i);
  });

  it('gives a measured goal a value to log, never a tick', async () => {
    const moved = {
      ...goalById('goal-bike'),
      progress: { basis: 'measured_value' as const, fraction: 0.7 },
    };
    let posted: SeenRequest | undefined;

    stubFetch({
      write: (request) => {
        if (request.path === '/api/goals/goal-bike/measurements' && request.method === 'POST') {
          posted = request;
          return jsonResponse({
            measurement: {
              id: 'm-1',
              goalId: 'goal-bike',
              occurredOn: '2026-09-17',
              value: 630,
              note: null,
              calendarEntryId: null,
              createdAt: '2026-09-17T09:30:00.000Z',
              updatedAt: '2026-09-17T09:30:00.000Z',
            },
            goal: moved,
          });
        }
        return undefined;
      },
    });

    renderSignedIn(board());
    await screen.findByText('Save for a new bike');

    expect(
      screen.queryByRole('button', { name: /Mark Save for a new bike done/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Log a value for Save for a new bike' }),
    );

    const input = await screen.findByLabelText('Where is it now?');
    expect(input).toHaveValue('540');
    fireEvent.change(input, { target: { value: '630' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Log it' }));

    await waitFor(() => {
      expect(posted).toBeDefined();
    });
    expect(posted?.body).toEqual({ value: 630, occurredOn: '2026-09-17' });
  });
});

describe('Dashboard — putting a goal on the shelf', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  it('archives a goal and takes it off the active board', async () => {
    let patched: SeenRequest | undefined;
    stubFetch({
      write: (request) => {
        if (request.path === '/api/goals/goal-run' && request.method === 'PATCH') {
          patched = request;
          return jsonResponse({ goal: { ...goalById('goal-run'), status: 'archived' } });
        }
        return undefined;
      },
    });

    renderSignedIn(board());
    fireEvent.click(await screen.findByRole('button', { name: 'Run three times a week' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Put it on the shelf' }));

    await waitFor(() => {
      expect(patched?.body).toEqual({ status: 'archived' });
    });
    await waitFor(
      () => {
        expect(screen.queryByText('Run three times a week')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('offers the shelf from the board, and calls it "My full glasses"', async () => {
    stubFetch();
    let opened = false;
    renderSignedIn(
      board(() => {
        opened = true;
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'My full glasses' }));
    expect(opened).toBe(true);
  });

  it('never turns finishing a goal into a score', async () => {
    stubFetch();
    renderSignedIn(board());
    fireEvent.click(await screen.findByRole('button', { name: 'Run three times a week' }));

    await screen.findByRole('button', { name: 'Put it on the shelf' });
    expect(document.body.textContent).not.toMatch(/trophy|badge|achievement|streak|points|level/i);
  });
});

describe('Dashboard — rearranging by keyboard', () => {
  beforeEach(() => {
    forgetBrowserMemory();
  });

  /** Only the layout batches. The first-run time-zone PATCH is a write too, and is not one. */
  function layoutWrites(stub: ReturnType<typeof stubFetch>) {
    return stub.writes().filter((request) => request.path === '/api/goals/layout');
  }

  async function grabFirstTile() {
    const handle = await screen.findByRole('button', { name: 'Rearrange Run three times a week' });
    handle.focus();
    return handle;
  }

  function press(element: Element, key: string) {
    fireEvent.keyDown(element, { key });
  }

  it('moves a tile with the arrow keys and saves the whole gesture in one request', async () => {
    const stub = stubFetch({
      write: (request) =>
        request.path === '/api/goals/layout'
          ? jsonResponse({
              tiles: goalsPayload().goals.map((goal, index) => ({
                id: goal.id,
                sortOrder: (index + 1) * 10,
                size: goal.size,
              })),
            })
          : undefined,
    });

    renderSignedIn(board());
    const handle = await grabFirstTile();

    press(handle, ' ');
    press(handle, 'ArrowRight');
    press(handle, 'ArrowRight');
    press(handle, 'ArrowRight');
    press(handle, ' ');

    await waitFor(() => {
      expect(layoutWrites(stub)).toHaveLength(1);
    });

    // Three keypresses, one PATCH — the write quota is sixty a minute.
    const batch = layoutWrites(stub)[0];
    expect(batch?.method).toBe('PATCH');
    const body = batch?.body as { tiles: { id: string; sortOrder?: number }[] };
    expect(body.tiles.length).toBeGreaterThan(1);
    expect(body.tiles.map((tile) => tile.id)).toContain('goal-run');
  });

  it('resizes with + and − as part of the same gesture', async () => {
    const stub = stubFetch({
      write: (request) =>
        request.path === '/api/goals/layout' ? jsonResponse({ tiles: [] }) : undefined,
    });

    renderSignedIn(board());
    const handle = await grabFirstTile();

    press(handle, ' ');
    press(handle, '-');
    press(handle, ' ');

    await waitFor(() => {
      expect(layoutWrites(stub)).toHaveLength(1);
    });
    const body = layoutWrites(stub)[0]?.body as { tiles: { id: string; size?: string }[] };
    expect(body.tiles).toEqual([{ id: 'goal-run', size: 'medium' }]);
  });

  it('sends nothing at all when a gesture ends where it started', async () => {
    const stub = stubFetch();

    renderSignedIn(board());
    const handle = await grabFirstTile();

    press(handle, ' ');
    press(handle, 'ArrowRight');
    press(handle, 'ArrowLeft');
    press(handle, ' ');

    await waitFor(() => {
      expect(screen.getByText('Left where it was.')).toBeInTheDocument();
    });
    expect(layoutWrites(stub)).toHaveLength(0);
  });

  it('puts every tile back when the batch is refused', async () => {
    stubFetch({
      write: (request) =>
        request.path === '/api/goals/layout'
          ? jsonResponse({ error: 'not_found', reason: 'goal' }, 404)
          : undefined,
    });

    renderSignedIn(board());
    const handle = await grabFirstTile();

    const titlesBefore = screen
      .getAllByRole('button', { name: /^Rearrange / })
      .map((button) => button.getAttribute('aria-label'));

    press(handle, ' ');
    press(handle, 'ArrowRight');
    press(handle, ' ');

    await waitFor(() => {
      expect(screen.getByText('Put back where it was — that did not save.')).toBeInTheDocument();
    });

    const titlesAfter = screen
      .getAllByRole('button', { name: /^Rearrange / })
      .map((button) => button.getAttribute('aria-label'));
    expect(titlesAfter).toEqual(titlesBefore);
  });

  it('puts a tile back on Escape, and sends nothing', async () => {
    const stub = stubFetch();

    renderSignedIn(board());
    const handle = await grabFirstTile();

    press(handle, ' ');
    press(handle, 'ArrowRight');
    press(handle, 'Escape');

    await waitFor(() => {
      expect(screen.getByText('Put back where it was.')).toBeInTheDocument();
    });
    expect(layoutWrites(stub)).toHaveLength(0);
  });
});
