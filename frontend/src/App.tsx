import { useState } from 'react';
import { HealthPanel } from './components/HealthPanel';
import { SessionGate } from './components/SessionGate';
import { buildInfo, shortCommit } from './lib/buildInfo';
import { useNow } from './lib/useNow';
import { ArchiveScreen } from './screens/ArchiveScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { Dashboard } from './screens/Dashboard';
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
 * The page opens on the goals dashboard, with the calendar under it and the deploy proof at the
 * foot. One clock is read here and passed down, so every "today" on the page is the same today.
 *
 * Everything below the gate has a session: a visitor is signed in anonymously before the board
 * renders, because every /api route needs a token and there is no read-only fallback to show.
 */
export function App({ authStore, browserTimeZone }: AppProps = {}) {
  const now = useNow();
  const [view, setView] = useState<'board' | 'shelf'>('board');

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Progress Tracker</h1>
        <p className="app__tagline">Alpha · your goals, as glasses that fill</p>
      </header>

      <main className="app__main">
        <SessionGate store={authStore} browserTimeZone={browserTimeZone}>
          {view === 'shelf' ? (
            <ArchiveScreen
              onBack={() => {
                setView('board');
              }}
            />
          ) : (
            <>
              <Dashboard
                now={now}
                onOpenArchive={() => {
                  setView('shelf');
                }}
              />
              <CalendarScreen now={now} />
            </>
          )}
        </SessionGate>
      </main>

      <footer className="app__footer">
        <HealthPanel />
        <p className="app__build">
          web v{buildInfo.version} · <code>{shortCommit(buildInfo.commit)}</code>
        </p>
      </footer>
    </div>
  );
}
