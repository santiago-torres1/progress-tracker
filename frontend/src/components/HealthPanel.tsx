import { useCallback, useEffect, useState } from 'react';
import { shortCommit } from '../lib/buildInfo';
import { fetchHealth, type HealthResult } from '../lib/health';
import './HealthPanel.css';

type PanelState = { kind: 'checking' } | HealthResult;

const STATUS_LABEL: Record<PanelState['kind'], string> = {
  checking: 'Checking',
  pass: 'Pass',
  fail: 'Fail',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function HealthPanel() {
  const [state, setState] = useState<PanelState>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth({ signal: controller.signal })
      .then(setState)
      .catch(() => {
        // Only reachable when this effect was cleaned up; nothing to render.
      });
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'checking' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <section
      className="health-panel"
      aria-labelledby="health-panel-title"
      aria-busy={state.kind === 'checking'}
    >
      <header className="health-panel__header">
        <h2 id="health-panel-title" className="health-panel__title">
          Alpha infra status
        </h2>
        <span className="health-panel__status" data-status={state.kind} role="status">
          {STATUS_LABEL[state.kind]}
        </span>
      </header>

      <dl className="health-panel__details">
        <div className="health-panel__row">
          <dt>Endpoint</dt>
          <dd>
            <code>GET /health</code>
          </dd>
        </div>
        {state.kind === 'pass' && (
          <>
            <div className="health-panel__row">
              <dt>API version</dt>
              <dd>{state.payload.version}</dd>
            </div>
            <div className="health-panel__row">
              <dt>API commit</dt>
              <dd>
                <code>{shortCommit(state.payload.commit)}</code>
              </dd>
            </div>
            <div className="health-panel__row">
              <dt>Server time</dt>
              <dd>
                <time dateTime={state.payload.timestamp}>
                  {formatTimestamp(state.payload.timestamp)}
                </time>
              </dd>
            </div>
          </>
        )}
        {state.kind === 'fail' && (
          <div className="health-panel__row">
            <dt>Reason</dt>
            <dd>{state.reason}</dd>
          </div>
        )}
        {state.kind !== 'checking' && (
          <div className="health-panel__row">
            <dt>Latency</dt>
            <dd>{state.latencyMs} ms</dd>
          </div>
        )}
      </dl>

      <button
        type="button"
        className="health-panel__retry"
        onClick={retry}
        disabled={state.kind === 'checking'}
      >
        Check again
      </button>
    </section>
  );
}
