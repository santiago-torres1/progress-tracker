import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell, type ShellSession } from './components/AppShell';
import { HealthPanel } from './components/HealthPanel';
import { SessionGate } from './components/SessionGate';
import { buildInfo, shortCommit } from './lib/buildInfo';
import { useAppSession } from './lib/sessionContext';
import { useNow } from './lib/useNow';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { Dashboard } from './screens/Dashboard';
import { NotFoundScreen } from './screens/NotFoundScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import type { AuthStore } from './lib/auth';
import './App.css';

export interface AppProps {
  /**
   * The identity provider, injected by the tests. Left out — which is every real build — the gate
   * makes its own from the Vite environment. It is the same seam `SessionGate` exposes, and it
   * exists so a test never has to talk to Supabase.
   */
  authStore?: AuthStore;
  /** The zone to report on a first run. Pinned by the tests so a machine's own zone cannot leak in. */
  browserTimeZone?: string;
}

/**
 * The app, with a real browser history behind it.
 *
 * The four sections are URLs now rather than a `useState` — so a person can bookmark their
 * calendar, the back button means what it says, and a reload lands where they were. That works in
 * a deploy because CloudFront answers 403 and 404 with `index.html` (see the `custom_error_response`
 * blocks in `infra/main/frontend.tf`); without that fallback, /calendar would be a missing S3 key.
 *
 * `AppRoutes` is exported separately because a test needs to start at a URL, which is a
 * `MemoryRouter` job. Nothing else about the two differs.
 */
export function App(props: AppProps = {}) {
  return (
    <BrowserRouter>
      <AppRoutes {...props} />
    </BrowserRouter>
  );
}

export function AppRoutes({ authStore, browserTimeZone }: AppProps = {}) {
  return (
    <SessionGate store={authStore} browserTimeZone={browserTimeZone}>
      <SignedInRoutes />
    </SessionGate>
  );
}

/**
 * The route table. One clock is read here and passed down, so every "today" on the page agrees.
 *
 * Paths are written out rather than mapped from `NAV_SECTIONS` on purpose: this is the one place
 * that says what a URL renders, and a table generated from the navigation list would make a
 * mismatch between the two impossible to see — and impossible to test. `lib/navigation.ts` is
 * still the only place that spells a path for the links and the headings, and `App.test.tsx`
 * walks every section in that list through this table to prove the two agree.
 */
function SignedInRoutes() {
  const now = useNow();
  const { profile } = useAppSession();

  const shell: ShellSession = {
    goalsOnBoard: profile.stats.goalsOnBoard,
    glassesFilled: profile.stats.glassesFilled,
    isAnonymous: profile.isAnonymous,
  };

  return (
    <Routes>
      <Route element={<AppShell session={shell} footer={<AppFooter />} />}>
        <Route index element={<BoardRoute now={now} />} />
        <Route path="calendar" element={<CalendarScreen now={now} />} />
        <Route path="glasses" element={<GlassesRoute />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  );
}

/*
 * The two screens that still take a callback instead of rendering a link.
 *
 * Both buttons predate the router and are not navigation chrome — "My full glasses" sits with "Add
 * a goal" in the board's own controls — so they stay buttons, and the route supplies what they do.
 * The screens themselves know nothing about routing, which is also what keeps their tests able to
 * mount them alone.
 */
function BoardRoute({ now }: { now: Date }) {
  const navigate = useNavigate();
  return (
    <Dashboard
      now={now}
      onOpenArchive={() => {
        void navigate('/glasses');
      }}
    />
  );
}

function GlassesRoute() {
  const navigate = useNavigate();
  return (
    <ArchiveScreen
      onBack={() => {
        void navigate('/');
      }}
    />
  );
}

/**
 * The deploy proof, on every page.
 *
 * Kept because a milestone that is about the plumbing needs somewhere to show the plumbing, and
 * demoted to a footer because it is no longer the point. The class names are the ones `App.css`
 * already styles it with.
 */
function AppFooter() {
  return (
    <footer className="app__footer">
      <HealthPanel />
      <p className="app__build">
        web v{buildInfo.version} · <code>{shortCommit(buildInfo.commit)}</code>
      </p>
    </footer>
  );
}
