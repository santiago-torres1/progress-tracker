/*
 * The component gallery: every screen surface, rendered from fixtures, with no session and no API.
 *
 * WHY IT EXISTS. The app cannot render without an anonymous account and a live backend, so the
 * only way to LOOK at a tile used to be to deploy one. Two of the bugs in 0.2.0-alpha were pure
 * layout — a pill overflowing its column, controls colliding — and neither is visible to jsdom,
 * which has no layout at all. This page is what a browser (and a screenshot) can be pointed at.
 *
 * It is dev-only: `gallery.html` sits beside `index.html` but is not in the production build's
 * inputs, so none of this reaches a visitor.
 */

import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { CalendarWeek } from '../components/CalendarWeek';
import { GoalAction } from '../components/GoalAction';
import { GoalCanvas } from '../components/GoalCanvas';
import { ProfileView } from '../screens/ProfileScreen';
import { GALLERY_NOW, GOALS, PROFILE, WEEK } from './fixtures';
import type { Arrange, ArrangeHandleProps } from '../lib/useArrange';
import type { GoalSummary } from '../types/api';
import './gallery.css';

/** Enough of `Arrange` to draw the grip. Nothing here moves — the gallery is for looking. */
function stillArrange(heldId: string | null): Arrange {
  const handleProps = (goal: GoalSummary): ArrangeHandleProps => ({
    'aria-pressed': goal.id === heldId,
    'aria-label': `Move ${goal.title}`,
    style: {},
    onKeyDown: () => undefined,
    onPointerDown: () => undefined,
    onPointerMove: () => undefined,
    onPointerUp: () => undefined,
    onPointerCancel: () => undefined,
  });

  return {
    heldId,
    message: '',
    handleProps,
    registerCell: () => () => undefined,
  };
}

/** As much of the session as the frame reads. */
const SHELL_SESSION = {
  goalsOnBoard: PROFILE.stats.goalsOnBoard,
  glassesFilled: PROFILE.stats.glassesFilled,
  isAnonymous: PROFILE.isAnonymous,
};

/**
 * The shell needs a router for its links and its `useLocation`; `MemoryRouter` gives it one without
 * touching the gallery's own URL, and `initialEntries` is how a case picks the page it is showing.
 */
function atPath(path: string, children: React.ReactNode) {
  return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
}

interface CaseProps {
  title: string;
  note?: string;
  children: React.ReactNode;
}

/**
 * `?only=shell` renders just the cases whose title contains "shell".
 *
 * Not a convenience: a headless screenshot captures a window, and a window tall enough to hold
 * the whole gallery comes back blank. Narrowing the page is how a section gets looked at.
 */
function wanted(title: string): boolean {
  const only = new URLSearchParams(window.location.search).get('only');
  return only === null || title.toLowerCase().includes(only.toLowerCase());
}

function Case({ title, note, children }: CaseProps) {
  if (!wanted(title)) return null;

  return (
    <section className="gal__case">
      <h2 className="gal__h">{title}</h2>
      {note !== undefined && <p className="gal__note">{note}</p>}
      <div className="gal__stage">{children}</div>
    </section>
  );
}

function board(heldId: string | null, undoable: ReadonlySet<string>) {
  return (
    <GoalCanvas
      goals={GOALS}
      arrange={stillArrange(heldId)}
      onSelectGoal={() => undefined}
      actionFor={(goal) => (
        <GoalAction
          goal={goal}
          busy={false}
          undoable={undoable.has(goal.id)}
          onComplete={() => undefined}
          onUndo={() => undefined}
          onLogValue={() => undefined}
        />
      )}
    />
  );
}

export function Gallery() {
  return (
    <div className="gal">
      <h1 className="gal__title">Component gallery</h1>

      <Case
        title="Board · resting"
        note="Every size, six areas, three kinds. One glass is full, one habit sits under its minimum."
      >
        {board(null, new Set())}
      </Case>

      <Case
        title="Board · a tile just ticked, and one picked up"
        note="The state the screenshots caught: Done + Undo + grip all on one tile."
      >
        {board('g-read', new Set(['g-move']))}
      </Case>

      <Case
        title="Shell · the board inside the frame"
        note="Top bar, the column of sections with its counts, and the page. Collapse is at the foot of the column; the hamburger and the drawer only appear under 48rem, so narrow the window to see them."
      >
        {atPath('/', <AppShell session={SHELL_SESSION}>{board(null, new Set())}</AppShell>)}
      </Case>

      <Case
        title="Shell · a page with nothing on it"
        note="The frame on /calendar, so the heading, the current-section mark and the empty content column can be looked at on their own."
      >
        {atPath(
          '/calendar',
          <AppShell session={SHELL_SESSION}>
            <p className="footnote">The page renders here.</p>
          </AppShell>,
        )}
      </Case>

      <Case
        title="Profile · an anonymous account"
        note="Two settings that can be changed — press Change on either; the picker is live and saving is a no-op — four plain counts, and the 90-day line. No trophies, by instruction."
      >
        <ProfileView
          profile={PROFILE}
          busy={false}
          notice={null}
          now={GALLERY_NOW}
          browserTimeZone="Europe/Madrid"
          onSave={() => Promise.resolve(true)}
        />
      </Case>

      <Case
        title="Profile · a save that did not go through"
        note="The failure line a write gets. It never says the reader did anything wrong, and the row it came from stays open."
      >
        <ProfileView
          profile={PROFILE}
          busy={false}
          notice={{
            kind: 'failed',
            title: 'Cannot reach the server from here.',
            body: 'That is usually the connection rather than anything you did.',
          }}
          now={GALLERY_NOW}
          browserTimeZone="Europe/Madrid"
          onSave={() => Promise.resolve(false)}
        />
      </Case>

      <Case title="Calendar · week" note="Wednesday is today, and it has one entry on it.">
        <CalendarWeek
          days={WEEK}
          headline="A good pour this week."
          summary="21–27 September · two things planned, one already done."
          onSelectEntry={() => undefined}
        />
      </Case>
    </div>
  );
}
