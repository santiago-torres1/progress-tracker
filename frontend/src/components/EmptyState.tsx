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

const DEFAULT_TITLE = 'Every board starts empty.';

const DEFAULT_BODY =
  'Name one thing you would like more of — a run, a language, money set aside — and it becomes ' +
  'a glass on this board. Every time you come back and say you did it, the glass fills a little. ' +
  'That is the whole app. Nothing here turns red, nothing scolds you, and there is no streak ' +
  'to break.';

const DEFAULT_PLOTS: readonly EmptyPlot[] = [
  { title: 'Your first glass', detail: 'A habit, a number to move, or sessions' },
  { title: 'Then another', detail: 'Health, money, learning, people, work, making things' },
  { title: 'Or a quiet week', detail: 'The glass stays where it is, and nothing is said' },
];

const DEFAULT_NOTE =
  'Six life areas to choose from, and one goal is a whole board. Anything about it can change later.';

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
