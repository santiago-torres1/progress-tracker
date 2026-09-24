/*
 * The frame every page sits in: a top bar, a column of sections, and the page itself.
 *
 * WHAT IT IS RESPONSIBLE FOR, AND WHY EACH BIT IS HERE
 *
 * 1. Saying where you are. `NavLink` marks the current section with `aria-current="page"`, so the
 *    current page is a fact in the accessibility tree rather than a colour.
 * 2. Not stranding anybody after a navigation. React does not move focus when the URL changes —
 *    the page swaps underneath a focus ring still sitting in the menu — so the shell moves it to
 *    the new page's heading itself. That heading is the `<h1>`, and it is the shell's because a
 *    screen's own headline is written from its data and changes under you.
 * 3. The drawer. On a phone the column is a drawer, and a drawer that merely covers the page is
 *    not closed as far as the keyboard is concerned: Tab walks into a menu nobody can see. So the
 *    rest of the page is `inert` while it is open, Tab is trapped inside it, Escape closes it, and
 *    focus goes back to the button that opened it.
 *
 * WHAT IT IS NOT RESPONSIBLE FOR. How any of it looks. The class names are the approved mockup's,
 * ready for design-agent to style; `AppShell.css` carries structure only.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BoardIcon,
  CalendarIcon,
  ChevronLeftIcon,
  CloseIcon,
  GlassIcon,
  MarkIcon,
  MenuIcon,
  PersonIcon,
} from './icons';
import { readNavCollapsed, rememberNavCollapsed } from '../lib/navPreferences';
import {
  NAV_SECTIONS,
  pageTitleFor,
  type NavSection,
  type SectionCount,
  type SectionId,
} from '../lib/navigation';
import { useFocusTrap } from '../lib/useFocusTrap';
import './AppShell.css';

/**
 * As much of the session as the frame needs, and no more.
 *
 * A plain prop rather than a read of the session context, so the gallery can render the shell
 * with nothing behind it and so these three values are the entire coupling between the frame
 * and the API.
 */
export interface ShellSession {
  goalsOnBoard: number;
  glassesFilled: number;
  isAnonymous: boolean;
}

export interface AppShellProps {
  session: ShellSession;
  /**
   * The page. Left out — which is every real route — the router's `Outlet` supplies it; the
   * gallery passes one directly so it can be screenshotted without a route table.
   */
  children?: ReactNode;
  /**
   * What sits under the page on every route: the deploy proof and the build line.
   *
   * A slot rather than a component, because the shell has no business importing `HealthPanel` —
   * and the gallery renders the frame with no footer at all.
   */
  footer?: ReactNode;
}

const DRAWER_ID = 'app-drawer';

const ICONS: Readonly<Record<SectionId, (props: { className?: string }) => ReactNode>> = {
  board: BoardIcon,
  calendar: CalendarIcon,
  glasses: GlassIcon,
  profile: PersonIcon,
};

function countFor(section: NavSection, session: ShellSession): number | null {
  if (section.count === 'goalsOnBoard') return session.goalsOnBoard;
  if (section.count === 'glassesFilled') return session.glassesFilled;
  return null;
}

/** What the number beside a section means, for anyone who cannot see it sitting in a column. */
const COUNT_NOUN: Readonly<Record<SectionCount, string>> = {
  goalsOnBoard: 'on the board',
  glassesFilled: 'filled',
};

interface SectionListProps {
  session: ShellSession;
  /** Called on every activation, so the drawer shuts on the way to the page. */
  onNavigate?: () => void;
}

/**
 * What a section is called when it is spoken rather than read.
 *
 * Every link gets one, for two reasons. A bare "Board 5" leaves a screen reader's listener to guess
 * what the five counts, and the column collapses to a rail where the words are off screen entirely —
 * one name that always holds covers both, instead of a name that appears when the rail does. It
 * begins with the visible label, so "click Board" still works for anyone driving by voice.
 */
function spokenName(section: NavSection, count: number | null): string {
  if (count === null || section.count === null) return section.label;
  return `${section.label}, ${count} ${COUNT_NOUN[section.count]}`;
}

function SectionList({ session, onNavigate }: SectionListProps) {
  return (
    <ul className="nav">
      {NAV_SECTIONS.map((section) => {
        const Icon = ICONS[section.id];
        const count = countFor(section, session);

        return (
          <li key={section.id}>
            <NavLink
              className="nav__item"
              to={section.path}
              end={section.end}
              onClick={onNavigate}
              aria-label={spokenName(section, count)}
            >
              <Icon className="nav__icon" />
              <span className="nav__label">{section.label}</span>
              {count !== null && <span className="nav__n">{count}</span>}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <>
      <MarkIcon className="brand__mark" />
      <span className={className}>
        progress<span className="brand__tail">-tracker</span>
      </span>
    </>
  );
}

export function AppShell({ session, children, footer }: AppShellProps) {
  const location = useLocation();
  const title = pageTitleFor(location.pathname);

  const [collapsed, setCollapsed] = useState(readNavCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  /*
   * Focus goes back to the hamburger only when a person closed the drawer — not when they
   * navigated out of it, because then it belongs on the page they asked for. A ref rather than
   * state: this is a note to the next effect, not something any render depends on.
   */
  const restoreFocus = useRef(false);

  const closeDrawer = useCallback(() => {
    restoreFocus.current = true;
    setDrawerOpen(false);
  }, []);

  useFocusTrap({ active: drawerOpen, containerRef: drawerRef, onEscape: closeDrawer });

  useEffect(() => {
    if (drawerOpen || !restoreFocus.current) return;
    restoreFocus.current = false;
    menuButtonRef.current?.focus();
  }, [drawerOpen]);

  /*
   * A navigation: shut the drawer and put focus on the new page's heading.
   *
   * Nothing happens on arrival — a page that grabs focus the moment you reach it is behaving like
   * something that wants your attention, and this app does not. The drawer's own links close it in
   * the click handler as well, so by the time this runs it is already shut and the heading is no
   * longer behind an `inert` wrapper.
   *
   * The condition is "the path is different from the one I last saw", not "this is not the first
   * time I have run". A boolean latch says yes on its second invocation, and React's StrictMode
   * invokes every effect twice on mount in development — so the latch version drew a focus ring
   * around the heading on every page load, but only in development, which is the only place anyone
   * would have seen it.
   */
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    const arrived = lastPath.current;
    lastPath.current = location.pathname;
    if (arrived === null || arrived === location.pathname) return;

    setDrawerOpen(false);
    headingRef.current?.focus();
  }, [location.pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      rememberNavCollapsed(next);
      return next;
    });
  }, []);

  const page = children ?? <Outlet />;

  return (
    <div className="shell" data-drawer-open={drawerOpen ? 'true' : undefined}>
      <header className="topbar" inert={drawerOpen}>
        <button
          className="iconbtn topbar__menu"
          type="button"
          ref={menuButtonRef}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls={DRAWER_ID}
          onClick={() => {
            setDrawerOpen(true);
          }}
        >
          <MenuIcon className="iconbtn__glyph" />
        </button>

        <Link className="brand" to="/">
          <Brand className="brand__name" />
        </Link>

        <div className="topbar__grow" />

        <NavLink
          className="who"
          to="/profile"
          aria-label={session.isAnonymous ? 'Anonymous account — your profile' : 'Your profile'}
        >
          <span className="bead">
            <PersonIcon className="bead__glyph" />
          </span>
          <span className="who__label">{session.isAnonymous ? 'Anonymous' : 'Profile'}</span>
        </NavLink>
      </header>

      <div className="shell__body" inert={drawerOpen}>
        <nav className="side" aria-label="Sections" data-collapsed={collapsed ? 'true' : undefined}>
          <SectionList session={session} />

          <div className="side__foot">
            <button
              className="side__collapse"
              type="button"
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              <ChevronLeftIcon className="side__collapse-glyph" />
              <span className="side__collapse-label">{collapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </div>
        </nav>

        <main className="content">
          <div className="content__inner">
            {/*
              The page's heading, and the thing focus lands on after a navigation. `tabIndex={-1}`
              makes it a focus target without making it a tab stop — Tab still goes from the nav
              to the page's first control, as it should.
            */}
            <h1 className="content__heading" tabIndex={-1} ref={headingRef}>
              {title}
            </h1>
            {page}
            {footer}
          </div>
        </main>
      </div>

      {drawerOpen && (
        <div className="drawer-wrap">
          {/* Decorative: Escape and the close button are the keyboard's way out. */}
          <div className="scrim" aria-hidden="true" onClick={closeDrawer} />

          <nav className="drawer" id={DRAWER_ID} aria-label="Sections" ref={drawerRef}>
            <div className="drawer__head">
              <span className="drawer__brand">
                <Brand />
              </span>
              <button
                className="iconbtn drawer__close"
                type="button"
                aria-label="Close menu"
                onClick={closeDrawer}
              >
                <CloseIcon className="iconbtn__glyph" />
              </button>
            </div>

            <SectionList
              session={session}
              onNavigate={() => {
                setDrawerOpen(false);
              }}
            />

            {session.isAnonymous && (
              <div className="side__foot">
                <p className="footnote">
                  Anonymous session. 90 days without a visit and it is removed.
                </p>
              </div>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
