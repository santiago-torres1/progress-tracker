/*
 * The one thing on screen when a read has not arrived, or did not.
 *
 * No colour, no icon, no alarm: it is a sentence, said once. `role="status"` makes it polite for
 * a screen reader rather than an interruption, and the retry is a button a person may press, not
 * a loop the page runs on its own.
 */

import './StatusNote.css';

export interface StatusNoteBase {
  title: string;
  /** `line` is one quiet sentence in a corner of a screen that otherwise has its content. */
  variant?: 'block' | 'line';
}

export type StatusNoteProps =
  | (StatusNoteBase & { state: 'loading' })
  | (StatusNoteBase & { state: 'failure'; body: string; onRetry?: () => void });

export function StatusNote(props: StatusNoteProps) {
  const { title, variant = 'block' } = props;
  const loading = props.state === 'loading';

  return (
    <div className={`status-note status-note--${variant}`} role="status" aria-busy={loading}>
      <p className="status-note__title">{title}</p>

      {props.state === 'failure' && <p className="status-note__body">{props.body}</p>}

      {props.state === 'failure' && props.onRetry !== undefined && (
        <button className="status-note__retry" type="button" onClick={props.onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
