/*
 * A URL that is not one of the four sections.
 *
 * Reachable two ways: a mistyped address, and a link to something this version does not have yet.
 * Neither is the visitor's mistake, so this says what happened and points at the board — no
 * apology, no error code, and nothing that looks like something broke.
 *
 * The heading is the shell's; `navigation.ts` titles this page "Page not found".
 */

import { Link } from 'react-router-dom';

export function NotFoundScreen() {
  return (
    <section className="not-found" aria-label="Page not found">
      <p>There is nothing at that address — at least not in this version.</p>
      <p>
        <Link to="/">Back to your board</Link>
      </p>
    </section>
  );
}
