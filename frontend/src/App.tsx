import { HealthPanel } from './components/HealthPanel';
import { buildInfo, shortCommit } from './lib/buildInfo';
import { useNow } from './lib/useNow';
import { CalendarScreen } from './screens/CalendarScreen';
import { Dashboard } from './screens/Dashboard';
import './App.css';

/**
 * The page opens on the goals dashboard, with the calendar under it and the deploy proof at the
 * foot. One clock is read here and passed down, so every "today" on the page is the same today.
 */
export function App() {
  const now = useNow();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Progress Tracker</h1>
        <p className="app__tagline">Alpha · a read-only look at how things stand</p>
      </header>

      <main className="app__main">
        <Dashboard now={now} />
        <CalendarScreen now={now} />
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
