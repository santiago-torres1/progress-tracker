import type { StyleWithVars } from '../types/style';
import './EmptyState.css';

export interface EmptyPlot {
  title: string;
  detail: string;
}

export interface EmptyStateProps {
  title?: string;
  body?: string;
  /** The empty plots of ground. Illustrative, not buttons — the one action is below them. */
  plots?: readonly EmptyPlot[];
  actionLabel?: string;
  /** Without a handler there is no button: an empty state that lies is worse than a bare one. */
  onAction?: () => void;
  note?: string;
}

const DEFAULT_TITLE = 'Nothing here yet. That is just room.';

const DEFAULT_BODY =
  'Add one thing you would like more of, in any part of your life. It starts as an empty glass ' +
  'and you fill it a little at a time — there is no streak to break and nothing to fall behind on.';

const DEFAULT_PLOTS: readonly EmptyPlot[] = [
  { title: 'Your first goal', detail: 'Scheduled, measured or a habit' },
  { title: 'Then another', detail: 'Health, money, learning, people, work, making things' },
  { title: 'Or not', detail: 'Two goals is a perfectly good board' },
];

const DEFAULT_NOTE = 'Six life areas to choose from. You can rename a goal at any time.';

/** An empty glass is room, not failure. Nothing here counts anything, and nothing is overdue. */
export function EmptyState({
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  plots = DEFAULT_PLOTS,
  actionLabel = 'Add your first goal',
  onAction,
  note = DEFAULT_NOTE,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h2 className="empty-state__title">{title}</h2>
      <p className="empty-state__body">{body}</p>

      <div className="empty-state__plots">
        {plots.map((plot, index) => {
          const style: StyleWithVars = { '--i': index };
          const first = index === 0;

          const classes = ['empty-state__plot'];
          if (first) {
            classes.push('empty-state__plot--first');
          }

          return (
            <div key={plot.title} className={classes.join(' ')} style={style}>
              {first && (
                <span className="empty-state__seed" aria-hidden="true">
                  +
                </span>
              )}
              <b>{plot.title}</b>
              <span>{plot.detail}</span>
            </div>
          );
        })}
      </div>

      {onAction !== undefined && (
        <button className="empty-state__action" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}

      <p className="empty-state__note">{note}</p>
    </div>
  );
}
