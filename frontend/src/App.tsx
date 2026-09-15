import { HealthPanel } from './components/HealthPanel';
import { buildInfo, shortCommit } from './lib/buildInfo';
import './App.css';

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Progress Tracker</h1>
        <p className="app__tagline">Alpha · infrastructure only</p>
      </header>

      <main className="app__main">
        <HealthPanel />
      </main>

      <footer className="app__footer">
        web v{buildInfo.version} · <code>{shortCommit(buildInfo.commit)}</code>
      </footer>
    </div>
  );
}
